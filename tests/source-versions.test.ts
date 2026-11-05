import {test,expect} from 'vitest';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {RevisionStore} from '../gateway/revision-store.ts';
import {SourceVersions} from '../gateway/source-versions.ts';

const digest=(source:string)=>createHash('sha256').update(source).digest('hex');
function setup(){mkdirSync('.work/source-execution-phase-1-2',{recursive:true});const root=mkdtempSync(resolve('.work/source-execution-phase-1-2/versions-'));const store=new RevisionStore(root);store.createDocument('project');return{root,store,versions:new SourceVersions(store)};}

test('A01-A04 immutable source chains, parent diffs and restart recovery',()=>{
 const {root,store,versions}=setup();
 const first=versions.save('project',{source:'x=1\n',parentVersionId:null,actor:'user'});
 const second=versions.save('project',{source:'x=2\n',parentVersionId:first.versionId,actor:'agent'});
 const third=versions.save('project',{source:'x=3\n',parentVersionId:second.versionId,actor:'agent'});
 expect(first.sourceHash).toBe(digest(first.source));expect(versions.read('project',first.versionId).source).toBe('x=1\n');
 expect(versions.diff('project',second.versionId)).toContain('-x=1');expect(versions.diff('project',second.versionId)).toContain('+x=2');
 expect(third.parentVersionId).toBe(second.versionId);expect(versions.list('project')).toHaveLength(3);
 expect(store.events('project',0).filter(e=>e.type==='source_saved')).toHaveLength(3);
 store.close();const reopened=new RevisionStore(root);const restored=new SourceVersions(reopened);
 try{expect(restored.head('project')?.versionId).toBe(third.versionId);expect(restored.read('project',first.versionId).source).toBe(first.source);}finally{reopened.close();}
});

test('A05 invalid hash, foreign project and stale parent cannot overwrite source',()=>{
 const {store,versions}=setup();try{
 const first=versions.save('project',{source:'original',parentVersionId:null,actor:'user'});
 expect(()=>versions.save('project',{source:'lost',parentVersionId:null,actor:'agent'})).toThrow(/conflict/i);
 expect(()=>versions.save('project',{source:'lost',parentVersionId:'missing',actor:'agent'})).toThrow();
 expect(()=>versions.read('project',first.versionId,'0'.repeat(64))).toThrow(/hash/i);
 store.createDocument('other');expect(()=>versions.read('other',first.versionId)).toThrow();
 expect(versions.head('project')?.source).toBe('original');expect(versions.list('project')).toHaveLength(1);
 }finally{store.close();}
});

test('A06 SQLite failure atomically preserves version, head and activity',()=>{
 const {store,versions}=setup();try{
 const first=versions.save('project',{source:'original',parentVersionId:null,actor:'user'});
 const before=store.events('project',0);
 store.db.exec("CREATE TRIGGER reject_source_event BEFORE INSERT ON events WHEN json_extract(NEW.event,'$.type')='source_saved' BEGIN SELECT RAISE(ABORT,'deliberate database failure'); END");
 expect(()=>versions.save('project',{source:'changed',parentVersionId:first.versionId,actor:'user'})).toThrow(/database failure/);
 expect(versions.head('project')?.versionId).toBe(first.versionId);expect(versions.list('project')).toHaveLength(1);expect(store.events('project',0)).toEqual(before);
 }finally{store.close();}
});

test('A07 surviving legacy candidate sources migrate once and survive candidate cleanup',()=>{
 const {root,store,versions}=setup();const candidateId='legacy-candidate';const path=store.candidatePath(candidateId);mkdirSync(path);
 const source='legacy = 1\n';writeFileSync(resolve(path,'scripts.json'),JSON.stringify([{source,sourceHash:digest(source),parentHash:'unknown',executionId:'legacy-execution',createdAt:1234}]));
 store.db.prepare('INSERT INTO jobs(document_id,operation_id,status,request_hash,job,conversation_id) VALUES(?,?,?,?,?,?)').run('project','legacy-job','failed','legacy',JSON.stringify({candidateId}),store.listConversations('project')[0].id);
 versions.migrateLegacy();versions.migrateLegacy();expect(versions.list('project')).toHaveLength(1);const imported=versions.head('project')!;
 expect(imported.actor).toBe('legacy');expect(imported.createdAt).toBe(1234);expect(imported.parentVersionId).toBeNull();
 rmSync(path,{recursive:true});store.close();const reopened=new RevisionStore(root);try{expect(new SourceVersions(reopened).read('project',imported.versionId).source).toBe(source);}finally{reopened.close();}
});

test('A08 work copies persist without immutable versions and unchanged saves do not advance',()=>{
 const {store,versions}=setup();try{
  const first=versions.save('project',{source:'width=20\n',parentVersionId:null,actor:'user'});
  const opened=versions.workspace('project');expect(opened.source).toBe(first.source);expect(opened.draftRevision).toBe(0);
  const changed=versions.saveWorkspace('project',{source:'width=30\n',baseVersionId:first.versionId,expectedBaseVersionId:first.versionId,draftRevision:0});
  expect(changed.draftRevision).toBe(1);expect(changed.headChanged).toBe(false);expect(versions.list('project')).toHaveLength(1);
  const repeated=versions.saveWorkspace('project',{source:'width=30\n',baseVersionId:first.versionId,expectedBaseVersionId:first.versionId,draftRevision:1});
  expect(repeated.draftRevision).toBe(1);expect(versions.list('project')).toHaveLength(1);
  expect(store.events('project',0).filter(event=>event.type==='source_saved')).toHaveLength(1);
 }finally{store.close();}
});

test('A09 stale editor writes are rejected while both source heads remain available',()=>{
 const {store,versions}=setup();try{
  const first=versions.save('project',{source:'width=20\n',parentVersionId:null,actor:'user'});
  versions.saveWorkspace('project',{source:'width=25\n',baseVersionId:first.versionId,expectedBaseVersionId:first.versionId,draftRevision:0});
  expect(()=>versions.saveWorkspace('project',{source:'width=27\n',baseVersionId:first.versionId,expectedBaseVersionId:first.versionId,draftRevision:0})).toThrow(/another editor/i);
  const editorConflict=versions.checkpointWorkspace('project',{source:'width=27\n',baseVersionId:first.versionId,expectedBaseVersionId:first.versionId,draftRevision:0});expect(editorConflict.conflict).toBe(true);expect(editorConflict.version?.source).toBe('width=27\n');expect(versions.workspace('project').source).toBe('width=25\n');expect(versions.head('project')?.versionId).toBe(first.versionId);
  const agent=versions.save('project',{source:'width=40\n',parentVersionId:first.versionId,actor:'agent'});
  const draft=versions.workspace('project');expect(draft.source).toBe('width=25\n');expect(draft.headChanged).toBe(true);
  const checkpoint=versions.checkpointWorkspace('project',{source:draft.source,baseVersionId:draft.baseVersionId,expectedBaseVersionId:draft.baseVersionId,draftRevision:draft.draftRevision});
  expect(checkpoint.conflict).toBe(true);expect(checkpoint.version?.parentVersionId).toBe(first.versionId);expect(versions.head('project')?.versionId).toBe(agent.versionId);
  expect(versions.diff('project',checkpoint.version!.versionId)).toContain('+width=25');
  expect(()=>versions.adoptBranch('project',checkpoint.version!.versionId,first.versionId)).toThrow(/changed/i);
  const adopted=versions.adoptBranch('project',checkpoint.version!.versionId,agent.versionId);
  expect(adopted.parentVersionId).toBe(agent.versionId);expect(versions.head('project')?.versionId).toBe(adopted.versionId);
  expect(versions.diff('project',adopted.versionId)).toContain('-width=40');
 }finally{store.close();}
});

test('unchanged work copy follows an Agent head at handoff without creating conflict branches',()=>{
 const {store,versions}=setup();try{
 const first=versions.save('project',{source:'width=20\n',parentVersionId:null,actor:'user'});
 versions.saveWorkspace('project',{source:first.source,baseVersionId:first.versionId,expectedBaseVersionId:first.versionId,draftRevision:0});
 const next=versions.save('project',{source:'width=40\n',parentVersionId:first.versionId,actor:'agent'}),draft=versions.workspace('project');
 const result=versions.checkpointWorkspace('project',{source:draft.source,baseVersionId:draft.baseVersionId,expectedBaseVersionId:draft.baseVersionId,draftRevision:draft.draftRevision});
 expect(result.conflict).toBe(false);expect(result.version?.versionId).toBe(next.versionId);expect(versions.workspace('project').source).toBe(next.source);expect(versions.list('project')).toHaveLength(2);
 }finally{store.close();}
});
