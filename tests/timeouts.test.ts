import {test,expect} from 'vitest';
import {approvedProgram} from './helpers/approved-program.ts';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {WorkerClient} from '../gateway/worker-client.ts';
import {ModelConfig} from '../gateway/model-config.ts';
import {Supervisor} from '../gateway/supervisor.ts';
import {RevisionStore} from '../gateway/revision-store.ts';
import plate from './fixtures/models/plate.json';
import {createHash} from 'node:crypto';

const settings={version:2,apiKey:'stored-private-credential',provider:{protocol:'openai-completions',baseUrl:'https://example.com/v1',model:'local',contextWindow:262144,maxTokens:16384,contextSource:'default-256k',outputSource:'pi-custom-default'},configuredAt:new Date().toISOString()};
test('existing model settings migrate to three disabled timeouts and repair approval',()=>{
 const root=mkdtempSync(resolve('.work/timeout-settings-')),path=join(root,'model-settings.json');
 writeFileSync(path,JSON.stringify(settings));const config=new ModelConfig(root);
 expect(config.status()).toMatchObject({timeouts:{taskSeconds:0,requestSeconds:0,cadSeconds:0}});
 expect(JSON.parse(readFileSync(path,'utf8')).version).toBe(3);
 expect(JSON.parse(readFileSync(join(root,'approved.json'),'utf8')).timeouts).toEqual({taskSeconds:0,requestSeconds:0,cadSeconds:0});
});
test('configured timeout values survive restart and invalid persisted values fail immediately',()=>{
 const root=mkdtempSync(resolve('.work/timeout-settings-')),path=join(root,'model-settings.json');
 const timeouts={taskSeconds:600,requestSeconds:90,cadSeconds:60};
 writeFileSync(path,JSON.stringify({...settings,version:3,timeouts}));
 expect(new ModelConfig(root).status()).toMatchObject({timeouts});
 for(const value of [-1,0.5,'60',2147484]){
  writeFileSync(path,JSON.stringify({...settings,version:3,timeouts:{...timeouts,requestSeconds:value}}));
  expect(()=>new ModelConfig(root)).toThrow();
 }
});
test('zero CAD timeout waits for the actual stopped Worker and resumes successfully',async()=>{
 const worker=await WorkerClient.start();let resume:ReturnType<typeof setTimeout>|undefined;
 try{
  worker.process.kill('SIGSTOP');resume=setTimeout(()=>worker.process.kill('SIGCONT'),150);
  expect(await worker.request('inspect_document',{},0)).toEqual({tree:[],loaded:false});
 }finally{clearTimeout(resume);await worker.close();}
});
test('zero task and operation timeout allow real CAD validation and formal publication',async()=>{
 const store=new RevisionStore(mkdtempSync(resolve('.work/timeout-task-')));store.createDocument('plate');
 const supervisor=await Supervisor.start(store,{taskMs:0,operationMs:0});
 try{approvedProgram(supervisor,'plate',0,'create',plate);expect((await supervisor.waitForJob('plate','create')).status).toBe('committed');expect(store.snapshot('plate').revision).toBe(1);}
 finally{await supervisor.close();store.close();}
});
test.each(['task','cad','cancel'])('configured %s termination protects formal files and allows the next job',async mode=>{
 const store=new RevisionStore(mkdtempSync(resolve('.work/timeout-protection-')));store.createDocument('plate');
 let stop=false;let supervisor:Supervisor;
 const limits={taskSeconds:0,requestSeconds:0,cadSeconds:0};
 supervisor=await Supervisor.start(store,{timeouts:()=>limits,observe(phase,job){
  if(stop&&phase==='opened'){supervisor.activeWorker!.process.kill('SIGSTOP');if(mode==='cancel')supervisor.cancelJob(job.documentId,job.operationId);}
 }});
 const run=async(base:number,id:string)=>{approvedProgram(supervisor,'plate',base,id,plate);return supervisor.waitForJob('plate',id);};
 try{
  expect((await run(0,'initial')).status).toBe('committed');
  const path=store.artifactPath('plate',1,'model.FCStd'),digest=()=>createHash('sha256').update(readFileSync(path)).digest('hex'),before=digest();
  limits.taskSeconds=mode==='task'?1:0;limits.cadSeconds=mode==='cad'?1:0;stop=true;
  const result=await run(1,'stopped');expect(result.status).toBe(mode==='cancel'?'cancelled':'failed');
  if(mode!=='cancel')expect(result.error).toMatch(/timeout/i);
  expect(store.snapshot('plate').revision).toBe(1);expect(digest()).toBe(before);
  stop=false;limits.taskSeconds=0;limits.cadSeconds=0;
  approvedProgram(supervisor,'plate',1,'recovered',{operations:[{op:'set_parameter',feature:'hole',parameter:'diameter',value:8}],criteria:{bbox:[80,60,10],volume:48000-Math.PI*16*10}});
  expect((await supervisor.waitForJob('plate','recovered')).status).toBe('committed');
 }finally{await supervisor.close();store.close();}
});
