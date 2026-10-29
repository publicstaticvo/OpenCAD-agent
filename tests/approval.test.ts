import {expect,test} from 'vitest';
import {mkdtempSync,readdirSync,readFileSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RevisionStore} from '../gateway/revision-store.ts';
import {Supervisor} from '../gateway/supervisor.ts';
import {approvedStages} from '../gateway/plan.ts';
import type {TextRunner} from '../gateway/agent.ts';
import plate from './fixtures/models/plate.json';
async function setup(){const root=mkdtempSync(join(tmpdir(),'approval-'));const store=new RevisionStore(root);store.createDocument('part');const service=await Supervisor.start(store);return{root,store,service,async close(){await service.close();store.close();rmSync(root,{recursive:true,force:true});}};}
test('structured write entrance waits for explicit approval and survives restart without CAD side effects',async()=>{
 const x=await setup();try{
  const job=x.service.submit('part',0,'create',plate);
  expect(job.status).toBe('awaiting_approval');expect(job.candidateId).toBe('');expect(x.service.activeWorker).toBeNull();expect(readdirSync(join(x.root,'staging'))).toEqual([]);
  expect(x.service.submit('part',0,'create',plate)).toEqual(job);
  await x.service.close();x.service=await Supervisor.start(x.store);
  expect(x.service.job('part','create')).toEqual(job);
  const rejected=x.service.rejectJob('part','create',job.plan!.planHash);expect(rejected.status).toBe('rejected');
  expect(x.service.rejectJob('part','create',job.plan!.planHash)).toEqual(rejected);
  expect(()=>x.service.approveJob('part','create',job.plan!.planHash)).toThrow();expect(readdirSync(join(x.root,'staging'))).toEqual([]);
 }finally{await x.close();}
});
test('approval is idempotent; pending cancellation cannot start a Worker',async()=>{
 const x=await setup();try{
  const job=x.service.submit('part',0,'create',plate);
  expect(()=>x.service.approveJob('part','create','wrong')).toThrow(/stale/);
  const approved=x.service.approveJob('part','create',job.plan!.planHash);
  expect(x.service.approveJob('part','create',job.plan!.planHash)).toEqual(approved);
  x.service.cancelJob('part','create');expect((await x.service.waitForJob('part','create')).status).toBe('cancelled');
  expect(x.store.snapshot('part').revision).toBe(0);expect(readdirSync(join(x.root,'staging'))).toEqual([]);
 }finally{await x.close();}
});
test('approved program runs real FreeCAD, preserves formal package and rejects a stale second plan',async()=>{
 const x=await setup();try{
  const a=x.service.submit('part',0,'a',plate),b=x.service.submit('part',0,'b',plate);
  x.service.approveJob('part','a',a.plan!.planHash);
  expect(()=>x.service.approveJob('part','b',b.plan!.planHash)).toThrow(/正在修改/);
  const result=await x.service.waitForJob('part','a');expect(result.error).toBeNull();expect(result.status).toBe('committed');
  expect(x.store.snapshot('part').revision).toBe(1);expect(()=>x.service.approveJob('part','b',b.plan!.planHash)).toThrow(/stale/);
  expect(x.store.artifactPath('part',1,'model.FCStd')).toContain('model.FCStd');
 }finally{await x.close();}
},15000);

test('persisted plan tampering and unsupported contract versions cannot authorize CAD writes',async()=>{
 const x=await setup();try{
  for(const [id,mutate] of [['changed',(plan:any)=>{plan.dimensions.height=99;}],['version',(plan:any)=>{plan.version=2;}]] as const){
   const job=x.service.submit('part',0,id,plate),changed=structuredClone(job);mutate(changed.plan);
   x.store.db.prepare('UPDATE jobs SET job=? WHERE document_id=? AND operation_id=?').run(JSON.stringify(changed),'part',id);
   expect(()=>x.service.approveJob('part',id,job.plan!.planHash)).toThrow(/changed|version/i);
  }
  expect(x.service.activeWorker).toBeNull();expect(readdirSync(join(x.root,'staging'))).toEqual([]);expect(x.store.snapshot('part').revision).toBe(0);
 }finally{await x.close();}
});

test('out of scope hole writes never reach native apply and permanently block later writes and finish',async()=>{
 const root=mkdtempSync(join(tmpdir(),'approval-boundary-')),store=new RevisionStore(root);store.createDocument('part');
 const nativeMethods:string[]=[];
 // A direct request driver exercises real Supervisor/Worker behavior without invoking a model.
 const runner:TextRunner=Object.assign(async(job:any,session:any)=>{
  const adding=job.operationId==='hole';
  if(session.mode==='planning'){await session.propose(adding?{kind:'add_hole',diameter:6}:{kind:'create_box',length:40,width:30,height:10});return;}
  if(adding){
   await expect(session.apply([{op:'set_parameter',feature:'pad',parameter:'Length',value:99}],'outside')).rejects.toThrow(/approved/i);
   await expect(session.apply(approvedStages(session.plan)[0].operations,'after-rejection')).rejects.toThrow(/approved/i);
   await expect(session.prepare(session.plan.criteria)).rejects.toThrow(/approved/i);
   return session.plan.criteria;
  }
  for(const [index,stage] of approvedStages(session.plan).entries())await session.apply(stage.operations,`box-${index}`);
  await session.prepare(session.plan.criteria);return session.plan.criteria;
 },{mode:'fake' as const});
 let service:Supervisor;
 service=await Supervisor.start(store,{textRunner:runner,observe:phase=>{
  if(phase!=='opened')return;const worker=service.activeWorker!,request=worker.request.bind(worker);
  worker.request=async(method,params,timeout)=>{nativeMethods.push(method);return request(method,params,timeout);};
 }});
 try{
  service.submitText('part',0,'box','40 × 30 × 10 mm');const box=await service.waitForJob('part','box');service.approveJob('part','box',box.plan!.planHash);
  expect((await service.waitForJob('part','box')).status).toBe('committed');
  const files=['model.FCStd','model.step','preview.glb'];
  const hashes=()=>files.map(file=>createHash('sha256').update(readFileSync(store.artifactPath('part',1,file))).digest('hex'));
  const before=hashes();nativeMethods.length=0;
  service.submitText('part',1,'hole','center through hole diameter 6 mm');const hole=await service.waitForJob('part','hole');service.approveJob('part','hole',hole.plan!.planHash);
  const result=await service.waitForJob('part','hole');expect(result.status).toBe('failed');expect(result.error).toMatch(/approved/i);
  expect(nativeMethods).not.toContain('apply_operations');expect(nativeMethods).not.toContain('prepare_candidate');
  expect(store.snapshot('part').revision).toBe(1);expect(hashes()).toEqual(before);
  const events=store.jobEvents('part','hole').events;expect(events.some(event=>event.type==='cad_operation_rejected')).toBe(true);expect(events.some(event=>event.type==='candidate_snapshot')).toBe(false);
 }finally{await service.close();store.close();rmSync(root,{recursive:true,force:true});}
},15000);
