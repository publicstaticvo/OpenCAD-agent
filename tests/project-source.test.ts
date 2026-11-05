import {test,expect} from 'vitest';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {RevisionStore} from '../gateway/revision-store.ts';
import {SourceVersions} from '../gateway/source-versions.ts';
import {projectSnapshot,projectHash,projectDiff,type PythonProject} from '../gateway/project-source.ts';

const project:PythonProject={files:{'main.FCMacro':'from cad.geometry import build\nbuild()\n','cad/__init__.py':'','cad/geometry.py':'def build(): pass\n','dimensions.json':'{"width":40}'},directories:['designs'],entrypoint:'main.FCMacro'};
test('P2 P3 P6 complete project snapshot hashes all files and reports each actual file diff',()=>{
 const first=projectSnapshot(project),second=projectSnapshot({...project,files:{...project.files,'cad/geometry.py':'def build(): return 40\n','cad/new.py':'value=1\n'}});
 expect(projectHash(first)).not.toBe(projectHash(second));expect(projectHash({...first,files:Object.fromEntries(Object.entries(first.files).reverse())})).toBe(projectHash(first));
 const changes=projectDiff(first,second);expect(changes.map(change=>change.path)).toEqual(['cad/geometry.py','cad/new.py']);expect(changes[0].diff).toContain('-def build(): pass');expect(changes[1].diff).toContain('+value=1');
 for(const path of ['/outside.py','../escape.py','cad/../../bad','cad//bad.py','cad/./bad.py','cad\\bad.py'])expect(()=>projectSnapshot({...project,files:{[path]:'bad'},entrypoint:path})).toThrow();
 expect(()=>projectSnapshot({...project,entrypoint:'missing.py'})).toThrow();expect(()=>projectSnapshot({...project,files:{...project.files,cad:'collision'}})).toThrow();
});
test('P6 C1 C2 immutable multi-file snapshots and mutable work tree survive reopening without duplicate checkpoints',()=>{
 mkdirSync('.work/project-python',{recursive:true});const directory=mkdtempSync(resolve('.work/project-python/source-'));let store=new RevisionStore(directory);store.createDocument('project');let sources=new SourceVersions(store);
 try{
 const first=sources.saveProject('project',{project,parentVersionId:null,actor:'user'});expect(first.project.files).toEqual(project.files);
 const draft=sources.workspace('project');const changed:PythonProject={...project,files:{...project.files,'cad/geometry.py':'def build(): return 60\n'}};
 const saved=sources.saveWorkspace('project',{source:changed.files[changed.entrypoint],project:changed,baseVersionId:first.versionId,expectedBaseVersionId:first.versionId,draftRevision:draft.draftRevision});expect(sources.list('project')).toHaveLength(1);
 const checkpoint=sources.checkpointWorkspace('project',{...saved,expectedBaseVersionId:saved.baseVersionId});expect(checkpoint.version?.project.files['cad/geometry.py']).toContain('return 60');expect(checkpoint.version?.sourceHash).toBe(projectHash(changed));
 const again=sources.checkpointWorkspace('project',{...checkpoint.workspace,expectedBaseVersionId:checkpoint.workspace.baseVersionId});expect(again.version?.versionId).toBe(checkpoint.version?.versionId);expect(sources.list('project')).toHaveLength(2);
 store.close();store=new RevisionStore(directory);sources=new SourceVersions(store);expect(sources.head('project')?.project.files).toEqual(changed.files);expect(sources.read('project',first.versionId).project.files).toEqual(project.files);
 }finally{store.close();}
});
