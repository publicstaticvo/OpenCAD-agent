import {Agent} from '@earendil-works/pi-agent-core';
import {createModels,fauxProvider,fauxAssistantMessage,fauxToolCall,normalizeContext} from '@earendil-works/pi-ai';
import schema from '../shared/cad-schema.json' with {type:'json'};
import {assertContract,budgets} from '../shared/cad-contracts.ts';
import {createHash,randomUUID} from 'node:crypto';
import {describeModelFailure,publicModelMessage} from '../shared/model-errors.ts';
import {sourceToolSchemas} from './source-tools.ts';
function expand(s){
 if(Array.isArray(s))return s.map(expand);
 if(!s||typeof s!=='object')return s;
 if(s.$ref)return expand(schema.definitions[s.$ref]??schema[s.$ref]);
 return Object.fromEntries(Object.entries(s).map(([k,v])=>[k,expand(v)]));
}
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const toolsSchema={cad_inspect:object({}),cad_apply:object({operations:{type:'array',minItems:1,maxItems:256,items:expand(schema.operation)}}),cad_finish:object({criteria:expand(schema.criteria)})};
const planToolSchema=object({plan:expand(schema.plan)});
export const pythonToolSchemas={...sourceToolSchemas,cad_run:expand(schema.pythonRun)};
export const cadToolSchemas=toolsSchema;
export function pythonObservation(value,model){
 const image=value?.observation?.image;
 const visible=image?{...value,observation:{...value.observation,image:undefined},visualFeedback:model.input?.includes('image')?'image':'structured-only'}:value;
 return{content:[{type:'text',text:JSON.stringify(visible)},...(image&&model.input?.includes('image')?[{type:'image',mimeType:image.mimeType,data:image.data}]:[])],details:{}};
}
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
export function operationPlanningRules(){
 return `\nFor fully dimensioned single-part shapes beyond the legacy box/center-hole designs, use kind="operations" with goal, stages:[{name,sketchId,operations}], criteria:{bbox,volume,parameters?}. Compose actual create_body/create_sketch/add_geometry/add_constraint/pad/pocket/set_parameter operations. Each stage ends at a fully constrained sketch or a recomputed feature and identifies its actual sketchId. Use a separate stage for the sketch and for Pad/Pocket. At most 16 stages and 256 total operations. Only planar lines/circles and existing named constraints are supported. No new operation types. Do not use the old fixed box plan to approximate a nonrectangular part. For edits use actual stable IDs, parameters and operationModel from cad_inspect; preserve existing features. General edits require a previously verified operation history. Compute criteria from the requested actual geometry. ${cadInstructions.split('\n').slice(1).join('\n')}`;
}
function strictTool(name,args,python=false,pythonPlanning=false){
 if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('Raw tool arguments must be an object');
 if(pythonPlanning&&name==='cad_plan'){if(Object.keys(args).join(',')!=='plan'||!args.plan||Object.keys(args.plan).join(',')!=='goal'||typeof args.plan.goal!=='string'||!args.plan.goal.trim()||args.plan.goal.length>8000)throw new Error('Python plan requires goal');return;}
 const definition=python?pythonToolSchemas[name]:name==='cad_plan'?planToolSchema:toolsSchema[name];
 if(!definition)throw new Error('Unknown CAD tool');
 if(python){
  if(name==='cad_run'){assertContract('pythonRun',args);return;}
  if(['read','write','edit'].includes(name)){
   if(typeof args.path!=='string'||args.path.startsWith('/')||args.path.split('/').some(part=>!part||part==='.'||part==='..')||Object.keys(args).some(key=>!Object.hasOwn(definition.properties,key)))throw new Error('Project tools accept safe relative file paths only');
   return;
  }
  if(name==='cad_files'){
   if(!['list','mkdir','delete','move','set_entrypoint'].includes(args.operation))throw new Error('Unsupported project file operation');
   const required=args.operation==='list'?['operation']:args.operation==='move'?['operation','path','destination']:['operation','path'];
   if(Object.keys(args).sort().join('|')!==required.sort().join('|'))throw new Error('Invalid project file operation fields');
   return;
  }
 }
 const keys=Object.keys(definition.properties);
 if(Object.keys(args).length!==keys.length||keys.some(k=>!Object.hasOwn(args,k)))throw new Error('Raw tool fields rejected');
 if(name==='cad_apply'){
  if(!Array.isArray(args.operations)||!args.operations.length||args.operations.length>256)throw new Error('Invalid operations count');
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
function explicitSourceOnly(task){
 return /(?:不要|不必|不需要|暂不|暂时不要|禁止|不).{0,8}(?:执行|运行)|(?:执行|运行).{0,8}(?:不要|暂不)|(?:只|仅).{0,8}(?:保存|编写|修改).{0,8}(?:源码|脚本|代码)|(?:只|仅|仅供).{0,8}(?:诊断|只读|分析)|read[- ]only|diagnostic\s+analysis\s+only|(?:without|do not|don't|dont).{0,12}(?:run|execute)|save\s+only/i.test(task);
}
function taskRequestsModel(task){
 return !explicitSourceOnly(task)&&/(?:创建|建模|生成模型|修改模型|运行模型|执行脚本|验证模型|做一个|做一块|做一根|画一个|画一块|绘制|构造|create|build|model|modify|run|execute|verify)/i.test(task);
}
function taskRequestsExecution(task){
 return !explicitSourceOnly(task)&&/(?:执行|运行|run|execute)/i.test(task);
}
function explicitPreviewOnly(task){return /(?:只|仅).{0,8}(?:预览|检查|观察)|(?:不要|不需要|不必).{0,6}(?:正式)?提交|preview\s+only/i.test(task);}
/** Provider is explicitly injected. Never reads personal auth or environment credentials. */
export async function runPiLoop({task,session,signal,provider,maxToolCalls=budgets.maxToolCalls,onProgress=()=>{},onTranscript=()=>{}}){
 let finished=null,proposed=false,fatal=null,writeApplied=false,pythonSubmitted=false,sourceEdited=false,calls=0,turns=0,blocked=0,coercions=0;
 const planning=session.mode==='planning';
 const python=session.mode==='python';
 const pythonPlanning=planning&&session.pythonPlanning;
 const instructions=cadInstructions+(session.plan?`\nThis task has an immutable approved plan and a finite operation contract below. Inspect first. Use exactly one cad_apply per contract stage in the stated order. Produce the actual tool arguments yourself, using the geometry and dimension references in the contract. Names of nondimensional constraints can differ. Never combine stages or repeat a successful stage. No other operations or automatic repair are permitted. cad_finish must use the approved criteria exactly. Approval: ${JSON.stringify(session.plan)}\nStage contracts: ${JSON.stringify(session.stages)}`:'');
 const initial=await session.snapshot();
 const operationPlanning=operationPlanningRules();
 const runtimeInstructions=planning?`You are a read-only CAD planning Agent. No CAD writes before approval. Use cad_inspect to inspect current model. Use cad_plan once for a supported fully specified design. Supported: create_box(length,width,height), add_hole(diameter), edit_hole(diameter), pin_plate_assembly(assembly:{length,width,thickness,holeDiameter,pinDiameter,pinLength}), edit_pin_plate_assembly(assembly:{length,width,thickness,holeDiameter,pinDiameter,pinLength}). The assembly is exactly one rectangular plate with a centered through hole and one cylindrical pin, quantity one each; plate grounded, pin fixed coaxially at [length/2,width/2,0], no rotation. When cad_inspect shows an existing Assembly::AssemblyObject, never use create_box, add_hole or edit_hole. A request to change the pin diameter must use edit_pin_plate_assembly and repeat every unchanged assembly dimension, changing only pinDiameter. A new pin_plate_assembly requires an empty project. All dimensions in mm. Ask for missing essential dimensions; never invent dimensions or infer permission for different parts/relations. Unsupported design or greetings require an honest text reply without cad_plan. Do not claim execution.`:session.plan?.kind==='pin_plate_assembly'?`Create the approved real two-part assembly using only supplied tools. Units mm. Inspect first. Use one cad_apply for each approved write stage in order: plate, pin, assemble. Each operation has {op:"assembly_stage",stage,design} with exactly approvedPlan.assembly. Then use the final approved stage operation {op:"assembly_check",design} for read-only geometric verification. No other operations, changed dimensions, parts, repairs, or joint changes. cad_finish must use approved criteria exactly and cannot publish. Tools operate on a private candidate. Report errors honestly. Approved plan: ${JSON.stringify(session.plan)}. Approved stages: ${JSON.stringify(session.stages)}`:session.plan?.kind==='edit_pin_plate_assembly'?`Modify only the approved pin diameter in the existing real two-part assembly. Use exactly one cad_apply operation {op:"assembly_stage",stage:"pin_edit",design} with the complete approved assembly dimensions, then one read-only {op:"assembly_check",design}. Preserve the plate, hole, pin length, position, axis and fixed relation. Do not rebuild or add components. cad_finish must use the approved criteria exactly and cannot publish. Approved plan: ${JSON.stringify(session.plan)}. Approved stages: ${JSON.stringify(session.stages)}`:instructions;
 const systemInstructions=runtimeInstructions+(planning?operationPlanning:session.plan?.kind==='operations'?'\nEvery operation, including constraint names, must exactly match the approved ordered stages. No reordered operations or extra repairs.':'');
 const finalSystemInstructions=python?`You create CAD through an editable Python project. Start by listing project files and reading the entrypoint or relevant existing modules.
Classify the user's request before choosing file edits: a new independent design gets a descriptive new Python entrypoint, an independent reusable capability gets a new module with necessary import integration, and a modification or repair edits its relevant existing files. Preserve unrelated file contents. Use write to create paths that do not yet exist. For an independent entrypoint, select it with cad_files set_entrypoint and use the exact resulting project version for execution. Explain any required restructuring of existing files in the user-visible response.
Use read/write/edit for files and cad_files for directories, moves, removal, listing, and entrypoint selection. Every source edit saves an immutable whole-project version and returns exact per-file differences; editing never runs FreeCAD. Ask for missing dimensions before inventing them. When source is ready, call cad_run with the exact sourceVersionId and sourceHash from the latest file operation. It executes that frozen project in isolated bundled FreeCAD, checks document health, independently reopens FCStd, verifies STEP by reimport, and creates GLB and PNG observations. The structured report and image are returned from cad_run when the configured model protocol accepts images. Use observations to edit and run another version when needed. Successful execution creates a candidate that waits for user acceptance or rejection. You cannot publish a formal revision. Errors include phase and source location. The existing formal FCStd, if present, is read-only at /input/base.FCStd. The frozen project is read-only during execution; network and subprocess access are blocked. Do not claim acceptance or publication without Gateway confirmation.`:systemInstructions;
 const pythonState=python?await session.inspect():null;
 const effectiveInstructions=pythonPlanning?'You are planning a Python FreeCAD modeling task at the user\'s explicit request. No source edits or FreeCAD execution before user approval. Inspect actual formal state when relevant. Ask for missing essential dimensions. Submit cad_plan with plan.goal describing the requested dimensions, modeling approach, checks and intended source changes. Do not impose a fixed geometry template. Approval authorizes this plan for the subsequent Python project task; a verified candidate still waits for separate user acceptance.':finalSystemInstructions;
 const currentInput={task,phase:session.mode,approvedPlan:session.plan,documentId:initial.documentId,revision:initial.revision,features:initial.tree,operationModel:initial.validation?.operationModel,...(python?{python:{sourceVersionId:pythonState.source?.versionId??null,sourceHash:pythonState.source?.sourceHash??null,entrypoint:pythonState.source?.project.entrypoint??'',files:pythonState.source?Object.keys(pythonState.source.project.files):[]},executionLimits:{projectBytes:4194304,addressSpaceBytes:4294967296,cpuSeconds:300,threads:64,outputBytes:268435456,network:false,subprocesses:false}}: {})};
 const inputBudget=(provider.model.contextWindow??262144)-(provider.model.maxTokens??16384)-8192;
 const budget=inputBudget-Buffer.byteLength(effectiveInstructions+JSON.stringify(toolsSchema)+JSON.stringify(currentInput).repeat(2));
 if(budget<0)throw new Error('Current CAD input exceeds configured context budget');
 const selection=selectHistory(session.history??[],budget),history=selection.messages;
 let messageIndex=0,messageId='',deltaIndex=0;
 const emit=onProgress;let pending=null,flushTimer;
 const flush=()=>{clearTimeout(flushTimer);flushTimer=undefined;if(pending){emit(pending);pending=null;}};
 onProgress=event=>{if(event.type==='text_delta'||event.type==='thinking_delta'){if(pending&&(pending.messageId!==event.messageId||pending.type!==event.type))flush();pending={...event,delta:(pending?.delta??'')+event.delta};if(!flushTimer)flushTimer=setTimeout(flush,100);}else{flush();emit(event);}};
 const approved=new Map(),seen=new Set(),contextRevisions=[];
 const result=value=>pythonObservation(value,provider.model);
 const definitions=python?pythonToolSchemas:planning?{cad_inspect:toolsSchema.cad_inspect,cad_plan:pythonPlanning?object({plan:object({goal:{type:'string',minLength:1,maxLength:8000}})}):planToolSchema}:toolsSchema;
 const tools=Object.keys(definitions).map(name=>({name,label:name,description:python&&session.sourceTools?.[name]?session.sourceTools[name].description+' Paths are relative to this project. Every edit saves a whole-project source version and per-file differences without execution.':name==='cad_run'?'Execute this exact immutable project version and hash. Automatically returns FreeCAD health, independent reopen, STEP verification, GLB and PNG observations. Successful candidates await user acceptance.':name==='cad_inspect'?'Read actual current CAD state.':name==='cad_plan'?'Propose a structured design for user approval. No CAD execution.':name==='cad_apply'?'Apply restricted editable CAD operations to this task candidate. No code or paths.':'Request deterministic validation of final dimensions, volume and parameters. Does not itself publish HEAD.',parameters:definitions[name],execute:async(id)=>{
  const args=approved.get(id);approved.delete(id);if(!args)throw new Error('Raw approval missing');strictTool(name,args,python,pythonPlanning);
  if(signal.aborted)throw signal.reason;
  if(python&&['read','write','edit','cad_files'].includes(name)){const value=await session.sourceTools[name].execute(id,args,signal);if(name!=='read'&&!(name==='cad_files'&&args.operation==='list'))sourceEdited=true;return value;}
  if(python&&name==='cad_run'){pythonSubmitted=true;const value=await session.run(args);writeApplied=writeApplied||value.status==='valid';return result(value);}
  if(name==='cad_inspect')return result(await session.inspect());
  if(name==='cad_plan'){const plan=await session.propose(args.plan);proposed=true;return result({awaitingUserApproval:true,plan});}
  if(name==='cad_apply'){const value=await session.apply(args.operations,createHash('sha256').update(id).digest('hex'));writeApplied=writeApplied||args.operations.length>0;return result(value);}
  const validation=await session.prepare(args.criteria);finished=args.criteria;return result({validated:true,validation,publication:'Gateway pending'});
 }}));
 const agent=new Agent({initialState:{model:provider.model,tools,systemPrompt:effectiveInstructions,messages:history},streamFn:provider.streamFn,toolExecution:'sequential',
  prepareRequest:async({context})=>{
   const latest=await session.snapshot();contextRevisions.push(latest.revision);
   if(latest.revision!==session.baseRevision){fatal='Revision conflict before next provider request';agent.abort();return;}
   const marker='[Gateway current formal snapshot]';
   const messages=context.messages.filter(m=>!(m.role==='user'&&typeof m.content==='string'&&m.content.startsWith(marker)));
   const next={...context,messages:[...messages,{role:'user',content:marker+JSON.stringify({documentId:latest.documentId,revision:latest.revision,features:latest.tree,operationModel:latest.validation?.operationModel}),timestamp:Date.now()}]};
   if(Buffer.byteLength(effectiveInstructions+JSON.stringify(definitions)+JSON.stringify(next.messages))>inputBudget){fatal='CAD conversation exceeds configured context budget';agent.abort();return;}
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
    strictTool(toolCall.name,raw,python,pythonPlanning);
    approved.set(toolCall.id,structuredClone(raw));
   }catch(e){if(session.mode&&!python){fatal=e.message;return{block:true,reason:e.message,terminate:true};}return{block:true,reason:e.message};}
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
  if(event.type==='tool_execution_end'){if(event.isError){blocked++;if(session.mode&&!python&&!fatal)fatal='CAD tool execution failed: '+(event.result?.content?.filter(c=>c.type==='text').map(c=>c.text).join(' ')??'No diagnostic returned').slice(0,1600);}onProgress({type:event.type,toolCallId:event.toolCallId,name:event.toolName,isError:event.isError,result:event.result});}
 });
 const abort=()=>agent.abort();signal.addEventListener('abort',abort,{once:true});
 try{
  if(signal.aborted)throw signal.reason;
  await agent.prompt(JSON.stringify(currentInput));await agent.waitForIdle();
  if(python&&!pythonSubmitted&&(sourceEdited&&taskRequestsModel(task)||pythonState.source&&taskRequestsExecution(task))&&!fatal&&!signal.aborted){
   await agent.prompt('The user requested a CAD result. The project source is saved, but no FreeCAD execution has occurred. Use cad_run with the exact saved project version and hash. Inspect its observations and explain any failure. Saving source alone does not fulfill this request.');await agent.waitForIdle();
   if(!pythonSubmitted&&!fatal)throw new Error('ModelDidNotExecute: Agent did not execute the requested CAD task. Project source and conversation are preserved; no candidate was produced.');
  }
  if(signal.aborted)throw signal.reason;
  if(fatal)throw new Error(fatal);
  if(proposed)return undefined;
  if(python){
   const last=agent.state.messages.filter(m=>m.role==='assistant').at(-1);
   if(last?.stopReason==='error'||last?.stopReason==='aborted')throw new Error(describeModelFailure(last));
   return undefined;
  }
  if(!finished){
   const last=agent.state.messages.filter(m=>m.role==='assistant').at(-1);
   if(last?.stopReason==='error'||last?.stopReason==='aborted')throw new Error(describeModelFailure(last));
   if(python&&last?.stopReason==='stop')return undefined;
   if((python||!writeApplied&&!pythonSubmitted&&blocked===0)&&last?.stopReason==='stop'&&!finished)return undefined;
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
