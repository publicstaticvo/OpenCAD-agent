/** Real service/HTTP/browser/native CAD audit; all evidence is kept in a private isolated directory. */
import {DatabaseSync,backup} from 'node:sqlite';
import {cpSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chromium,expect} from '@playwright/test';
import {_iterSSEMessages} from 'openai/core/streaming';
import {createGateway} from '../gateway/server.ts';
import {readModelYaml} from '../gateway/model-config.ts';
import {evaluationProvider} from '../gateway/eval-provider.mjs';
import {runTextJob,type TextRunner} from '../gateway/agent.ts';
import {cadToolSchemas} from '../gateway/pi-adapter.mjs';

if(process.env.RUN_LIVE_CAD!=='1')throw new Error('Set RUN_LIVE_CAD=1 for actual model requests');
const input=readModelYaml(resolve(process.argv[2]??'model.yaml'));
if(input.protocol!=='openai-completions')throw new Error('This boundary audit requires the failing Chat Completions configuration');
const sourceRoot=resolve(process.argv[3]??'.work/live-data-1793100866384');
const recheck=process.env.CAD_BOUNDARY_RECHECK;
const output=recheck?resolve(recheck):mkdtempSync(resolve('.work/model-boundaries-'));
const save=(name:string,value:unknown)=>writeFileSync(join(output,name),JSON.stringify(value,null,2).split(input.apiKey).join('[REDACTED]')+'\n',{mode:0o600});
if(!recheck){
 const source=new DatabaseSync(join(sourceRoot,'store.sqlite'),{readOnly:true});
 try{await backup(source,join(output,'store.sqlite'));}finally{source.close();}
 cpSync(join(sourceRoot,'revisions'),join(output,'revisions'),{recursive:true});
}
const traces:any[]=recheck?JSON.parse(readFileSync(join(output,'wire.json'),'utf8')):[],captures:Promise<void>[]=[],executions:any[]=recheck?JSON.parse(readFileSync(join(output,'executions.json'),'utf8')):[];
const transport=async(request:Request)=>{
 const entry:any={request:await request.clone().json(),events:[],startedAt:new Date().toISOString()};traces.push(entry);
 const response=await fetch(request,{redirect:'error'});entry.status=response.status;
 const copy=response.clone();
 if(response.ok)captures.push((async()=>{
  try{for await(const event of _iterSSEMessages(copy,new AbortController()))if(event.data&&event.data!=='[DONE]')entry.events.push(JSON.parse(event.data));}
  catch(error){entry.streamError=(error as Error).name;}
  finally{entry.finishedAt=new Date().toISOString();save('wire.json',traces);}
 })());
 return response;
};
const provider=evaluationProvider({provider:{...input,contextWindow:262144,maxTokens:16384}},input.apiKey,undefined,{transport});
const runner:TextRunner=Object.assign(async(job:any,session:any,signal:AbortSignal)=>{
 const wrapped={...session};
 for(const name of ['inspect','apply','prepare'])wrapped[name]=async(...args:any[])=>{
  const execution:any={name,args:structuredClone(args)};executions.push(execution);
  try{const result=await session[name](...args);execution.result=structuredClone(result);return result;}
  catch(error){execution.error=(error as Error).message;throw error;}
 };
 return runTextJob(job,wrapped,signal,provider);
},{mode:'live' as const});
const token='actual-model-boundary-audit-0123456789';
const app=await createGateway({dataDir:output,accessToken:token,port:0,textRunner:runner});
console.log(JSON.stringify({output,phase:recheck?'verifying-captured-run':'running-real-model'}));
try{
 const previous=app.store.db.prepare("SELECT job FROM jobs WHERE status='failed' ORDER BY rowid DESC LIMIT 1").get() as any;
 if(!previous)throw new Error('Source must contain an actual failed task');
 const original=JSON.parse(previous.job),documentId=original.documentId,conversationId=original.conversationId;
 const captured=recheck?JSON.parse(readFileSync(join(output,'job.json'),'utf8')):undefined;
 const before={...app.store.snapshot(documentId),...(captured?{revision:captured.baseRevision}:{})},operationId=captured?.operationId??randomUUID(),hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
 const names=['model.FCStd','model.step','preview.glb'];
 const beforeHashes=Object.fromEntries(names.map(name=>[name,hash(readFileSync(app.store.artifactPath(documentId,before.revision,name)))]));
 const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
 if(!recheck){
  const accepted=await fetch(`${app.baseUrl}/api/documents/${documentId}/jobs`,{method:'POST',headers,body:JSON.stringify({operationId,conversationId,baseRevision:before.revision,text:original.request.text})});
  expect(accepted.status).toBe(202);
 }
 const job=recheck?app.supervisor.job(documentId,operationId):await app.supervisor.waitForJob(documentId,operationId);
 await Promise.all(captures);save('wire.json',traces);save('executions.json',executions);save('job.json',job);
 const assistants=job.agent?.messages.filter((m:any)=>m.role==='assistant')??[];
 expect(traces.length).toBeGreaterThan(0);expect(assistants.length).toBe(traces.length);
 const rawCalls:any[]=[];
 for(const [index,entry] of traces.entries()){
  expect(entry.status).toBe(200);expect(entry.request.model).toBe(input.model);expect(entry.request.stream).toBe(true);
  expect(entry.request.tools.map((tool:any)=>tool.function.name)).toEqual(['cad_inspect','cad_apply','cad_finish']);
  for(const tool of entry.request.tools)expect(tool.function.parameters).toEqual(cadToolSchemas[tool.function.name as keyof typeof cadToolSchemas]);
  expect(entry.request.messages.some((m:any)=>m.role==='system'&&m.content.includes('You create editable CAD'))).toBe(true);
  const userTexts=entry.request.messages.filter((m:any)=>m.role==='user').map((m:any)=>typeof m.content==='string'?m.content:m.content.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join(''));
  const inputs=userTexts.filter((text:string)=>text.startsWith('{')).map((text:string)=>JSON.parse(text));
  expect(inputs.some((value:any)=>value.task===original.request.text&&value.documentId===documentId&&value.revision===before.revision)).toBe(true);
  const calls=new Map<number,any>();let text='',thinking='';
  for(const event of entry.events)for(const choice of event.choices??[]){
   if(choice.index!==0)continue;
   const delta=choice.delta??{};if(typeof delta.content==='string')text+=delta.content;
   thinking+=['reasoning_content','reasoning','reasoning_text'].map(field=>delta[field]).find(value=>typeof value==='string'&&value.length>0)??'';
   for(const part of delta.tool_calls??[]){
    const call=calls.get(part.index)??{id:'',name:'',arguments:''};
    if(part.id)call.id=part.id;if(part.function?.name)call.name+=part.function.name;
    call.arguments+=part.function?.arguments??'';calls.set(part.index,call);
   }
  }
  const parsed=assistants[index];
  expect(parsed.content.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('')).toBe(text);
  expect(parsed.content.filter((c:any)=>c.type==='thinking').map((c:any)=>c.thinking).join('')).toBe(thinking);
  const actual=parsed.content.filter((c:any)=>c.type==='toolCall');
  expect(actual.length).toBe(calls.size);
  for(const [callIndex,call] of [...calls.values()].entries()){
   const args=JSON.parse(call.arguments);
   expect(actual[callIndex].id).toBe(call.id);expect(actual[callIndex].name).toBe(call.name);
   expect(actual[callIndex].arguments).toEqual(args);rawCalls.push({...call,arguments:args});
  }
  // Tool results sent back to the service must be the exact results persisted by Pi.
  for(const message of entry.request.messages.filter((m:any)=>m.role==='tool')){
   const result=job.agent.messages.find((m:any)=>m.role==='toolResult'&&m.toolCallId===message.tool_call_id);
   expect(result).toBeDefined();
   expect(message.content).toBe(result.content.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n'));
  }
 }
 for(const execution of executions){
  const tool=execution.name==='inspect'?'cad_inspect':execution.name==='apply'?'cad_apply':'cad_finish';
  expect(rawCalls.some(call=>call.name===tool&&JSON.stringify(call.arguments)===JSON.stringify(execution.name==='inspect'?{}:execution.name==='apply'?{operations:execution.args[0]}:{criteria:execution.args[0]}))).toBe(true);
  if(!execution.error){
   const expected=execution.name==='prepare'?{validated:true,validation:execution.result,publication:'Gateway pending'}:execution.result;
   expect(job.agent.messages.some((m:any)=>m.role==='toolResult'&&!m.isError&&m.content.some((c:any)=>c.type==='text'&&c.text===JSON.stringify(expected)))).toBe(true);
  }else expect(job.agent.messages.some((m:any)=>m.role==='toolResult'&&m.isError&&m.content.some((c:any)=>c.type==='text'&&c.text.includes(execution.error)))).toBe(true);
 }
 const after=app.store.snapshot(documentId);
 if(job.status!=='committed'){
  expect(after.revision).toBe(before.revision);
  for(const name of names)expect(hash(readFileSync(app.store.artifactPath(documentId,after.revision,name)))).toBe(beforeHashes[name]);
 }else{
  expect(after.revision).toBe(before.revision+1);
  const saved=JSON.parse(readFileSync(app.store.artifactPath(documentId,after.revision,'criteria.json'),'utf8'));
  const finish=rawCalls.filter(call=>call.name==='cad_finish').at(-1);
  expect(finish).toBeDefined();expect(finish.arguments.criteria).toEqual(saved);
 }
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE??'/opt/google/chrome/chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 let alert='';
 try{
  const page=await browser.newPage();await page.addInitScript(value=>sessionStorage.setItem('cad-access-token',value),token);
  await page.goto(`${app.baseUrl}/?document=${documentId}&conversation=${conversationId}`);await page.waitForLoadState('networkidle');
  const card=page.locator(`[data-job-id="${operationId}"]`);
  await expect(card).toHaveAttribute('data-status',job.status);await expect(card).toContainText(original.request.text);
  const expectedTexts=assistants.map((m:any)=>m.content.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join(' '));
  expect(await card.locator('.assistant-message').allTextContents()).toEqual(expectedTexts);
  if(job.error){alert=await card.getByTestId('job-error').innerText();expect(alert).toContain('正式模型未改变');await card.getByText('技术详情',{exact:true}).click();await expect(card).toContainText(job.error);}
  for(const [index,label] of ['FCStd','STEP','GLB'].entries()){
   const pending=page.waitForEvent('download');await page.getByRole('button',{name:`下载 ${label}`,exact:true}).click();
   const download=await pending;const target=join(output,'download.'+label);await download.saveAs(target);
   expect(hash(readFileSync(target))).toBe(hash(readFileSync(app.store.artifactPath(documentId,after.revision,names[index]))));
  }
  await page.reload();await page.waitForLoadState('networkidle');
  expect(await card.locator('.assistant-message').allTextContents()).toEqual(expectedTexts);
  await page.screenshot({path:join(output,'workspace.png'),fullPage:true});
 }finally{await browser.close();}
 // Reopen actual downloaded FCStd/STEP/GLB with the verified native FreeCAD runtime.
 const native=execFileSync('python',['scripts/verify-saved-artifacts.py',join(output,'download.FCStd'),join(output,'download.STEP'),join(output,'download.GLB'),app.store.artifactPath(documentId,after.revision,'criteria.json')],{encoding:'utf8',timeout:30000});
 expect(native).toContain('saved-artifacts: passed');
 const result={passed:true,output,status:job.status,error:job.error??null,requests:traces.length,toolCalls:rawCalls.length,executedTools:executions.length,checks:{promptAndToolsTransmitted:true,rawTextMatchesTranscript:true,rawArgumentsMatchParsed:true,toolResultsMatchNextRequest:true,cadExecutionMatchesArguments:true,browserTextMatchesTranscriptAfterRefresh:true,downloadsMatchFormalFiles:true,nativeSavedArtifactsValid:true,formalRevisionBefore:before.revision,formalRevisionAfter:after.revision},alert};
 save('result.json',result);console.log(JSON.stringify(result,null,2));
}catch(error){save('audit-error.json',{message:(error as Error).message});throw error;}
finally{await app.close();}
