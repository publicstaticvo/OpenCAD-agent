import {expect,test} from 'vitest';
import {mkdtempSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createGateway} from '../gateway/server.ts';
import {RevisionStore} from '../gateway/revision-store.ts';
import {Supervisor} from '../gateway/supervisor.ts';
import {approvedStages} from '../gateway/plan.ts';
import type {TextRunner} from '../gateway/agent.ts';

function barrier(){let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return{promise,resolve};}

test('real HTTP candidate checkpoints expose native geometry only after approval and preserve committed observation',async()=>{
 const root=mkdtempSync(resolve('.work/candidate-http-')),first=barrier(),second=barrier(),releaseFirst=barrier(),releaseSecond=barrier();
 // Direct CAD request driver: no language model is invoked by this integration test.
 const runner:TextRunner=Object.assign(async(_job:any,session:any)=>{
  if(session.mode==='planning'){await session.propose({kind:'create_box',length:42,width:24,height:8});return;}
  const stages=approvedStages(session.plan);
  await session.apply(stages[0].operations,'sketch');first.resolve();await releaseFirst.promise;
  await session.apply(stages[1].operations,'pad');second.resolve();await releaseSecond.promise;
  await session.prepare(session.plan.criteria);return session.plan.criteria;
 },{mode:'fake' as const});
 const gateway=await createGateway({dataDir:root,accessToken:'candidate-http-access-token-012345',port:0,textRunner:runner});
 const headers={Authorization:'Bearer candidate-http-access-token-012345','Content-Type':'application/json'};
 const get=(path:string)=>fetch(gateway.baseUrl+path,{headers});
 try{
  gateway.store.createDocument('part');gateway.store.createDocument('other');
  const pending=gateway.supervisor.submitText('part',0,'box','42 × 24 × 8 mm');
  const planned=await gateway.supervisor.waitForJob('part','box');expect(planned.status).toBe('awaiting_approval');
  expect(pending.candidateId).toBe('');expect(gateway.supervisor.activeWorker).toBeNull();expect(readdirSync(resolve(root,'staging'))).toEqual([]);
  const path='/api/documents/part/jobs/box/candidate/';expect((await get(path+'snapshot')).status).toBe(404);
  const response=await fetch(gateway.baseUrl+'/api/documents/part/jobs/box/approve',{method:'POST',headers,body:JSON.stringify({planHash:planned.plan!.planHash})});expect(response.status).toBe(200);
  await first.promise;const sketch=await(await get(path+'snapshot')).json();
  expect(sketch.snapshot.sequence).toBe(1);expect(sketch.snapshot.sketch.geometry).toHaveLength(4);expect(sketch.snapshot.sketch.fullyConstrained).toBe(true);expect(sketch.snapshot.preview).toBeUndefined();
  expect(gateway.store.snapshot('part').revision).toBe(0);releaseFirst.resolve();
  await second.promise;const solid=await(await get(path+'snapshot')).json();
  expect(solid.snapshot.geometry).toMatchObject({bbox:[42,24,8],solids:1});expect(solid.snapshot.geometry.volume).toBeCloseTo(8064,6);
  expect((await get('/api/documents/other/jobs/box/candidate/snapshot')).status).toBe(404);
  expect((await get(path+'preview?sequence=1')).status).toBe(404);
  const mesh=await get(path+'preview?sequence=2');expect(mesh.status).toBe(200);expect(mesh.headers.get('x-cad-candidate')).toBe(solid.snapshot.candidateId);
  const bytes=Buffer.from(await mesh.arrayBuffer());expect(createHash('sha256').update(bytes).digest('hex')).toBe(solid.snapshot.preview.sha256);
  expect(gateway.store.snapshot('part').revision).toBe(0);releaseSecond.resolve();
  const result=await gateway.supervisor.waitForJob('part','box');expect(result.error).toBeNull();expect(result.status).toBe('committed');
  expect(gateway.store.snapshot('part').revision).toBe(1);
  const recorded=await get(path+'preview?sequence=2');expect(recorded.status).toBe(200);
  expect(recorded.headers.get('x-cad-candidate')).toBe(solid.snapshot.candidateId);
  expect(Buffer.from(await recorded.arrayBuffer())).toEqual(bytes);
  expect((await get(path+'preview?sequence=1')).status).toBe(404);
  expect((await get('/api/documents/other/jobs/box/candidate/preview?sequence=2')).status).toBe(404);
  const events=gateway.store.jobEvents('part','box').events;
  expect(events.filter(e=>e.type==='candidate_snapshot').map(e=>e.revision)).toEqual([0,0]);
 }finally{releaseFirst.resolve();releaseSecond.resolve();await gateway.close();}
});

test('cancellation remains terminal when an actual Worker snapshot returns late',async()=>{
 const root=mkdtempSync(resolve('.work/candidate-cancel-')),store=new RevisionStore(root);store.createDocument('part');
 const received=barrier(),release=barrier();let supervisor:Supervisor;
 const runner:TextRunner=Object.assign(async(_job:any,session:any)=>{
  if(session.mode==='planning'){await session.propose({kind:'create_box',length:40,width:30,height:10});return;}
  await session.apply(approvedStages(session.plan)[0].operations,'sketch');
  return undefined;
 },{mode:'fake' as const});
 supervisor=await Supervisor.start(store,{textRunner:runner,observe:phase=>{
  if(phase!=='opened')return;
  const worker=supervisor.activeWorker!,request=worker.request.bind(worker);
  // Delay delivery of a genuine native result; no Worker response is fabricated.
  worker.request=async(method,params,timeout)=>{const result=await request(method,params,timeout);if(method==='candidate_snapshot'){received.resolve();await release.promise;}return result;};
 }});
 try{
  supervisor.submitText('part',0,'box','40 × 30 × 10 mm');const pending=await supervisor.waitForJob('part','box');
  supervisor.approveJob('part','box',pending.plan!.planHash);await received.promise;
  const cancelled=supervisor.cancelJob('part','box');expect(cancelled.status).toBe('cancelled');release.resolve();
  const result=await supervisor.waitForJob('part','box');expect(result.status).toBe('cancelled');expect(result.candidateSnapshot).toBeUndefined();
  expect(store.jobEvents('part','box').events.filter(e=>e.type==='candidate_snapshot')).toEqual([]);
  expect(store.snapshot('part').revision).toBe(0);
 }finally{release.resolve();await supervisor.close();store.close();}
});
