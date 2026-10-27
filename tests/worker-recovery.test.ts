import {test,expect} from 'vitest';
import {RevisionStore} from '../gateway/revision-store.ts';import {Supervisor,type Job} from '../gateway/supervisor.ts';
import plate from './fixtures/models/plate.json';import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {once} from 'node:events';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
const edit={operations:[{op:'set_parameter',feature:'hole',parameter:'diameter',value:8}],criteria:{bbox:[80,60,10],volume:47497.34517542564,parameters:[{feature:'hole',parameter:'diameter',value:8}]}};
const digest=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
async function setup(options:any={}){const dir=mkdtempSync(join(tmpdir(),'cad-supervisor-')),store=new RevisionStore(dir);store.createDocument('plate');const s=await Supervisor.start(store,options);return{dir,store,s,async close(){await s.close();store.close();rmSync(dir,{recursive:true,force:true});}};}
async function run(s:Supervisor,base:number,id:string,program:any){s.submit('plate',base,id,program);return s.waitForJob('plate',id);}
test('persisted candidate lifecycle, idempotency and next job open formal FCStd',async()=>{
 const x=await setup();try{
  expect((await run(x.s,0,'create',plate)).status).toBe('committed');
  expect((await run(x.s,0,'create',plate)).result.revision).toBe(1);
  expect((await run(x.s,1,'edit',edit)).status).toBe('committed');
  expect(x.store.snapshot('plate').revision).toBe(2);
  expect(x.store.snapshot('plate').tree.find((f:any)=>f.id==='hole')?.parameters.diameter).toBe(8);
  expect(x.s.cancelJob('plate','edit').status).toBe('committed');
 }finally{await x.close();}
});
test.each(['opened','modified','prepared'])('actual Worker SIGKILL at %s protects official package and next task succeeds',async phase=>{
 let kill=false;let s:Supervisor;const x=await setup({async observe(p:string){if(kill&&p===phase){s.activeWorker!.process.kill('SIGKILL');await once(s.activeWorker!.process,'exit');}}});s=x.s;
 try{
  await run(s,0,'create',plate);const path=x.store.artifactPath('plate',1,'model.FCStd'),before=digest(path),seq=x.store.snapshot('plate').lastSeq;kill=true;
  const failed=await run(s,1,'crash',edit);expect(failed.status).toBe('failed');expect(x.store.snapshot('plate').revision).toBe(1);expect(digest(path)).toBe(before);
  expect(x.store.events('plate',seq).some(e=>e.type==='committed')).toBe(false);kill=false;
  expect((await run(s,1,'retry',edit)).status).toBe('committed');
 }finally{await x.close();}
});
test.each(['opened','modified','prepared'])('cancellation at actual CAD phase %s keeps the existing formal package',async phase=>{
 let cancel=false,s:Supervisor;const x=await setup({observe(p:string,job:Job){if(cancel&&p===phase)s.cancelJob(job.documentId,job.operationId);}});s=x.s;
 try{await run(s,0,'create',plate);const path=x.store.artifactPath('plate',1,'model.FCStd'),before=digest(path);cancel=true;
  expect((await run(s,1,'cancel-phase',edit)).status).toBe('cancelled');expect(x.store.snapshot('plate').revision).toBe(1);expect(digest(path)).toBe(before);
 }finally{await x.close();}
});
test('native hang deadline and cancellation before commit never change HEAD',async()=>{
 let mode='none',s:Supervisor;const x=await setup({operationMs:80,async observe(phase:string,job:Job){if(mode==='hang'&&phase==='opened')s.activeWorker!.process.kill('SIGSTOP');if(mode==='cancel'&&phase==='prepared')s.cancelJob(job.documentId,job.operationId);}});s=x.s;
 try{
  // Normal geometric work uses default operation deadline; shorten only the hung request via options below.
  mode='hang';const failed=await run(s,0,'hang',plate);expect(failed.status).toBe('failed');expect(failed.error).toMatch(/timeout/i);expect(x.store.snapshot('plate').revision).toBe(0);
 }finally{await x.close();}
 const y=await setup({async observe(phase:string,job:Job){if(phase==='prepared')y.s.cancelJob(job.documentId,job.operationId);}});
 try{expect((await run(y.s,0,'cancel',plate)).status).toBe('cancelled');expect(y.store.snapshot('plate').revision).toBe(0);}finally{await y.close();}
});
test.each(['immediate','after-worker-exit'])('Gateway SIGKILL recovery %s preserves interrupted state and reopens original model',async timing=>{
 const x=await setup();try{
  await run(x.s,0,'create',plate);const before=digest(x.store.artifactPath('plate',1,'model.FCStd'));await x.s.close();x.store.close();
  const child=spawnSync(process.execPath,['--import','tsx','tests/helpers/gateway-crash.ts',x.dir,JSON.stringify(edit)],{encoding:'utf8',timeout:15000});expect(child.signal,child.stderr).toBe('SIGKILL');
  if(timing==='after-worker-exit'){
   const {pid}=JSON.parse(readFileSync(join(x.dir,'worker-lease.json'),'utf8'));
   await expect.poll(()=>{const path=`/proc/${pid}/stat`;if(!existsSync(path))return true;const stat=readFileSync(path,'utf8');return ['Z','X'].includes(stat.slice(stat.lastIndexOf(')')+2).split(' ')[0]);},{timeout:5000}).toBe(true);
  }
  const store=new RevisionStore(x.dir),s=await Supervisor.start(store);try{
   expect(s.job('plate','crash').status).toBe('interrupted');expect(store.snapshot('plate').revision).toBe(1);expect(digest(store.artifactPath('plate',1,'model.FCStd'))).toBe(before);
   expect((await run(s,1,'fresh',edit)).status).toBe('committed');expect(store.snapshot('plate').revision).toBe(2);
  }finally{await s.close();store.close();}
 }finally{await x.close();}
});
test('only one Supervisor owns a data directory and a project rejects concurrent writes',async()=>{
 const x=await setup();try{
  await expect(Supervisor.start(x.store)).rejects.toThrow(/already owns/i);
  x.s.submit('plate',0,'one',plate);
  expect(()=>x.s.submit('plate',0,'second',plate)).toThrow('项目正在修改');
  expect((await x.s.waitForJob('plate','one')).status).toBe('committed');
  expect(()=>x.s.submit('plate',0,'stale',plate)).toThrow(/conflict/i);
  expect(x.store.snapshot('plate').revision).toBe(1);
 }finally{await x.close();}
});
test('observed native save write followed by SIGKILL cannot publish its candidate',async()=>{
 const {watch}=await import('node:fs');let kill=false,observed=false;let watcher:ReturnType<typeof watch>|undefined;let s:Supervisor;
 const x=await setup({observe(phase:string,job:Job){if(kill&&phase==='modified'){watcher=watch(x.store.candidatePath(job.candidateId),(_event,name)=>{if(String(name).includes('FCStd')&&!observed){observed=true;s.activeWorker?.process.kill('SIGKILL');}});}}});s=x.s;
 try{await run(s,0,'create',plate);const path=x.store.artifactPath('plate',1,'model.FCStd'),before=digest(path);kill=true;const job=await run(s,1,'during_save',edit);expect(observed).toBe(true);expect(job.status).toBe('failed');expect(x.store.snapshot('plate').revision).toBe(1);expect(digest(path)).toBe(before);}finally{watcher?.close();await x.close();}
});
