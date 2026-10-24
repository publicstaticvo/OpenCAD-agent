import {beforeAll,afterAll,test,expect} from 'vitest';
import {RevisionStore} from '../gateway/revision-store.ts';
import {WorkerClient} from '../gateway/worker-client.ts';
import plate from './fixtures/models/plate.json';
import {mkdtempSync,cpSync,mkdirSync,rmSync,readFileSync,writeFileSync,chmodSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
let root:string,fixture:string;
const env=(candidateId='c1',operationId='create',baseRevision=0)=>({documentId:'plate',candidateId,operationId,baseRevision});
beforeAll(async()=>{root=mkdtempSync(join(tmpdir(),'cad-revs-'));const w=await WorkerClient.start({workspace:root});try{await w.request('begin_candidate',{envelope:env()});await w.request('apply_operations',{envelope:env(),stepId:'build',operations:plate.operations});await w.request('prepare_candidate',{envelope:env(),criteria:plate.criteria});fixture=join(root,'c1');}finally{await w.close();}});
afterAll(()=>rmSync(root,{recursive:true,force:true}));
function setup(){const dir=mkdtempSync(join(root,'store-')),s=new RevisionStore(dir);s.createDocument('plate');return{dir,s};}
function stage(s:RevisionStore,id:string){const dest=s.candidatePath(id);mkdirSync(dest,{recursive:true});cpSync(fixture,dest,{recursive:true});}
test('CAS commit, idempotency, events and immutable versioned artifacts',()=>{
 const {s}=setup();try{
  expect(s.snapshot('plate')).toMatchObject({revision:0,tree:[],lastSeq:0});stage(s,'c1');stage(s,'c2');
  const first=s.commitCandidate(env(),plate);expect(first.revision).toBe(1);
  expect(s.commitCandidate(env(),plate)).toEqual(first);
  expect(()=>s.commitCandidate(env(),{different:true})).toThrow(/reused/i);
  expect(()=>s.commitCandidate(env('unused','create',1),plate)).toThrow(/reused/i);
  expect(()=>s.commitCandidate(env('c2','other'),plate)).toThrow(/conflict/i);
  const snap=s.snapshot('plate');expect(snap.revision).toBe(1);expect(snap.tree.map((x:any)=>x.id)).toEqual(['Body','base','pad','hole','pocket']);
  expect(s.events('plate',0).map((x:any)=>x.type)).toEqual(['committed']);expect(snap.lastSeq).toBe(s.events('plate',0)[0].seq);
  expect(readFileSync(s.artifactPath('plate',1,'model.FCStd')).length).toBeGreaterThan(1000);
  expect(()=>s.artifactPath('plate',0,'model.FCStd')).toThrow();expect(()=>s.artifactPath('plate',1,'../store.sqlite')).toThrow();
  stage(s,'c3');expect(s.commitCandidate(env('c3','revert',1),{restoreRevision:1}).revision).toBe(2);
 }finally{s.close();}
});
test.each(['stageWrite','published','dbCommitted'])('real Gateway store process SIGKILL at %s reconciles without half HEAD',point=>{
 const {dir,s}=setup();stage(s,'crash');s.close();
 const child=spawnSync(process.execPath,['--import','tsx','tests/helpers/store-crash.ts',dir,JSON.stringify(env('crash')),JSON.stringify(plate),point],{cwd:process.cwd(),encoding:'utf8',timeout:15000});
 expect(child.signal,child.stderr).toBe('SIGKILL');
 const restarted=new RevisionStore(dir);try{
  const committed=point==='dbCommitted';expect(restarted.snapshot('plate').revision).toBe(committed?1:0);
  expect(restarted.events('plate',0)).toHaveLength(committed?1:0);
  if(committed){expect(restarted.commitCandidate(env('crash'),plate).revision).toBe(1);expect(restarted.events('plate',0)).toHaveLength(1);}
  else{expect(()=>restarted.artifactPath('plate',1,'model.FCStd')).toThrow();}
 }finally{restarted.close();}
});
test('write error, damaged manifest and missing official files fail closed',()=>{
 const {dir,s}=setup();try{
  stage(s,'bad');writeFileSync(join(s.candidatePath('bad'),'preview.glb'),'corrupt');
  expect(()=>s.commitCandidate(env('bad'),plate)).toThrow(/hash|manifest/i);expect(s.snapshot('plate').revision).toBe(0);
  stage(s,'full');const revisions=join(dir,'revisions');chmodSync(revisions,0o500);
  try{expect(()=>s.commitCandidate(env('full'),plate)).toThrow();}finally{chmodSync(revisions,0o700);}
  expect(s.snapshot('plate').revision).toBe(0);
  stage(s,'good');s.commitCandidate(env('good'),plate);const official=s.artifactPath('plate',1,'model.FCStd');rmSync(official);s.close();
  const reopened=new RevisionStore(dir);try{expect(()=>reopened.snapshot('plate')).toThrow(/corrupt|missing/i);expect(reopened.health('plate')).toBe('corrupt');}finally{reopened.close();}
 }finally{s.close();}
});
test('injected ENOSPC before publication never advances HEAD',()=>{
 const dir=mkdtempSync(join(root,'full-'));const s=new RevisionStore(dir,{boundary(name){if(name==='beforeStageWrite')throw Object.assign(new Error('ENOSPC'),{code:'ENOSPC'});}});
 try{s.createDocument('plate');stage(s,'full');expect(()=>s.commitCandidate(env('full'),plate)).toThrow('ENOSPC');expect(s.snapshot('plate').revision).toBe(0);expect(s.events('plate',0)).toHaveLength(0);}finally{s.close();}
});

test('restore an older verified snapshot creates a new revision',()=>{
 const {s}=setup();try{
  stage(s,'first');s.commitCandidate(env('first'),plate);
  stage(s,'second');s.commitCandidate(env('second','change',1),{change:1});
  const restored=s.restoreRevision('plate',1,2,'restore');expect(restored.revision).toBe(3);
  expect(readFileSync(s.artifactPath('plate',3,'model.FCStd'))).toEqual(readFileSync(s.artifactPath('plate',1,'model.FCStd')));
  expect(s.events('plate',0)).toHaveLength(3);
 }finally{s.close();}
});
