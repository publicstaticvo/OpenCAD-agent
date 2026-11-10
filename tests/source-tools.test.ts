import {test,expect} from 'vitest';
import {mkdirSync,mkdtempSync,readdirSync,writeFileSync,symlinkSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {RevisionStore} from '../gateway/revision-store.ts';
import {SourceVersions} from '../gateway/source-versions.ts';
import {createSourceTools} from '../gateway/source-tools.ts';
import {makeFauxProvider,runPiLoop,pythonToolSchemas} from '../gateway/pi-adapter.mjs';

test('B07-B11 actual Pi file factories create immutable source versions without execution',async()=>{
 mkdirSync('.work/source-execution-phase-1-2',{recursive:true});const store=new RevisionStore(mkdtempSync(resolve('.work/source-execution-phase-1-2/tools-')));store.createDocument('project');
 try{
 const versions=new SourceVersions(store),tools=createSourceTools(versions,'project');
 const outside=resolve(store.root,'other-task-secret');writeFileSync(outside,'secret bytes');symlinkSync(outside,resolve(store.root,'script.py'));
 const write=await tools.write.execute('write-1',{path:'script.py',content:'width = 30\n'});
 const first=write.details.version;expect(first.parentVersionId).toBeNull();expect(first.toolCallId).toBe('write-1');
 const read=await tools.read.execute('read-1',{path:'script.py'});expect(read.details.version?.versionId).toBe(first.versionId);expect(read.content.find(c=>c.type==='text')).toMatchObject({text:expect.stringContaining('width = 30')});
 const edited=await tools.edit.execute('edit-1',{path:'script.py',edits:[{oldText:'width = 30',newText:'width = 45'}]});
 expect(edited.details.version.parentVersionId).toBe(first.versionId);expect(edited.details.version.sourceHash).not.toBe(first.sourceHash);
 expect(versions.read('project',first.versionId).source).toBe('width = 30\n');
 const old=await tools.read.execute('read-old',{path:'script.py',sourceVersionId:first.versionId});expect(old.details.version.versionId).toBe(first.versionId);
 expect(readdirSync(resolve(store.root,'staging'))).toEqual([]);expect(store.events('project',0).every(e=>e.type!=='python_execution')).toBe(true);
 expect(readFileSync(outside,'utf8')).toBe('secret bytes');
 }finally{store.close();}
});

test('B12 real file tools refuse path variants and stale edits',async()=>{
 mkdirSync('.work/source-execution-phase-1-2',{recursive:true});const store=new RevisionStore(mkdtempSync(resolve('.work/source-execution-phase-1-2/tools-')));store.createDocument('project');
 try{
 const versions=new SourceVersions(store),tools=createSourceTools(versions,'project');
 await tools.write.execute('first',{path:'script.py',content:'width = 30\n'});
 const first=versions.head('project')!;versions.save('project',{source:'width = 40\n',parentVersionId:first.versionId,actor:'user'});
 await expect(tools.edit.execute('stale',{path:'script.py',edits:[{oldText:'30',newText:'50'}]})).rejects.toThrow(/conflict/i);
 for(const path of ['../script.py','/etc/passwd','./script.py','script.py/../secret','~/script.py','script.py\u0000']){
  await expect(tools.read.execute('bad-read',{path})).rejects.toThrow();
  await expect(tools.write.execute('bad-write',{path,content:'unsafe'})).rejects.toThrow();
  await expect(tools.edit.execute('bad-edit',{path,edits:[{oldText:'x',newText:'y'}]})).rejects.toThrow();
 }
 expect(versions.head('project')?.source).toBe('width = 40\n');expect(versions.list('project')).toHaveLength(3);
 const branch=versions.list('project').at(-1)!;expect(branch.source).toBe('width = 50\n');expect(branch.parentVersionId).toBe(first.versionId);expect(versions.diff('project',branch.versionId)).toContain('+width = 50');
 }finally{store.close();}
});

test('B13 E34 actual Pi registration uses standard edits and has no legacy modeling tool',async()=>{
 mkdirSync('.work/source-execution-phase-1-2',{recursive:true});const store=new RevisionStore(mkdtempSync(resolve('.work/source-execution-phase-1-2/registration-')));store.createDocument('project');
 try{
 const versions=new SourceVersions(store);const tools=createSourceTools(versions,'project');let transcript:any;
 expect(Object.keys(pythonToolSchemas).sort()).toEqual(['cad_files','cad_run','edit','read','write']);
 const provider=makeFauxProvider([{calls:[{name:'write',args:{path:'script.py',content:'width = 30\n'}}]},{calls:[{name:'read',args:{path:'script.py'}}]},{calls:[{name:'edit',args:{path:'script.py',edits:[{oldText:'30',newText:'45'}]}}]},{text:'Saved without execution.'}]);
 await runPiLoop({task:'Save code without running',session:{mode:'python',baseRevision:0,sourceTools:tools,snapshot:async()=>store.snapshot('project'),inspect:async()=>({source:versions.head('project')})},signal:new AbortController().signal,provider,onTranscript:value=>{transcript=value;}});
 expect(versions.list('project')).toHaveLength(2);expect(versions.head('project')?.source).toBe('width = 45\n');expect(transcript.toolCalls).toBe(3);expect(transcript.blockedCalls).toBe(0);
 expect(transcript.messages.filter((m:any)=>m.role==='toolResult').every((m:any)=>JSON.parse(m.content.at(-1).text).version.versionId)).toBe(true);
 expect(readdirSync(resolve(store.root,'staging'))).toEqual([]);
 }finally{store.close();}
});

test('Pi receives the frozen IDE context as part of its actual initial user request',async()=>{
 mkdirSync('.work/source-execution-phase-1-2',{recursive:true});const store=new RevisionStore(mkdtempSync(resolve('.work/source-execution-phase-1-2/ide-context-')));store.createDocument('project');
 try{
  const versions=new SourceVersions(store),tools=createSourceTools(versions,'project'),context:any={projectId:'project',activeFile:{path:'design/plate.py',saved:false,unsaved:true,sourceVersionId:null,draftRevision:1,contentHash:'a'.repeat(64),createdBy:'user',empty:false},selectedCode:{path:'design/plate.py',from:{line:1,column:1},to:{line:1,column:8},text:'width=40',before:'',after:'',fileHash:'a'.repeat(64),sourceVersionId:null,draftRevision:1,unsaved:true},geometryReferences:[{projectId:'project',source:{kind:'revision',revision:1},modelHash:'b'.repeat(64),objectId:'Plate',displayName:'底板',objectType:'PartDesign::Body',selectionType:'face',subElement:'Face6',geometry:{area:2400,center:[30,20,8],normal:[0,0,1],bbox:[0,0,8,60,40,8]}}]};
  const provider=makeFauxProvider([{text:'Context received.'}]);let request='';const stream=provider.streamFn;provider.streamFn=async(model:any,contextValue:any,options:any)=>{request=JSON.stringify(contextValue);return stream(model,contextValue,options);};
  await runPiLoop({task:'Use the selected CAD face and source range',ideContext:context,session:{mode:'python',baseRevision:0,sourceTools:tools,snapshot:async()=>store.snapshot('project'),inspect:async()=>({source:versions.head('project')})},signal:new AbortController().signal,provider});
  expect(request).toContain('ideContext');expect(request).toContain('width=40');expect(request).toContain('Face6');
 }finally{store.close();}
});

test('Agent project tools preserve modules, directory operations and entrypoint changes as full source versions',async()=>{
 mkdirSync('.work/source-execution-phase-1-2',{recursive:true});const store=new RevisionStore(mkdtempSync(resolve('.work/source-execution-phase-1-2/multi-tools-')));store.createDocument('project');
 try{
  const versions=new SourceVersions(store),tools=createSourceTools(versions,'project');
  await tools.write.execute('write-main',{path:'design/main.py',content:'from helpers.dimensions import size\n'});
  const initial=versions.head('project')!;expect(initial.project.entrypoint).toBe('design/main.py');
  await tools.cad_files.execute('mkdir-resources',{operation:'mkdir',path:'design/resources'});
  await tools.write.execute('write-helper',{path:'design/helpers/dimensions.py',content:'def size(): return (40,30,10)\n'});
  const edited=await tools.edit.execute('edit-main',{path:'design/main.py',edits:[{oldText:'helpers.dimensions',newText:'design.helpers.dimensions'}]});
  expect(edited.details.changes.map((entry:any)=>entry.path)).toContain('design/main.py');
  await tools.cad_files.execute('move-helper',{operation:'move',path:'design/helpers',destination:'design/lib'});
  const version=versions.head('project')!;expect(version.project.files['design/lib/dimensions.py']).toContain('40,30,10');expect(version.project.entrypoint).toBe('design/main.py');
  expect(versions.fileDiffs('project',version.versionId).some(change=>change.path==='design/lib/dimensions.py')).toBe(true);
  const listing=await tools.cad_files.execute('list',{operation:'list'});expect(JSON.stringify(listing.details)).toContain('design/lib/dimensions.py');
  await tools.cad_files.execute('delete-resource',{operation:'delete',path:'design/resources'});expect(versions.head('project')!.project.directories).not.toContain('design/resources');
 }finally{store.close();}
});

test('imported user work copy checkpoints become readable and editable through actual Pi tools',async()=>{
 mkdirSync('.work/source-execution-phase-1-2',{recursive:true});const store=new RevisionStore(mkdtempSync(resolve('.work/source-execution-phase-1-2/import-tools-')));store.createDocument('project');
 try{
 const versions=new SourceVersions(store),draft=versions.workspace('project');
 const saved=versions.saveWorkspace('project',{source:'width = 30\n',baseVersionId:null,expectedBaseVersionId:null,draftRevision:draft.draftRevision,sourceOrigin:'import'});
 expect(versions.list('project')).toHaveLength(0);
 const checkpoint=versions.checkpointWorkspace('project',{...saved,expectedBaseVersionId:saved.baseVersionId,action:'handoff'});
 const tools=createSourceTools(versions,'project');const read=await tools.read.execute('read-import',{path:'script.py'});expect(read.details.version.versionId).toBe(checkpoint.version?.versionId);
 const edited=await tools.edit.execute('edit-import',{path:'script.py',edits:[{oldText:'width = 30',newText:'width = 45'}]});expect(edited.details.version.parentVersionId).toBe(checkpoint.version?.versionId);expect(versions.diff('project',edited.details.version.versionId)).toContain('-width = 30');
 const imported=store.events('project',0).find(event=>event.type==='source_saved')!;expect(imported.data).toMatchObject({sourceOrigin:'import',action:'handoff'});
 expect(store.events('project',0).every(event=>event.type!=='python_execution')).toBe(true);
 }finally{store.close();}
});
