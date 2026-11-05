import {test,expect} from 'vitest';
import {mkdirSync,mkdtempSync,readFileSync,existsSync} from 'node:fs';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {SourceVersions} from '../gateway/source-versions.ts';
import {createGateway} from '../gateway/server.ts';
import {runTextJob,type TextRunner} from '../gateway/agent.ts';
import {makeFauxProvider} from '../gateway/pi-adapter.mjs';

const token='source-version-local-test-token';
const source="import FreeCAD as App, Part\ndoc=App.newDocument('Model')\nobj=doc.addObject('PartDesign::Feature','Box')\nobj.Shape=Part.makeBox(20,30,40)\ndoc.recompute()\n";
function directory(){mkdirSync('.work/source-execution-phase-1-2',{recursive:true});return mkdtempSync(resolve('.work/source-execution-phase-1-2/gateway-'));}
function runner(turn:(index:number,state:any)=>any,captured:any[]=[]):TextRunner{
 let index=0;return Object.assign(async(job:any,session:any,signal:AbortSignal)=>{
  const provider=makeFauxProvider([]);provider.streamFn=async(...args:any[])=>{captured.push(args[1]);const state=await session.inspect();return makeFauxProvider([turn(index++,state)]).streamFn(...args);};
  return runTextJob(job,session,signal,provider);
 },{mode:'live'}) as TextRunner;
}
test('explicit Python plan approval performs no source edits before approval and repeated approval never replays execution',async()=>{
 const app=await createGateway({dataDir:directory(),accessToken:token,port:0,textRunner:runner((index,state)=>index===0?{calls:[{name:'cad_plan',args:{plan:{goal:'Create one 20×30×40 mm solid with FreeCAD Python, verify volume 24000 mm³ and preserve unrelated project files.'}}}]}:index===1?{calls:[{name:'write',args:{path:'script.py',content:source}}]}:index===2?{calls:[{name:'cad_run',args:{sourceVersionId:state.source.versionId,sourceHash:state.source.sourceHash,criteria:{bbox:[20,30,40],volume:24000}}}]}:{text:'Candidate ready for user acceptance.'})});
 try{app.store.createDocument('project');app.supervisor.submitText('project',0,'approved','创建一个20×30×40 mm长方体，等待我批准后再建模');const planned=await app.supervisor.waitForJob('project','approved');expect(planned.error).toBeNull();expect(planned.status).toBe('awaiting_approval');expect(planned.plan?.kind).toBe('python');expect(new SourceVersions(app.store).head('project')).toBeNull();expect(app.store.events('project',0).filter(event=>event.type==='python_execution')).toHaveLength(0);
  app.supervisor.approveJob('project','approved',planned.plan!.planHash);const completed=await app.supervisor.waitForJob('project','approved');expect(completed.error).toBeNull();expect(completed.status).toBe('awaiting_acceptance');app.supervisor.approveJob('project','approved',planned.plan!.planHash);expect(app.store.events('project',0).filter(event=>event.type==='python_execution'&&(event.data as any).status==='running')).toHaveLength(1);expect(app.store.snapshot('project').revision).toBe(0);
 }finally{await app.close();}
},20000);
test.each(['创建长方体的源码，只做诊断分析，不要启动执行','创建模型的脚本，仅供只读检查','Create model source for diagnostic analysis only'])('source-only Agent task has no execution: %s',async(text)=>{
 const app=await createGateway({dataDir:directory(),accessToken:token,port:0,textRunner:runner(index=>index===0?{calls:[{name:'write',args:{path:'script.py',content:source}}]}:{text:'Source saved for inspection.'})});
 try{app.store.createDocument('project');app.supervisor.submitText('project',0,'source-only',text);const job=await app.supervisor.waitForJob('project','source-only');expect(job.error).toBeNull();expect(job.status).toBe('answered');expect(app.store.events('project',0).filter(event=>event.type==='python_execution')).toHaveLength(0);expect(app.store.snapshot('project').revision).toBe(0);}finally{await app.close();}
},15000);
test.each([false,true])('Agent executes requested CAD with reminder=%s and candidate waits for user acceptance',async(reminder)=>{
 const captured:any[]=[];
 const app=await createGateway({dataDir:directory(),accessToken:token,port:0,textRunner:runner((index,state)=>index===0?{calls:[{name:'write',args:{path:'script.py',content:source}}]}:reminder&&index===1?{text:'Source ready.'}:index===(reminder?2:1)?{calls:[{name:'cad_run',args:{sourceVersionId:state.source.versionId,sourceHash:state.source.sourceHash,criteria:{bbox:[20,30,40],volume:24000}}}]}:{text:'Model checks received.'},captured)});
 try{
  app.store.createDocument('project');app.supervisor.submitText('project',0,'model','创建一个 20×30×40 mm 长方体并执行验证');const job=await app.supervisor.waitForJob('project','model');expect(job.error).toBeNull();expect(job.status).toBe('awaiting_acceptance');expect(app.store.snapshot('project').revision).toBe(0);
  expect(job.agent.messages.filter((message:any)=>message.role==='toolResult').map((message:any)=>message.toolName)).toEqual(['write','cad_run']);
  expect(app.store.events('project',0).filter(event=>event.type==='python_execution'&&(event.data as any).status==='valid')).toHaveLength(1);
  const response=await fetch(app.baseUrl+'/api/documents/project/jobs/model/accept',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}'});expect(response.status).toBe(200);
  const snapshot=app.store.snapshot('project');expect(snapshot.validation.bbox).toEqual([20,30,40]);expect(snapshot.validation.userAcceptance.executionId).toBe(job.result.executionId);
  for(const name of ['model.FCStd','model.step','preview.glb','project.json'])expect(readFileSync(app.store.artifactPath('project',1,name)).length).toBeGreaterThan(0);
  const names=captured[0].messages.filter((message:any)=>message.role==='system').flatMap((message:any)=>message.toolsAdded??[]).map((tool:any)=>tool.name).sort();expect(names).toEqual(['cad_files','cad_run','edit','read','write']);
  if(reminder)expect(JSON.stringify(captured)).toContain('no FreeCAD execution has occurred');
 }finally{await app.close();}
},20000);
test.each(['执行刚才保存的源码版本，检查包围盒20×30×40 mm','运行刚才保存的工程，确认模型有效'])('existing source executes after an explicit request without an edit: %s',async(text)=>{
 const captured:any[]=[];
 const app=await createGateway({dataDir:directory(),accessToken:token,port:0,textRunner:runner((index,state)=>index===0?{text:'The source is ready.'}:index===1?{calls:[{name:'cad_run',args:{sourceVersionId:state.source.versionId,sourceHash:state.source.sourceHash,criteria:{bbox:[20,30,40],volume:24000}}}]}:{text:'Actual geometry checks received.'},captured)});
 try{
  app.store.createDocument('project');const saved=new SourceVersions(app.store).save('project',{source,parentVersionId:null,actor:'user'});
  app.supervisor.submitText('project',0,'existing-run',text);const job=await app.supervisor.waitForJob('project','existing-run');expect(job.error).toBeNull();expect(job.status).toBe('awaiting_acceptance');
  expect(job.agent.messages.filter((message:any)=>message.role==='toolResult').map((message:any)=>message.toolName)).toEqual(['cad_run']);expect(job.result.sourceVersionId).toBe(saved.versionId);expect(job.candidateSnapshot.geometry.bbox).toEqual([20,30,40]);expect(app.store.snapshot('project').revision).toBe(0);expect(JSON.stringify(captured)).toContain('no FreeCAD execution has occurred');
 }finally{await app.close();}
},20000);
test('unexecuted CAD request reports failure and preserves source and transcript',async()=>{
 const app=await createGateway({dataDir:directory(),accessToken:token,port:0,textRunner:runner(index=>index===0?{calls:[{name:'write',args:{path:'script.py',content:source}}]}:{text:'Only source was saved.'})});
 try{app.store.createDocument('project');app.supervisor.submitText('project',0,'no-run','Create a box');const job=await app.supervisor.waitForJob('project','no-run');expect(job.status).toBe('failed');expect(job.error).toContain('ModelDidNotExecute');expect(job.agent.messages.some((message:any)=>message.role==='assistant')).toBe(true);expect(new SourceVersions(app.store).head('project')?.source).toBe(source);expect(app.store.snapshot('project').revision).toBe(0);}finally{await app.close();}
},10000);
for(const acceptance of ['failed','not-run'] as const)test(`Agent receives native ${acceptance} geometry acceptance status`,async()=>{
 const app=await createGateway({dataDir:directory(),accessToken:token,port:0,textRunner:runner((index,state)=>index===0?{calls:[{name:'write',args:{path:'script.py',content:source}}]}:index===1?{calls:[{name:'cad_run',args:{sourceVersionId:state.source.versionId,sourceHash:state.source.sourceHash,...(acceptance==='failed'?{criteria:{bbox:[20,31,40],volume:24800}}:{})}}]}:{text:'Execution observations received.'})});
 try{app.store.createDocument('project');app.supervisor.submitText('project',0,'diagnostic','Create the requested box');const job=await app.supervisor.waitForJob('project','diagnostic');expect(job.status).toBe(acceptance==='failed'?'failed':'awaiting_acceptance');const row=app.store.db.prepare('SELECT record FROM python_executions WHERE operation_id=?').get('diagnostic') as any;expect(JSON.parse(row.record).result.acceptanceStatus).toBe(acceptance);expect(app.store.snapshot('project').revision).toBe(0);}finally{await app.close();}
},15000);
test('Gateway restart interrupts native execution and preserves formal artifacts',async()=>{
 const dataDir=directory();let app=await createGateway({dataDir,accessToken:token,port:0});app.store.createDocument('project');const saved=new SourceVersions(app.store).save('project',{source,parentVersionId:null,actor:'user'});
 app.supervisor.submitPython('project',0,'initial',{kind:'run',run:{sourceVersionId:saved.versionId,sourceHash:saved.sourceHash}});expect((await app.supervisor.waitForJob('project','initial')).status).toBe('awaiting_acceptance');app.supervisor.acceptCandidate('project','initial');
 const original=createHash('sha256').update(readFileSync(app.store.artifactPath('project',1,'model.FCStd'))).digest('hex');await app.close();
 const child=fork(resolve('tests/helpers/source-execution-crash.ts'),[dataDir],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc']});let errors='';child.stderr?.on('data',data=>{errors+=String(data);});
 try{const started=await new Promise<any>((accept,reject)=>{const timer=setTimeout(()=>reject(new Error('Native child startup timeout: '+errors)),15000);child.once('message',message=>{clearTimeout(timer);accept(message);});child.once('exit',code=>{clearTimeout(timer);reject(new Error('Native child exited: '+code+' '+errors));});});const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  app=await createGateway({dataDir,accessToken:token,port:0});const record=JSON.parse((app.store.db.prepare('SELECT record FROM python_executions WHERE execution_id=?').get(started.executionId) as any).record);expect(record.status).toBe('interrupted');expect(record.result.error.type).toBe('GatewayRestart');expect(app.supervisor.job('project','restart-running').status).toBe('interrupted');expect(app.store.snapshot('project').revision).toBe(1);expect(createHash('sha256').update(readFileSync(app.store.artifactPath('project',1,'model.FCStd'))).digest('hex')).toBe(original);await expect.poll(()=>{const path=`/proc/${started.nativePid}/stat`;return existsSync(path)&&!readFileSync(path,'utf8').includes(') Z ');},{timeout:5000}).toBe(false);
 }finally{child.kill('SIGKILL');await app.close();}
},30000);
