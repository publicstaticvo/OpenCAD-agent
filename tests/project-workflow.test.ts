import {test,expect} from 'vitest';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createGateway} from '../gateway/server.ts';
import {SourceVersions} from '../gateway/source-versions.ts';
import {createSourceTools} from '../gateway/source-tools.ts';

const token='project-workflow-local-access-token';
const project={files:{'main.FCMacro':"import FreeCAD as App, Part\nfrom design.dimensions import size\ndoc=App.newDocument('Project')\nobj=doc.addObject('PartDesign::Feature','Solid')\nobj.Shape=Part.makeBox(*size())\ndoc.recompute()\n",'design/__init__.py':'','design/dimensions.py':'def size(): return (40,30,10)\n','resources/note.txt':'project resource'},directories:['design','resources'],entrypoint:'main.FCMacro'};
test('P1 P2 P3 E1 E2 E6 E10 E13 E14 native whole-project run, restart, explicit acceptance and failure preservation',async()=>{
 mkdirSync('.work/project-workflow',{recursive:true});const dataDir=mkdtempSync(resolve('.work/project-workflow/native-'));
 let app=await createGateway({dataDir,port:0,accessToken:token});
 try{
  app.store.createDocument('project');const versions=new SourceVersions(app.store);const saved=versions.saveProject('project',{project,parentVersionId:null,actor:'user'});
  app.supervisor.submitPython('project',0,'first',{kind:'run',run:{sourceVersionId:saved.versionId,sourceHash:saved.sourceHash}});
  const first=await app.supervisor.waitForJob('project','first');expect(first.error).toBeNull();expect(first.status).toBe('awaiting_acceptance');expect(first.candidateSnapshot.geometry.bbox).toEqual([40,30,10]);expect(app.store.snapshot('project').revision).toBe(0);
  const preview=await fetch(app.baseUrl+first.candidateSnapshot.preview.url,{headers:{Authorization:`Bearer ${token}`}});expect(preview.status).toBe(200);expect((await preview.arrayBuffer()).byteLength).toBeGreaterThan(100);
  const execution=first.result.executionId;expect(app.store.events('project',0).filter(event=>event.type==='cad_progress').map(event=>(event.data as any).stage+':'+(event.data as any).status)).toEqual(['python_execute:start','python_execute:complete','python_verify:start','python_verify:complete']);
  await app.close();app=await createGateway({dataDir,port:0,accessToken:token});expect(app.supervisor.job('project','first').status).toBe('awaiting_acceptance');
  app.supervisor.acceptCandidate('project','first');expect(app.store.snapshot('project').revision).toBe(1);expect(app.store.snapshot('project').validation.executionId).toBe(execution);
  app.supervisor.acceptCandidate('project','first');expect(app.store.snapshot('project').revision).toBe(1);
  expect(JSON.parse(readFileSync(app.store.artifactPath('project',1,'project.json'),'utf8'))).toEqual(project);
  const original=createHash('sha256').update(readFileSync(app.store.artifactPath('project',1,'model.FCStd'))).digest('hex');
  const newer=new SourceVersions(app.store),broken=newer.saveProject('project',{project:{...project,files:{...project.files,'design/dimensions.py':'raise RuntimeError("source module failure")\n'}},parentVersionId:saved.versionId,actor:'user'});
  app.supervisor.submitPython('project',1,'broken',{kind:'run',run:{sourceVersionId:broken.versionId,sourceHash:broken.sourceHash}});
  const failure=await app.supervisor.waitForJob('project','broken');expect(failure.status).toBe('failed');expect(failure.error).toContain('source module failure');expect(app.store.snapshot('project').revision).toBe(1);
  expect(createHash('sha256').update(readFileSync(app.store.artifactPath('project',1,'model.FCStd'))).digest('hex')).toBe(original);
  const repaired=newer.saveProject('project',{project:{...project,files:{...project.files,'design/dimensions.py':'def size(): return (40,30,15)\n'}},parentVersionId:broken.versionId,actor:'user'});
  app.supervisor.submitPython('project',1,'repair',{kind:'run',run:{sourceVersionId:repaired.versionId,sourceHash:repaired.sourceHash}});
  const repair=await app.supervisor.waitForJob('project','repair');expect(repair.error).toBeNull();expect(repair.status).toBe('awaiting_acceptance');expect(repair.candidateSnapshot.geometry.bbox).toEqual([40,30,15]);app.supervisor.rejectCandidate('project','repair');expect(app.supervisor.job('project','repair').status).toBe('rejected');expect(app.store.snapshot('project').revision).toBe(1);
 }finally{await app.close();}
},40000);

test('actual Pi file tools create an independent design, retain unrelated files and execute its selected entrypoint',async()=>{
 mkdirSync('.work/ide',{recursive:true});const app=await createGateway({dataDir:mkdtempSync(resolve('.work/ide/agent-files-')),port:0,accessToken:token});
 try{app.store.createDocument('project');const versions=new SourceVersions(app.store);const original=versions.saveProject('project',{project,parentVersionId:null,actor:'user'}),tools=createSourceTools(versions,'project');
 const source="import FreeCAD as App, Part\ndoc=App.newDocument('Independent')\nobj=doc.addObject('PartDesign::Feature','NewSolid')\nobj.Shape=Part.makeBox(11,12,13)\ndoc.recompute()\n";
 const created=await tools.write.execute('new-design',{path:'design/independent.py',content:source});expect(created.details.changes).toEqual([expect.objectContaining({path:'design/independent.py',kind:'added',diff:expect.stringContaining('+obj.Shape')})]);
 await tools.cad_files.execute('choose-entry',{operation:'set_entrypoint',path:'design/independent.py'});const selected=versions.head('project')!;
 for(const [path,content]of Object.entries(original.project.files))expect(selected.project.files[path]).toBe(content);
 app.supervisor.submitPython('project',0,'independent',{kind:'run',run:{sourceVersionId:selected.versionId,sourceHash:selected.sourceHash}});const run=await app.supervisor.waitForJob('project','independent');expect(run.error).toBeNull();expect(run.status).toBe('awaiting_acceptance');expect(run.candidateSnapshot.geometry.bbox).toEqual([11,12,13]);app.supervisor.rejectCandidate('project','independent');
 const modified=await tools.edit.execute('change-design',{path:'design/independent.py',edits:[{oldText:'11,12,13',newText:'11,12,15'}]});expect(modified.details.changes).toHaveLength(1);expect(modified.details.changes[0].path).toBe('design/independent.py');expect(versions.head('project')!.project.files['main.FCMacro']).toBe(original.project.files['main.FCMacro']);
 }finally{await app.close();}
},30000);
