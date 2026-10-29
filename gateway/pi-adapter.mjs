import {Agent} from '@earendil-works/pi-agent-core';
import {createModels,fauxProvider,fauxAssistantMessage,fauxToolCall,normalizeContext} from '@earendil-works/pi-ai';
import schema from '../shared/cad-schema.json' with {type:'json'};
import {assertContract,budgets} from '../shared/cad-contracts.ts';
import {createHash,randomUUID} from 'node:crypto';
import {describeModelFailure,publicModelMessage} from '../shared/model-errors.ts';
function expand(s){
 if(Array.isArray(s))return s.map(expand);
 if(!s||typeof s!=='object')return s;
 if(s.$ref)return expand(schema.definitions[s.$ref]??schema[s.$ref]);
 return Object.fromEntries(Object.entries(s).map(([k,v])=>[k,expand(v)]));
}
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const toolsSchema={cad_inspect:object({}),cad_apply:object({operations:{type:'array',minItems:1,maxItems:256,items:expand(schema.operation)}}),cad_finish:object({criteria:expand(schema.criteria)})};
const planToolSchema=object({plan:expand(schema.plan)});
export const cadToolSchemas=toolsSchema;
export const normalizeProbeContext=normalizeContext;
export function selectHistory(messages,budget){
 const rounds=[];for(const message of messages){if(message.role==='user')rounds.push([]);if(rounds.length)rounds.at(-1).push(message);}
 let used=0;const selected=[];
 for(let i=rounds.length-1;i>=0;i--){const size=Buffer.byteLength(JSON.stringify(rounds[i]));if(used+size>budget)break;selected.unshift(...rounds[i]);used+=size;}
 return{messages:selected.map(({cadBaseRevision,...message})=>message.role==='user'&&cadBaseRevision!==undefined?{...message,content:`[Historical CAD revision ${cadBaseRevision}; current geometry is supplied separately]\n${message.content}`}:message),included:selected.filter(m=>m.role==='user').length,omitted:rounds.length-selected.filter(m=>m.role==='user').length};
}
const cadInstructions=`You create editable CAD using only the supplied tools. Units mm; exactly one Body and one connected solid. Supported: planar line/circle sketches, named constraints, Pad/Pocket and named parameter edits. No code, files, STEP editing, assemblies or drawings.
Inspect before editing. Missing essential dimensions require a clarification response; do not invent them. Unsupported or impossible geometry must be reported without cad_finish. Never claim publication before Gateway commits.
cad_apply takes ONLY {operations:[...]}, with each operation directly in that array. Each batch is transactional: an error rolls back ALL operations in that batch. Geometry indices are contiguous from 0 within each sketch. Feature IDs are unique; constraint names are unique within each sketch. Follow the approved stage boundaries when provided; otherwise keep each sketch and its solid operation together. A successful batch remains in the candidate; do not recreate its features.
Constraint args follow these exact signatures: Coincident [geometry,point,geometry,point]; Horizontal/Vertical [line]; Distance [line,positiveLength]; DistanceX/DistanceY [geometry,point,signedCoordinate]; Diameter/Radius [circle,positiveSize]; Equal [geometry,geometry]. Line points: 1=start,2=end. Circle point: 3=center. Origin: geometry=-1,point=1. Coincident to origin constrains a circle center or rectangle corner. Do not use zero coordinate dimensions when coincidence suffices.
A closed rectangle needs four joined line endpoints, Horizontal/Vertical on its four edges, one corner anchored, and two independent length dimensions. Merely supplying coordinates does not constrain a sketch. A circle needs its center constrained and a radius/diameter. Every sketch must be fully constrained before pad/pocket. Avoid redundant dimensions. XY Pad extends +Z; XY Pocket at its top extends -Z. Place cut sketches at the correct top height.
For a rectangular prism with requested width W, height H and depth D, use four lines with exact endpoints [0,0]->[W,0], [W,0]->[W,H], [W,H]->[0,H], [0,H]->[0,0]. Add Coincident constraints [0,2,1,1], [1,2,2,1], [2,2,3,1], [3,2,0,1], Horizontal [0], Vertical [1], Horizontal [2], Vertical [3], Coincident [0,1,-1,1], Distance [0,W], Distance [1,H], then pad Length D. Names must be unique (e.g. join0..join3, horizontal0, vertical1, horizontal2, vertical3, origin, width, height). Width/height values are positive requested dimensions. Geometry coordinates are the initial sketch only; constraints define editable dimensions.
Use cad_inspect to read actual named parameters and feature IDs for edits. cad_finish requires expected bounding-box LENGTHS [X,Y,Z], volume, and any requested named parameter criteria, calculated from the requested geometry. It validates geometry and does not publish HEAD. Keep tool calls concise and use the exact schema.`;
function strictTool(name,args){
 if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('Raw tool arguments must be an object');
 const definition=name==='cad_plan'?planToolSchema:toolsSchema[name];
 if(!definition)throw new Error('Unknown CAD tool');
 const keys=Object.keys(definition.properties);
 if(Object.keys(args).length!==keys.length||keys.some(k=>!Object.hasOwn(args,k)))throw new Error('Raw tool fields rejected');
 if(name==='cad_apply'){
  if(!Array.isArray(args.operations)||args.operations.length<1||args.operations.length>256)throw new Error('Invalid operations count');
  for(const op of args.operations)assertContract('operation',op);
 }
 if(name==='cad_finish')assertContract('criteria',args.criteria);
 if(name==='cad_plan')assertContract('plan',args.plan);
}
export function makeFauxProvider(turns,options={}){
 const fake=fauxProvider({tokensPerSecond:options.tokensPerSecond??1000000});
 fake.setResponses(turns.map(turn=>turn.calls?fauxAssistantMessage(turn.calls.map(c=>fauxToolCall(c.name,c.args,c.id?{id:c.id}:{})),{stopReason:'toolUse'}):fauxAssistantMessage(turn.text??'')));
 const models=createModels();models.setProvider(fake.provider);
 return{mode:'fake',model:fake.getModel(),streamFn:models.streamSimple.bind(models)};
}
/** Provider is explicitly injected. Never reads personal auth or environment credentials. */
export async function runPiLoop({task,session,signal,provider,maxToolCalls=budgets.maxToolCalls,onProgress=()=>{},onTranscript=()=>{}}){
 let finished=null,proposed=false,fatal=null,writeApplied=false,calls=0,turns=0,blocked=0,coercions=0;
 const planning=session.mode==='planning';
 const instructions=planning?`You are the read-only CAD planning Agent. No CAD writing or candidate exists yet. Read the formal model and the user's request. Supported plans: create_box (positive length X, width Y, height Z in mm), add_hole (one centered through hole diameter in mm on the existing supported box), edit_hole (change existing centered hole diameter). Use cad_plan exactly once to propose the requested supported design. For missing essential dimensions ask a concise clarification in the user's language, without cad_plan. For greetings or unsupported operations answer honestly without a plan. Do not invent missing sizes. The user will approve the resulting plan before any CAD writing. Do not claim execution.`:cadInstructions+(session.plan?`\nThis task has an immutable approved plan and a finite operation contract below. Inspect first. Use exactly one cad_apply per contract stage in the stated order. Produce the actual tool arguments yourself, using the geometry and dimension references in the contract. Names of nondimensional constraints can differ. Never combine stages or repeat a successful stage. No other operations or automatic repair are permitted. cad_finish must use the approved criteria exactly. Approval: ${JSON.stringify(session.plan)}\nStage contracts: ${JSON.stringify(session.stages)}`:'');
 const initial=await session.snapshot();
 const currentInput={task,phase:session.mode,approvedPlan:session.plan,documentId:initial.documentId,revision:initial.revision,features:initial.tree};
 const inputBudget=(provider.model.contextWindow??262144)-(provider.model.maxTokens??16384)-8192;
 const budget=inputBudget-Buffer.byteLength(instructions+JSON.stringify(toolsSchema)+JSON.stringify(currentInput).repeat(2));
 if(budget<0)throw new Error('Current CAD input exceeds configured context budget');
 const selection=selectHistory(session.history??[],budget),history=selection.messages;
 let messageIndex=0,messageId='',deltaIndex=0;
 const emit=onProgress;let pending=null,flushTimer;
 const flush=()=>{clearTimeout(flushTimer);flushTimer=undefined;if(pending){emit(pending);pending=null;}};
 onProgress=event=>{if(event.type==='text_delta'||event.type==='thinking_delta'){if(pending&&(pending.messageId!==event.messageId||pending.type!==event.type))flush();pending={...event,delta:(pending?.delta??'')+event.delta};if(!flushTimer)flushTimer=setTimeout(flush,100);}else{flush();emit(event);}};
 const approved=new Map(),seen=new Set(),contextRevisions=[];
 const result=value=>({content:[{type:'text',text:JSON.stringify(value)}],details:{}});
 const definitions=planning?{cad_inspect:toolsSchema.cad_inspect,cad_plan:planToolSchema}:toolsSchema;
 const tools=Object.keys(definitions).map(name=>({name,label:name,description: name==='cad_inspect'?'Read actual current CAD state.':name==='cad_plan'?'Propose a structured design for user approval. No CAD execution.':name==='cad_apply'?'Apply restricted editable CAD operations to this task candidate. No code or paths.':'Request deterministic validation of final dimensions, volume and parameters. Does not itself publish HEAD.',parameters:definitions[name],execute:async(id)=>{
  const args=approved.get(id);approved.delete(id);if(!args)throw new Error('Raw approval missing');strictTool(name,args);
  if(signal.aborted)throw signal.reason;
  if(name==='cad_inspect')return result(await session.inspect());
  if(name==='cad_plan'){const plan=await session.propose(args.plan);proposed=true;return result({awaitingUserApproval:true,plan});}
  if(name==='cad_apply'){const value=await session.apply(args.operations,createHash('sha256').update(id).digest('hex'));writeApplied=true;return result(value);}
  const validation=await session.prepare(args.criteria);finished=args.criteria;return result({validated:true,validation,publication:'Gateway pending'});
 }}));
 const agent=new Agent({initialState:{model:provider.model,tools,systemPrompt:instructions,messages:history},streamFn:provider.streamFn,toolExecution:'sequential',
  prepareRequest:async({context})=>{
   const latest=await session.snapshot();contextRevisions.push(latest.revision);
   if(latest.revision!==session.baseRevision){fatal='Revision conflict before next provider request';agent.abort();return;}
   const marker='[Gateway current formal snapshot]';
   const messages=context.messages.filter(m=>!(m.role==='user'&&typeof m.content==='string'&&m.content.startsWith(marker)));
   const next={...context,messages:[...messages,{role:'user',content:marker+JSON.stringify({documentId:latest.documentId,revision:latest.revision,features:latest.tree}),timestamp:Date.now()}]};
   if(Buffer.byteLength(instructions+JSON.stringify(definitions)+JSON.stringify(next.messages))>inputBudget){fatal='CAD conversation exceeds configured context budget';agent.abort();return;}
   return{context:next};
  },
  beforeToolCall:async({toolCall,args})=>{
   if(fatal)return{block:true,reason:fatal,terminate:true};
   if(finished||proposed)return{block:true,reason:'CAD phase already completed; no further tools allowed',terminate:true};
   try{
    if(seen.has(toolCall.id))throw new Error('Duplicate tool call ID');seen.add(toolCall.id);
    let raw=toolCall.arguments;
    // Some OpenAI-compatible local servers wrap function parameters in `arguments`.
    if(raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.keys(raw).length===1&&raw.arguments&&typeof raw.arguments==='object'&&!Array.isArray(raw.arguments))raw=raw.arguments;
    if(JSON.stringify(raw)!==JSON.stringify(args))coercions++;
    strictTool(toolCall.name,raw);approved.set(toolCall.id,structuredClone(raw));
   }catch(e){if(session.mode){fatal=e.message;return{block:true,reason:e.message,terminate:true};}return{block:true,reason:e.message};}
  },
  finishTurn:async()=>{if(finished||proposed)return{action:'end'};if(++turns>maxToolCalls+1){fatal='Agent turn budget exceeded';agent.abort();}if(fatal)return{action:'end'};},
 });
 agent.subscribe(event=>{
  if(event.type==='message_start'&&(event.message.role==='assistant'||event.message.role==='toolResult')){messageId=randomUUID();deltaIndex=0;}
  if(event.type==='message_update'&&['text_delta','thinking_delta'].includes(event.assistantMessageEvent.type)){
   const delta=event.assistantMessageEvent;onProgress({type:delta.type,messageId,deltaIndex:deltaIndex++,messageIndex,message:publicModelMessage(event.message),delta:delta.delta});
  }
  if(event.type==='message_end'&&event.message.role==='assistant'){
   calls+=event.message.content.filter(c=>c.type==='toolCall').length;
   if(calls>maxToolCalls){fatal='Agent tool budget exceeded';agent.abort();}
  }
  if(event.type==='message_end'&&(event.message.role==='assistant'||event.message.role==='toolResult')){onProgress({type:'message_end',messageId,messageIndex,message:publicModelMessage(event.message)});messageIndex++;}
  if(event.type==='tool_execution_start')onProgress({type:event.type,toolCallId:event.toolCallId,name:event.toolName,args:event.args});
  if(event.type==='tool_execution_end'){if(event.isError){blocked++;if(session.mode&&!fatal)fatal='CAD tool execution failed: '+(event.result?.content?.filter(c=>c.type==='text').map(c=>c.text).join(' ')??'No diagnostic returned').slice(0,1600);}onProgress({type:event.type,toolCallId:event.toolCallId,name:event.toolName,isError:event.isError,result:event.result});}
 });
 const abort=()=>agent.abort();signal.addEventListener('abort',abort,{once:true});
 try{
  if(signal.aborted)throw signal.reason;
  await agent.prompt(JSON.stringify(currentInput));await agent.waitForIdle();
  if(signal.aborted)throw signal.reason;
  if(fatal)throw new Error(fatal);
  if(proposed)return undefined;
  if(!finished){
   const last=agent.state.messages.filter(m=>m.role==='assistant').at(-1);
   if(last?.stopReason==='error'||last?.stopReason==='aborted')throw new Error(describeModelFailure(last));
   if(!writeApplied&&blocked===0&&last?.stopReason==='stop')return undefined;
   const detail=last?.content?.filter?.(c=>c.type==='text').map(c=>c.text).join(' ')??'';
   throw new Error('Agent did not request successful cad_finish; no formal model committed. '+detail.slice(0,1000));
  }
  return finished;
 }finally{
  flush();
  signal.removeEventListener('abort',abort);
  const messages=agent.state.messages.filter(m=>m.role!=='system').slice(history.length).map(publicModelMessage);
  onTranscript({provider:provider.mode,toolCalls:calls,blockedCalls:blocked,rawCoercionsObserved:coercions,contextRevision:session.baseRevision,contextRevisions,historyRoundsIncluded:selection.included,historyRoundsOmitted:selection.omitted,messages,usage:messages.filter(m=>m.role==='assistant').map(m=>({...m.usage,cost:null}))});
 }
}
