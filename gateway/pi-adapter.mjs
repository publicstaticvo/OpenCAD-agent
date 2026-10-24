import {Agent} from '@earendil-works/pi-agent-core';
import {createModels,fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import schema from '../shared/cad-schema.json' with {type:'json'};
import {assertContract,budgets} from '../shared/cad-contracts.ts';
import {createHash} from 'node:crypto';
function expand(s){
 if(Array.isArray(s))return s.map(expand);
 if(!s||typeof s!=='object')return s;
 if(s.$ref)return expand(schema.definitions[s.$ref]??schema[s.$ref]);
 return Object.fromEntries(Object.entries(s).map(([k,v])=>[k,expand(v)]));
}
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const toolsSchema={cad_inspect:object({}),cad_apply:object({operations:{type:'array',minItems:1,maxItems:256,items:expand(schema.operation)}}),cad_finish:object({criteria:expand(schema.criteria)})};
function strictTool(name,args){
 if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('Raw tool arguments must be an object');
 const keys=Object.keys(toolsSchema[name].properties);
 if(Object.keys(args).length!==keys.length||keys.some(k=>!Object.hasOwn(args,k)))throw new Error('Raw tool fields rejected');
 if(name==='cad_apply'){
  if(!Array.isArray(args.operations)||args.operations.length<1||args.operations.length>256)throw new Error('Invalid operations count');
  for(const op of args.operations)assertContract('operation',op);
 }
 if(name==='cad_finish')assertContract('criteria',args.criteria);
}
export function makeFauxProvider(turns,options={}){
 const fake=fauxProvider({tokensPerSecond:options.tokensPerSecond??1000000});
 fake.setResponses(turns.map(turn=>turn.calls?fauxAssistantMessage(turn.calls.map(c=>fauxToolCall(c.name,c.args,c.id?{id:c.id}:{})),{stopReason:'toolUse'}):fauxAssistantMessage(turn.text??'')));
 const models=createModels();models.setProvider(fake.provider);
 return{mode:'fake',model:fake.getModel(),streamFn:models.streamSimple.bind(models)};
}
/** Provider is explicitly injected. Never reads personal auth or environment credentials. */
export async function runPiLoop({task,session,signal,provider,maxToolCalls=budgets.maxToolCalls,onProgress=()=>{},onTranscript=()=>{}}){
 let finished=null,fatal=null,calls=0,turns=0,blocked=0,coercions=0;
 const approved=new Map(),seen=new Set(),contextRevisions=[];
 const result=value=>({content:[{type:'text',text:JSON.stringify(value)}],details:{}});
 const tools=Object.keys(toolsSchema).map(name=>({name,label:name,description: name==='cad_inspect'?'Inspect current candidate; stable feature IDs, named parameters in mm.':name==='cad_apply'?'Apply restricted editable CAD operations to this task candidate. No code or paths.':'Request deterministic validation of final dimensions, volume and parameters. Does not itself publish HEAD.',parameters:toolsSchema[name],execute:async(id)=>{
  const args=approved.get(id);approved.delete(id);if(!args)throw new Error('Raw approval missing');strictTool(name,args);
  if(signal.aborted)throw signal.reason;
  if(name==='cad_inspect')return result(await session.inspect());
  if(name==='cad_apply')return result(await session.apply(args.operations,createHash('sha256').update(id).digest('hex')));
  const validation=await session.prepare(args.criteria);finished=args.criteria;return result({validated:true,validation,publication:'Gateway pending'});
 }}));
 const agent=new Agent({initialState:{model:provider.model,tools,systemPrompt:'You create editable CAD using only these regulated tools. Units mm; single Body/solid; planar sketches with line/circle and named constraints; Pad/Pocket. Require fully constrained sketches. Inspect current revision before editing. Never invent successful publication. Finish requires deterministic bbox/volume/parameters; unsupported features must be reported. No Python, shell, files, STEP editing, assembly or drawings.'},streamFn:provider.streamFn,toolExecution:'sequential',
  prepareRequest:async({context})=>{
   const latest=await session.snapshot();contextRevisions.push(latest.revision);
   if(latest.revision!==session.baseRevision){fatal='Revision conflict before next provider request';agent.abort();return;}
   const marker='[Gateway current formal snapshot]';
   const messages=context.messages.filter(m=>!(m.role==='user'&&typeof m.content==='string'&&m.content.startsWith(marker)));
   return{context:{...context,messages:[...messages,{role:'user',content:marker+JSON.stringify({documentId:latest.documentId,revision:latest.revision,features:latest.tree}),timestamp:Date.now()}]}};
  },
  beforeToolCall:async({toolCall,args})=>{
   if(fatal)return{block:true,reason:fatal,terminate:true};
   try{
    if(seen.has(toolCall.id))throw new Error('Duplicate tool call ID');seen.add(toolCall.id);
    if(JSON.stringify(toolCall.arguments)!==JSON.stringify(args))coercions++;
    strictTool(toolCall.name,toolCall.arguments);approved.set(toolCall.id,structuredClone(toolCall.arguments));
   }catch(e){return{block:true,reason:e.message};}
  },
  finishTurn:async()=>{if(++turns>maxToolCalls+1){fatal='Agent turn budget exceeded';agent.abort();}if(fatal)return{action:'end'};},
 });
 agent.subscribe(event=>{
  if(event.type==='message_end'&&event.message.role==='assistant'){
   calls+=event.message.content.filter(c=>c.type==='toolCall').length;
   if(calls>maxToolCalls){fatal='Agent tool budget exceeded';agent.abort();}
  }
  if(event.type==='tool_execution_end'){if(event.isError)blocked++;onProgress({type:event.type,name:event.toolName,isError:event.isError});}
 });
 const abort=()=>agent.abort();signal.addEventListener('abort',abort,{once:true});
 try{
  if(signal.aborted)throw signal.reason;
  const summary=await session.snapshot();
  await agent.prompt(JSON.stringify({task,documentId:summary.documentId,revision:summary.revision,features:summary.tree}));await agent.waitForIdle();
  if(signal.aborted)throw signal.reason;
  if(fatal)throw new Error(fatal);
  if(!finished){const last=agent.state.messages.filter(m=>(m.role==='toolResult'&&m.isError)||m.role==='assistant').at(-1);const detail=last?.content?.filter?.(c=>c.type==='text').map(c=>c.text).join(' ')??'';throw new Error('Agent did not request successful cad_finish; no formal model committed. '+detail.slice(0,1000));}
  return finished;
 }finally{
  signal.removeEventListener('abort',abort);
  const messages=agent.state.messages.filter(m=>m.role!=='system').map(m=>JSON.stringify(m).length<=32768?m:{role:m.role,content:[{type:'text',text:'Large tool payload omitted; reload current formal snapshot for context.'}],timestamp:Date.now()});
  onTranscript({provider:provider.mode,toolCalls:calls,blockedCalls:blocked,rawCoercionsObserved:coercions,contextRevision:session.baseRevision,contextRevisions,messages,usage:agent.state.messages.filter(m=>m.role==='assistant').map(m=>m.usage)});
 }
}
