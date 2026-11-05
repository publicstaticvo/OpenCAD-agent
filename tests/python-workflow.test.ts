import {test,expect} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createPatch} from 'diff';
import {RevisionStore} from '../gateway/revision-store.ts';
import {PythonSession} from '../gateway/python-session.ts';
import {pythonObservation,pythonToolSchemas} from '../gateway/pi-adapter.mjs';
import {observationRequests} from './python-observation.mjs';

test('real Python submissions preview, patch, retain valid candidate on errors and publish verified files',async()=>{
 mkdirSync('.work/python',{recursive:true});
 const store=new RevisionStore(mkdtempSync(resolve('.work/python/workflow-')));store.createDocument('part');
 let session=new PythonSession(store,{documentId:'part',baseRevision:0,operationId:'python-task'},()=>{},new AbortController().signal,10);
 const source="import FreeCAD as App\ndoc=App.newDocument('Model')\nbody=doc.addObject('PartDesign::Body','Body')\nbox=body.newObject('PartDesign::AdditiveBox','Box')\nbox.Length=40;box.Width=30;box.Height=10\ndoc.recompute()\n";
 try{
  const first=await session.submit({source,criteria:{bbox:[40,30,10],volume:12000,parameters:[{feature:'Box',parameter:'Height',value:10}]}});
  expect(first.status).toBe('valid');expect(first.observation.image.mimeType).toBe('image/png');
  expect(Object.keys(pythonToolSchemas).sort()).toEqual(['cad_files','cad_run','edit','read','write']);
  const feedback=pythonObservation(first,{input:['text','image']});
  expect(feedback.content[1].data).toBe(first.observation.image.data);
  const requests=observationRequests(feedback.content);
  expect(JSON.stringify(requests.completions)).toContain(`data:image/png;base64,${first.observation.image.data}`);
  expect(JSON.stringify(requests.responses)).toContain(`data:image/png;base64,${first.observation.image.data}`);
  expect(pythonObservation(first,{input:['text']}).content).toHaveLength(1);
  await session.finishExecution(first.executionId);store.acceptPythonCandidate(session.envelope,{kind:'python-test'},first);await session.close();
  session=new PythonSession(store,{documentId:'part',baseRevision:1,operationId:'python-modify'},()=>{},new AbortController().signal,10);
  const next=source.replace('Height=10','Height=12');
  const second=await session.submit({parentHash:first.sourceHash,patch:createPatch('script.py',source,next),criteria:{bbox:[40,30,12],volume:14400}});
  expect(second.status).toBe('valid');expect(second.executionId).not.toBe(first.executionId);
  const failure=await session.submit({source:'raise RuntimeError("repair needed")',parentHash:second.sourceHash,criteria:{bbox:[40,30,12],volume:14400}});
  expect(failure.status).toBe('failed');expect(failure.error.line).toBe(1);
  await expect(session.finish({bbox:[40,30,12],volume:14400})).rejects.toThrow(/latest/i);
  const repaired=await session.submit({source:next,parentHash:failure.sourceHash,criteria:{bbox:[40,30,12],volume:14400}});
  expect(repaired.status).toBe('valid');expect(store.snapshot('part').revision).toBe(1);
  await session.finish({bbox:[40,30,12],volume:14400});
  store.acceptPythonCandidate(session.envelope,{kind:'python-test'},repaired);
  const done=store.snapshot('part');expect(done.validation.python).toBe(true);expect(done.revision).toBe(2);
  expect(readFileSync(store.artifactPath('part',2,'script.py'),'utf8')).toBe(next);
  expect(done.validation.executionId).toBe(repaired.executionId);
 }finally{await session.close();store.close();}
},30000);

for(const action of ['cancel','worker-exit'] as const)test(`native Python ${action} terminates execution and preserves formal state`,async()=>{
 mkdirSync('.work/python',{recursive:true});const store=new RevisionStore(mkdtempSync(resolve('.work/python/fault-')));store.createDocument('part');
 const controller=new AbortController();
 const session=new PythonSession(store,{documentId:'part',baseRevision:0,operationId:action},()=>{},controller.signal);
 try{
  const pending=session.submit({source:'while True: pass',criteria:{bbox:[1,1,1],volume:1}});
  // Observe an actual started native process before exercising cancellation.
  let processFile='';
  await expect.poll(()=>{processFile=resolve(store.candidatePath(session.envelope.candidateId),'executions',session.inspect().latest?.executionId??'pending','execute.process.json');return existsSync(processFile);},{timeout:10000}).toBe(true);
  const pid=JSON.parse(readFileSync(processFile,'utf8')).pid;
  await expect(session.submit({source:'pass',criteria:{bbox:[1,1,1],volume:1}})).rejects.toThrow(/already running/);
  if(action==='cancel'){
   const rejection=expect(pending).rejects.toThrow('User cancelled');controller.abort(new Error('User cancelled'));await rejection;
  }else{
   session.client!.process.kill('SIGKILL');
   const result=await pending;expect(result.error.type).toBe('WorkerError');expect(result.error.stage).toBe('worker');
  }
  const execution=JSON.parse((store.db.prepare('SELECT record FROM python_executions WHERE execution_id=?').get(session.inspect().latest!.executionId) as any).record);
  expect(execution.status).toBe(action==='cancel'?'cancelled':'failed');expect(session.sources.read('part',execution.sourceVersionId).source).toBe('while True: pass');
  await expect.poll(()=>{const path=`/proc/${pid}/stat`;return existsSync(path)&&!readFileSync(path,'utf8').includes(') Z ');},{timeout:5000}).toBe(false);
  expect(store.snapshot('part').revision).toBe(0);
 }finally{await session.close();store.close();}
},20000);
