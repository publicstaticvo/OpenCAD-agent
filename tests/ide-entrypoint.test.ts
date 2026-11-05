import {test,expect} from 'vitest';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {RevisionStore} from '../gateway/revision-store.ts';
import {SourceVersions} from '../gateway/source-versions.ts';

test('freezing a file execution keeps the project default and exact immutable inputs',()=>{
 mkdirSync('.work/ide',{recursive:true});const store=new RevisionStore(mkdtempSync(resolve('.work/ide/entry-')));store.createDocument('project');
 try{
  const versions=new SourceVersions(store),draft=versions.workspace('project');
  const project={files:{'main.py':'main = 1\n','other.FCMacro':'other = 2\n','resource.txt':'data'},directories:[],entrypoint:'main.py'};
  const saved=versions.saveWorkspace('project',{...draft,project,source:project.files['main.py'],expectedBaseVersionId:null});
  const frozen=versions.checkpointRun('project',{...saved,expectedBaseVersionId:saved.baseVersionId,executionEntrypoint:'other.FCMacro'});
  expect(frozen.conflict).toBe(false);expect(frozen.version?.project.entrypoint).toBe('other.FCMacro');
  expect(frozen.version?.project.files).toEqual(project.files);expect(versions.workspace('project').project.entrypoint).toBe('main.py');
  expect(versions.head('project')?.versionId).toBe(frozen.version?.versionId);
  const next=versions.workspace('project');expect(()=>versions.checkpointRun('project',{...next,expectedBaseVersionId:next.baseVersionId,executionEntrypoint:'resource.txt'})).toThrow(/entrypoint/i);
  expect(versions.workspace('project').project.entrypoint).toBe('main.py');
 }finally{store.close();}
});

test('ordinary file saves preserve real project activity without creating source checkpoints',()=>{
 mkdirSync('.work/ide',{recursive:true});const store=new RevisionStore(mkdtempSync(resolve('.work/ide/activity-')));store.createDocument('project');
 try{const versions=new SourceVersions(store),draft=versions.workspace('project');const project={files:{'main.py':'width = 40\n'},directories:[],entrypoint:'main.py'};
 versions.saveWorkspace('project',{...draft,project,source:project.files['main.py'],expectedBaseVersionId:null});
 expect(versions.list('project')).toHaveLength(0);const event=store.events('project',0).find(event=>event.type==='source_workspace_saved');expect(event?.data).toMatchObject({actor:'user',draftRevision:1,changes:expect.arrayContaining([{path:'main.py',kind:'added',diff:expect.stringContaining('+width = 40')}])});
 }finally{store.close();}
});
