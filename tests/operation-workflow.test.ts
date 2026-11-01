import {test,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {RevisionStore} from '../gateway/revision-store.ts';
import {Supervisor} from '../gateway/supervisor.ts';
import {triangle,bracket,bracketHole,triangleEdit} from './fixtures/operation-plans.ts';
test('real operation plans commit nonrectangular parts, cut off-center holes, edit and protect formal files',async()=>{
 mkdirSync('.work/general-operations',{recursive:true});
 const root=mkdtempSync(resolve('.work/general-operations/verification-')),store=new RevisionStore(root),supervisor=await Supervisor.start(store);
 const results:any[]=[];
 try{
  for(const [id,plans] of [['triangle',[triangle,triangleEdit]],['bracket',[bracket,bracketHole]]] as const){
   store.createDocument(id);
   for(const [index,proposal] of plans.entries()){
    const submitted=supervisor.submitOperationPlan(id,index,`task-${index}`,proposal);
    expect(submitted.status).toBe('awaiting_approval');expect(submitted.candidateId).toBe('');expect(store.snapshot(id).revision).toBe(index);
    supervisor.approveJob(id,submitted.operationId,submitted.plan!.planHash);
    const done=await supervisor.waitForJob(id,submitted.operationId);expect(done.error).toBeNull();expect(done.status).toBe('committed');
    const snapshot=store.snapshot(id);expect(snapshot.revision).toBe(index+1);expect(snapshot.validation.operationPlanHash).toBe(done.plan!.planHash);
    expect(snapshot.validation.volume).toBeCloseTo(proposal.criteria.volume,6);
    expect(snapshot.validation.operationModel.sketches.every((s:any)=>s.fullyConstrained)).toBe(true);
    results.push({id,job:done,validation:snapshot.validation});
   }
   const before=store.snapshot(id),bytes=readFileSync(store.artifactPath(id,2,'model.FCStd'));
   const bad=structuredClone(id==='triangle'?triangleEdit:bracketHole) as any;
   if(id==='bracket'){bad.stages=[{name:'错误修改孔径',sketchId:'hole',operations:[{op:'set_parameter',feature:'hole',parameter:'diameter',value:500}]}];}
   bad.criteria.volume=1;
   const submitted=supervisor.submitOperationPlan(id,2,'invalid',bad);supervisor.approveJob(id,'invalid',submitted.plan!.planHash);
   const failed=await supervisor.waitForJob(id,'invalid');expect(failed.status).toBe('failed');expect(failed.error).toBeTruthy();
   expect(store.snapshot(id).revision).toBe(before.revision);expect(readFileSync(store.artifactPath(id,2,'model.FCStd'))).toEqual(bytes);
   results.push({id,failed});
  }
  writeFileSync(join(root,'verified-results.json'),JSON.stringify(results,null,2));
 }finally{await supervisor.close();store.close();}
},30000);
test('repeated pending operation request returns existing plan after another plan commits',async()=>{
 const root=mkdtempSync(resolve('.work/general-operations/idempotency-')),store=new RevisionStore(root),supervisor=await Supervisor.start(store);
 try{
  store.createDocument('part');const prior=supervisor.submitOperationPlan('part',0,'pending',triangle);
  const program={operations:triangle.stages.flatMap(s=>s.operations),criteria:triangle.criteria};
  const other=supervisor.submit('part',0,'other',program);supervisor.approveJob('part','other',other.plan!.planHash);
  expect((await supervisor.waitForJob('part','other')).status).toBe('committed');
  expect(supervisor.submitOperationPlan('part',0,'pending',triangle)).toEqual(prior);
 }finally{await supervisor.close();store.close();}
});
