import {test,expect} from 'vitest';
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {RevisionStore} from '../gateway/revision-store.ts';
import {SourceVersions} from '../gateway/source-versions.ts';
import {PythonSession} from '../gateway/python-session.ts';
import {WorkerClient} from '../gateway/worker-client.ts';
import {randomUUID} from 'node:crypto';

const box="import FreeCAD as App\nimport Part\ndoc=App.newDocument('Model')\nobj=doc.addObject('PartDesign::Feature','Box')\nobj.Shape=Part.makeBox(20,30,40)\ndoc.recompute()\n";
const criteria:import('../shared/cad-contracts.ts').Criteria={bbox:[20,30,40],volume:24000};
test('C14-C22 explicit immutable source execution, repeated runs, errors and recovery',async()=>{
 mkdirSync('.work/source-execution-phase-1-2',{recursive:true});const store=new RevisionStore(mkdtempSync(resolve('.work/source-execution-phase-1-2/native-')));store.createDocument('project');
 const versions=new SourceVersions(store),events:any[]=[];
 const first=versions.save('project',{source:box,parentVersionId:null,actor:'user'});
 expect(readdirSync(resolve(store.root,'staging'))).toEqual([]);
 const session=new PythonSession(store,{documentId:'project',baseRevision:0,operationId:'native'},(type,data)=>events.push({type,data}),new AbortController().signal,10);
 try{
 await expect(session.run({sourceVersionId:first.versionId,sourceHash:'0'.repeat(64),criteria})).rejects.toThrow(/hash/i);expect(session.client).toBeUndefined();
 const one=await session.run({sourceVersionId:first.versionId,sourceHash:first.sourceHash,criteria});
 expect(one.status).toBe('valid');expect(one.sourceVersionId).toBe(first.versionId);expect(one.observation.image.mimeType).toBe('image/png');
 const input=readFileSync(resolve(store.candidatePath(session.envelope.candidateId),'executions',one.executionId,'input/project/script.py'));
 expect(createHash('sha256').update(input).digest('hex')).toBe(first.sourceHash);
 const two=await session.run({sourceVersionId:first.versionId,sourceHash:first.sourceHash});expect(two.executionId).not.toBe(one.executionId);
 expect(two.status).toBe('valid');
 const broken=versions.save('project',{source:'def broken(:',parentVersionId:first.versionId,actor:'user'});
 expect(session.inspect().latest?.executionId).toBe(two.executionId);expect(session.inspect().source?.versionId).toBe(broken.versionId);
 const failed=await session.run({sourceVersionId:broken.versionId,sourceHash:broken.sourceHash});expect(failed.error.type).toBe('SyntaxError');expect(failed.error.line).toBe(1);expect(session.candidate.executionId).toBe(two.executionId);
 await expect(session.finishExecution(two.executionId)).rejects.toThrow();
 const runtime=versions.save('project',{source:'raise RuntimeError("visible error")',parentVersionId:broken.versionId,actor:'user'});
 const runtimeFailed=await session.run({sourceVersionId:runtime.versionId,sourceHash:runtime.sourceHash});expect(runtimeFailed.error.type).toBe('RuntimeError');expect(runtimeFailed.error.file).toBe('script.py');
 const repaired=versions.save('project',{source:box,parentVersionId:runtime.versionId,actor:'user'});
 const fixed=await session.run({sourceVersionId:repaired.versionId,sourceHash:repaired.sourceHash});expect(fixed.status).toBe('valid');
 await session.finishExecution(fixed.executionId);store.acceptPythonCandidate(session.envelope,{kind:'python-test'},fixed);
 expect(store.snapshot('project').validation.executionId).toBe(fixed.executionId);expect(store.snapshot('project').validation.sourceVersionId).toBe(repaired.versionId);
 expect(readFileSync(store.artifactPath('project',1,'script.py'),'utf8')).toBe(box);
 expect(events.filter(e=>e.type==='candidate_snapshot')).toHaveLength(3);
 }finally{await session.close();store.close();}
},60000);

test('D25-D26 absent or failed acceptance yields diagnostic preview without formal eligibility',async()=>{
 mkdirSync('.work/source-execution-phase-1-2',{recursive:true});const store=new RevisionStore(mkdtempSync(resolve('.work/source-execution-phase-1-2/diagnostic-')));store.createDocument('project');
 const version=new SourceVersions(store).save('project',{source:box,parentVersionId:null,actor:'user'});
 const session=new PythonSession(store,{documentId:'project',baseRevision:0,operationId:'diagnostic'},()=>{},new AbortController().signal,10);
 try{
 const unchecked=await session.run({sourceVersionId:version.versionId,sourceHash:version.sourceHash});
 expect(unchecked.acceptanceStatus).toBe('not-run');expect(unchecked.healthStatus).toBe('passed');expect(unchecked.preview).toBeDefined();expect(session.candidate.executionId).toBe(unchecked.executionId);
 const mismatch=await session.run({sourceVersionId:version.versionId,sourceHash:version.sourceHash,criteria:{bbox:[20,31,40],volume:24800}});
 expect(mismatch.acceptanceStatus).toBe('failed');expect(mismatch.diagnosticPreview).toBeDefined();expect(session.candidate.executionId).toBe(unchecked.executionId);
 await expect(session.finishExecution(mismatch.executionId)).rejects.toThrow();
 await expect(session.run({sourceVersionId:version.versionId,sourceHash:version.sourceHash,criteria})).rejects.toThrow(/acceptance/i);
 expect(store.snapshot('project').revision).toBe(0);
 }finally{await session.close();store.close();}
},30000);

test('C22 D24 D28 execution keeps immutable input and stale source cannot commit',async()=>{
 mkdirSync('.work/source-execution-phase-1-2',{recursive:true});const store=new RevisionStore(mkdtempSync(resolve('.work/source-execution-phase-1-2/concurrent-')));store.createDocument('project');
 const versions=new SourceVersions(store);const first=versions.save('project',{source:box+'import time\ntime.sleep(0.5)\n',parentVersionId:null,actor:'user'});
 const session=new PythonSession(store,{documentId:'project',baseRevision:0,operationId:'concurrent'},()=>{},new AbortController().signal,10);
 try{
 const pending=session.run({sourceVersionId:first.versionId,sourceHash:first.sourceHash,criteria});
 const changed=versions.save('project',{source:box.replace('20,30,40','20,31,40'),parentVersionId:first.versionId,actor:'user'});
 const completed=await pending;expect(completed.sourceHash).toBe(first.sourceHash);expect(completed.status).toBe('valid');
 await expect(session.finishExecution(completed.executionId)).rejects.toThrow(/Source version changed/);
 const validHash=session.candidate.preview.sha256;
 const diagnostic=await session.run({sourceVersionId:changed.versionId,sourceHash:changed.sourceHash});expect(diagnostic.acceptanceStatus).toBe('failed');expect(session.candidate.preview.sha256).toBe(validHash);
 await expect(session.finishExecution('unrelated-execution')).rejects.toThrow();
 const fixed=versions.save('project',{source:box,parentVersionId:changed.versionId,actor:'user'});const result=await session.run({sourceVersionId:fixed.versionId,sourceHash:fixed.sourceHash});
 await session.finishExecution(result.executionId);
 versions.save('project',{source:box+'# edited after finish\n',parentVersionId:fixed.versionId,actor:'user'});
 expect(()=>store.acceptPythonCandidate(session.envelope,{kind:'race-test'},result)).toThrow(/source changed/i);
 expect(store.snapshot('project').revision).toBe(0);
 }finally{await session.close();store.close();}
},30000);

test('C23 native execution timeout is durable and cannot publish',async()=>{
 mkdirSync('.work/source-execution-phase-1-2',{recursive:true});const store=new RevisionStore(mkdtempSync(resolve('.work/source-execution-phase-1-2/timeout-')));store.createDocument('project');
 const version=new SourceVersions(store).save('project',{source:'while True: pass',parentVersionId:null,actor:'user'});
 const session=new PythonSession(store,{documentId:'project',baseRevision:0,operationId:'timeout'},()=>{},new AbortController().signal,0.2);
 try{const result=await session.run({sourceVersionId:version.versionId,sourceHash:version.sourceHash});expect(result.error.type).toBe('Timeout');expect(result.commitEligible).toBe(false);
 const record=JSON.parse((store.db.prepare('SELECT record FROM python_executions WHERE execution_id=?').get(result.executionId) as any).record);expect(record.status).toBe('failed');expect(record.result.error.type).toBe('Timeout');expect(store.snapshot('project').revision).toBe(0);
 }finally{await session.close();store.close();}
},10000);

test('D28 a real competing formal commit invalidates the old execution base',async()=>{
 mkdirSync('.work/source-execution-phase-1-2',{recursive:true});const store=new RevisionStore(mkdtempSync(resolve('.work/source-execution-phase-1-2/base-')));store.createDocument('project');
 const version=new SourceVersions(store).save('project',{source:box,parentVersionId:null,actor:'user'});
 const first=new PythonSession(store,{documentId:'project',baseRevision:0,operationId:'first'},()=>{},new AbortController().signal,10);
 const second=new PythonSession(store,{documentId:'project',baseRevision:0,operationId:'second'},()=>{},new AbortController().signal,10);
 try{
 const a=await first.run({sourceVersionId:version.versionId,sourceHash:version.sourceHash,criteria});const b=await second.run({sourceVersionId:version.versionId,sourceHash:version.sourceHash,criteria});
 await second.finishExecution(b.executionId);store.acceptPythonCandidate(second.envelope,{kind:'competing-test'},b);
 await expect(first.finishExecution(a.executionId)).rejects.toThrow(/base revision changed/);expect(store.snapshot('project').revision).toBe(1);
 }finally{await first.close();await second.close();store.close();}
},15000);

test('F35 Python revision restore preserves original execution provenance and selects its source',async()=>{
 mkdirSync('.work/source-execution-phase-1-2',{recursive:true});const store=new RevisionStore(mkdtempSync(resolve('.work/source-execution-phase-1-2/restore-')));store.createDocument('project');
 const sources=new SourceVersions(store);let session:PythonSession|undefined;
 try{
 const first=sources.save('project',{source:box,parentVersionId:null,actor:'user'});
 session=new PythonSession(store,{documentId:'project',baseRevision:0,operationId:'first'},()=>{},new AbortController().signal,10);
 const original=await session.run({sourceVersionId:first.versionId,sourceHash:first.sourceHash,criteria});await session.finishExecution(original.executionId);store.acceptPythonCandidate(session.envelope,{kind:'restore-test'},original);await session.close();
 const originalHash=createHash('sha256').update(readFileSync(store.artifactPath('project',1,'model.FCStd'))).digest('hex');
 const second=sources.save('project',{source:box.replace('20,30,40','20,35,40'),parentVersionId:first.versionId,actor:'user'});
 session=new PythonSession(store,{documentId:'project',baseRevision:1,operationId:'second'},()=>{},new AbortController().signal,10);
 const changed=await session.run({sourceVersionId:second.versionId,sourceHash:second.sourceHash,criteria:{bbox:[20,35,40],volume:28000}});await session.finishExecution(changed.executionId);store.acceptPythonCandidate(session.envelope,{kind:'restore-test'},changed);
 const restored=store.restoreRevision('project',1,2,'restore-first');expect(restored.revision).toBe(3);expect(store.restoreRevision('project',1,2,'restore-first')).toEqual(restored);
 const snapshot=store.snapshot('project');expect(snapshot.validation.executionId).toBe(original.executionId);expect(snapshot.validation.sourceVersionId).toBe(first.versionId);expect(snapshot.validation.bbox).toEqual(criteria.bbox);
 expect(createHash('sha256').update(readFileSync(store.artifactPath('project',3,'model.FCStd'))).digest('hex')).toBe(originalHash);expect(readFileSync(store.artifactPath('project',3,'script.py'),'utf8')).toBe(box);
 expect(sources.head('project')?.versionId).toBe(first.versionId);expect(sources.list('project')).toHaveLength(2);
 expect(JSON.parse((store.db.prepare('SELECT record FROM python_executions WHERE execution_id=?').get(original.executionId) as any).record).formalRevision).toBe(1);
 expect(store.events('project',0).some(event=>event.type==='source_selected'&&(event.data as any).restoredFromRevision===1)).toBe(true);
 expect(store.restoreRevision('project',3,3,'restore-restored').revision).toBe(4);expect(store.snapshot('project').validation.executionId).toBe(original.executionId);
 }finally{await session?.close();store.close();}
},20000);

test('F39 real legacy formal package imports its surviving source once',async()=>{
 mkdirSync('.work/source-execution-phase-1-2',{recursive:true});const root=mkdtempSync(resolve('.work/source-execution-phase-1-2/legacy-formal-'));let store=new RevisionStore(root);store.createDocument('project');
 const worker=await WorkerClient.start({workspace:resolve(root,'staging')});
 const envelope={documentId:'project',operationId:'legacy',candidateId:randomUUID(),baseRevision:0},executionId=randomUUID(),createdAt=Date.now(),sourceHash=createHash('sha256').update(box).digest('hex');
 try{
 await worker.request('begin_python',{envelope});const result:any=await worker.request('execute_script',{envelope,executionId,source:box,criteria,seconds:10});expect(result.status).toBe('valid');
 const directory=store.candidatePath(envelope.candidateId),identity={...envelope,executionId,sourceHash,parentHash:null};
 writeFileSync(resolve(directory,'script.py'),box);writeFileSync(resolve(directory,'execution.json'),JSON.stringify(identity));writeFileSync(resolve(directory,'scripts.json'),JSON.stringify([{...identity,source:box,criteria,status:'valid',createdAt,result}]));
 await worker.request('prepare_python',{envelope,identity,criteria});store.commitCandidate(envelope,{kind:'legacy-python'});
 let versions=new SourceVersions(store);expect(versions.list('project')).toHaveLength(0);versions.migrateLegacy();versions.migrateLegacy();
 const imported=versions.head('project')!;expect(imported.source).toBe(box);expect(imported.sourceHash).toBe(sourceHash);expect(imported.actor).toBe('legacy');expect(imported.createdAt).toBe(createdAt);expect(versions.list('project')).toHaveLength(1);
 store.close();store=new RevisionStore(root);versions=new SourceVersions(store);expect(versions.list('project')).toHaveLength(1);expect(versions.read('project',imported.versionId).source).toBe(box);expect(store.snapshot('project').revision).toBe(1);
 }finally{await worker.close();store.close();}
},15000);
