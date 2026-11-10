import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createPatch} from 'diff';
import {StoreError,type RevisionStore} from './revision-store.ts';
import {projectSnapshot,projectHash,projectDiff,singleFileProject,type PythonProject} from './project-source.ts';

export interface SourceVersion{
 versionId:string;documentId:string;source:string;sourceHash:string;parentVersionId:string|null;project:PythonProject;
 actor:'user'|'agent'|'legacy';createdAt:number;operationId:string|null;toolCallId:string|null;eventSeq:number;
}
export interface SaveSource{
 source:string;project?:PythonProject;parentVersionId:string|null;actor:'user'|'agent';sourceHash?:string;operationId?:string;toolCallId?:string;action?:'checkpoint'|'run'|'handoff';sourceOrigin?:'edit'|'import';
}
export interface SourceWorkspaceDraft{documentId:string;source:string;project:PythonProject;sourceHash:string;baseVersionId:string|null;draftRevision:number;updatedAt:number;headVersionId:string|null;headChanged:boolean;sourceOrigin:'edit'|'import';}
const digest=(source:string)=>createHash('sha256').update(source).digest('hex');

/** Project source is authoritative here; execution directories contain checked copies. */
export class SourceVersions{
 private project(documentId:string){if(!this.store.db.prepare('SELECT 1 FROM documents WHERE id=?').get(documentId))throw new StoreError('not_found','Project not found');}
 constructor(private store:RevisionStore){
  store.db.exec(`CREATE TABLE IF NOT EXISTS source_versions(
   version_id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id),source TEXT NOT NULL,source_hash TEXT NOT NULL,
   parent_version_id TEXT REFERENCES source_versions(version_id),actor TEXT NOT NULL,created_at INTEGER NOT NULL,
   operation_id TEXT,tool_call_id TEXT,event_seq INTEGER NOT NULL,legacy_key TEXT UNIQUE);
   CREATE INDEX IF NOT EXISTS source_project ON source_versions(document_id,created_at);
   CREATE TABLE IF NOT EXISTS source_heads(document_id TEXT PRIMARY KEY REFERENCES documents(id),version_id TEXT NOT NULL REFERENCES source_versions(version_id));
   CREATE TABLE IF NOT EXISTS source_workspaces(document_id TEXT PRIMARY KEY REFERENCES documents(id),source TEXT NOT NULL,source_hash TEXT NOT NULL,base_version_id TEXT REFERENCES source_versions(version_id),draft_revision INTEGER NOT NULL,updated_at INTEGER NOT NULL);`);
  if(!(store.db.prepare('PRAGMA table_info(source_workspaces)').all() as any[]).some(column=>column.name==='source_origin'))store.db.exec("ALTER TABLE source_workspaces ADD COLUMN source_origin TEXT NOT NULL DEFAULT 'edit'");
  for(const table of ['source_versions','source_workspaces'])if(!(store.db.prepare(`PRAGMA table_info(${table})`).all() as any[]).some(column=>column.name==='project_json'))store.db.exec(`ALTER TABLE ${table} ADD COLUMN project_json TEXT`);
 }
 private decode(row:any):SourceVersion{
  if(!row)throw new StoreError('not_found','Source version not found');
  const project=projectSnapshot(row.project_json?JSON.parse(row.project_json):singleFileProject(row.source));
  if(projectHash(project)!==row.source_hash||row.source!==(project.files[project.entrypoint]??''))throw new StoreError('corrupt','Source project integrity mismatch');
  return{versionId:row.version_id,documentId:row.document_id,source:row.source,project,sourceHash:row.source_hash,parentVersionId:row.parent_version_id,
   actor:row.actor,createdAt:row.created_at,operationId:row.operation_id,toolCallId:row.tool_call_id,eventSeq:row.event_seq};
 }
 read(documentId:string,versionId:string,sourceHash?:string):SourceVersion{
  this.project(documentId);
  const value=this.decode(this.store.db.prepare('SELECT * FROM source_versions WHERE document_id=? AND version_id=?').get(documentId,versionId));
  if(sourceHash!==undefined&&value.sourceHash!==sourceHash)throw new StoreError('conflict','Source hash mismatch');
  return value;
 }
 head(documentId:string):SourceVersion|null{
  this.project(documentId);
  const row=this.store.db.prepare('SELECT v.* FROM source_heads h JOIN source_versions v ON v.version_id=h.version_id WHERE h.document_id=?').get(documentId);
  return row?this.decode(row):null;
 }
 list(documentId:string):SourceVersion[]{this.project(documentId);return this.store.db.prepare('SELECT * FROM source_versions WHERE document_id=? ORDER BY created_at,rowid').all(documentId).map(row=>this.decode(row));}
 diff(documentId:string,versionId:string){const value=this.read(documentId,versionId);const parent=value.parentVersionId?this.read(documentId,value.parentVersionId).source:'';return createPatch('script.py',parent,value.source);}
 fileDiffs(documentId:string,versionId:string){const version=this.read(documentId,versionId);return projectDiff(version.parentVersionId?this.read(documentId,version.parentVersionId).project:null,version.project);}
 saveProject(documentId:string,input:Omit<SaveSource,'source'|'project'>&{project:PythonProject},options:{preserveConflict?:boolean;branch?:boolean}={}){const project=projectSnapshot(input.project);return this.save(documentId,{...input,project,source:project.files[project.entrypoint]??''},options);}
 workspace(documentId:string):SourceWorkspaceDraft{
  this.project(documentId);const head=this.head(documentId),row=this.store.db.prepare('SELECT * FROM source_workspaces WHERE document_id=?').get(documentId) as any;
  if(!row){const project=head?.project??singleFileProject('');return{documentId,source:head?.source??'',project,sourceHash:projectHash(project),baseVersionId:head?.versionId??null,draftRevision:0,updatedAt:0,headVersionId:head?.versionId??null,headChanged:false,sourceOrigin:'edit'};}
  const project=projectSnapshot(row.project_json?JSON.parse(row.project_json):singleFileProject(row.source));
  if(projectHash(project)!==row.source_hash)throw new StoreError('corrupt','Source workspace hash mismatch');
  return{documentId,source:row.source,project,sourceHash:row.source_hash,baseVersionId:row.base_version_id,draftRevision:row.draft_revision,updatedAt:row.updated_at,headVersionId:head?.versionId??null,headChanged:(head?.versionId??null)!==row.base_version_id,sourceOrigin:row.source_origin};
 }
 saveWorkspace(documentId:string,input:{source:string;project?:PythonProject;baseVersionId:string|null;expectedBaseVersionId:string|null;draftRevision:number;sourceOrigin?:'edit'|'import'}):SourceWorkspaceDraft{
  this.project(documentId);if(typeof input.source!=='string')throw new StoreError('invalid','Invalid Python source');
  const previous=this.store.db.prepare('SELECT project_json FROM source_workspaces WHERE document_id=?').get(documentId) as any;
  const priorProject=previous?.project_json?projectSnapshot(JSON.parse(previous.project_json)):this.head(documentId)?.project??singleFileProject('');
  if(input.project===undefined&&(Object.keys(priorProject.files).length>1||priorProject.entrypoint!==''&&priorProject.entrypoint!=='script.py'))throw new StoreError('conflict','The complete Python project must be submitted to preserve every file');
  const project=projectSnapshot(input.project??singleFileProject(input.source)),source=project.files[project.entrypoint]??'',sourceHash=projectHash(project);
  if(input.project&&input.source!==source)throw new StoreError('conflict','Workspace entrypoint text does not match the project snapshot');
  if(Buffer.byteLength(input.source)>1024*1024||Object.values(project.files).reduce((size,file)=>size+Buffer.byteLength(file),0)>4*1024*1024)throw new StoreError('invalid','Invalid Python project size');
  if(input.baseVersionId!==null&&typeof input.baseVersionId!=='string')throw new StoreError('invalid','baseVersionId must be a version identifier or null');
  if(!Number.isSafeInteger(input.draftRevision)||input.draftRevision<0)throw new StoreError('invalid','Invalid workspace revision');
  if(input.sourceOrigin!==undefined&&!['edit','import'].includes(input.sourceOrigin))throw new StoreError('invalid','Invalid source origin');
  this.store.db.exec('BEGIN IMMEDIATE');try{
   const current=this.store.db.prepare('SELECT * FROM source_workspaces WHERE document_id=?').get(documentId) as any;
   const currentHead=this.head(documentId)?.versionId??null;
   const currentRevision=current?.draft_revision??0,currentBase=current?current.base_version_id:currentHead;
   if(currentRevision!==input.draftRevision||currentBase!==input.expectedBaseVersionId)throw new StoreError('conflict','Source workspace changed in another editor; both copies are preserved');
   if(input.baseVersionId!==null)this.read(documentId,input.baseVersionId);
  const currentHash=current?.source_hash??this.head(documentId)?.sourceHash??projectHash(singleFileProject(''));
   if(currentHash!==sourceHash||currentBase!==input.baseVersionId||input.sourceOrigin!==undefined&&input.sourceOrigin!==(current?.source_origin??'edit')){
    const nextRevision=currentRevision+1,updatedAt=Date.now();
    this.store.db.prepare(`INSERT INTO source_workspaces VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET source=excluded.source,source_hash=excluded.source_hash,base_version_id=excluded.base_version_id,draft_revision=excluded.draft_revision,updated_at=excluded.updated_at,source_origin=excluded.source_origin,project_json=excluded.project_json`).run(documentId,source,sourceHash,input.baseVersionId,nextRevision,updatedAt,input.sourceOrigin??current?.source_origin??'edit',JSON.stringify(project));
    const previous=current?projectSnapshot(current.project_json?JSON.parse(current.project_json):singleFileProject(current.source)):priorProject;
    if(projectHash(previous)!==sourceHash)this.store.appendEvent(documentId,'source_workspace_saved',{actor:'user',sourceOrigin:input.sourceOrigin??current?.source_origin??'edit',draftRevision:nextRevision,createdAt:updatedAt,baseVersionId:input.baseVersionId,sourceHash,entrypoint:project.entrypoint,directories:project.directories,changes:projectDiff(previous,project)});
   }
   this.store.db.exec('COMMIT');return this.workspace(documentId);
  }catch(error){this.store.db.exec('ROLLBACK');throw error;}
 }
 checkpointWorkspace(documentId:string,input:{source:string;project?:PythonProject;baseVersionId:string|null;expectedBaseVersionId:string|null;draftRevision:number;sourceOrigin?:'edit'|'import';action?:'checkpoint'|'run'|'handoff'}):{workspace:SourceWorkspaceDraft;version:SourceVersion|null;conflict:boolean}{
  if(input.action!==undefined&&!['checkpoint','run','handoff'].includes(input.action))throw new StoreError('invalid','Invalid source action');
  const before=this.workspace(documentId);
  if(before.draftRevision!==input.draftRevision||before.baseVersionId!==input.expectedBaseVersionId){const branch=this.save(documentId,{source:input.source,project:input.project,parentVersionId:input.baseVersionId,actor:'user'},{branch:true});return{workspace:before,version:branch,conflict:true};}
  const workspace=this.saveWorkspace(documentId,input);if(!workspace.source.trim()&&Object.values(workspace.project.files).every(value=>!value.trim()))return{workspace,version:null,conflict:false};
  const head=this.head(documentId);
  const unchanged=workspace.baseVersionId?this.read(documentId,workspace.baseVersionId).sourceHash===workspace.sourceHash:Object.keys(workspace.project.files).length===0&&workspace.project.directories.length===0;
  if(workspace.headChanged&&unchanged&&head){const followed=this.saveWorkspace(documentId,{source:head.source,project:head.project,baseVersionId:head.versionId,expectedBaseVersionId:workspace.baseVersionId,draftRevision:workspace.draftRevision});return{workspace:followed,version:head,conflict:false};}
  if((head?.versionId??null)!==input.baseVersionId){
   this.store.db.exec('BEGIN IMMEDIATE');try{const branch=this.insert(documentId,{source:workspace.source,project:workspace.project,parentVersionId:input.baseVersionId,actor:'user'},null,false,'source_conflict_branch');this.store.db.exec('COMMIT');return{workspace,version:branch,conflict:true};}catch(error){this.store.db.exec('ROLLBACK');throw error;}
  }
  if(head?.sourceHash===workspace.sourceHash)return{workspace,version:head,conflict:false};
  const version=this.save(documentId,{source:workspace.source,project:workspace.project,parentVersionId:head?.versionId??null,actor:'user',action:input.action??'checkpoint',sourceOrigin:workspace.sourceOrigin});
  this.store.db.prepare('UPDATE source_workspaces SET base_version_id=?,draft_revision=draft_revision+1,updated_at=? WHERE document_id=?').run(version.versionId,Date.now(),documentId);
  return{workspace:this.workspace(documentId),version,conflict:false};
 }
 checkpointRun(documentId:string,input:Parameters<SourceVersions['checkpointWorkspace']>[1]&{executionEntrypoint?:string}){
  const entrypoint=input.executionEntrypoint??input.project?.entrypoint;
  if(!entrypoint||!(/\.(py|FCMacro)$/i.test(entrypoint))||!Object.hasOwn(input.project?.files??{},entrypoint))throw new StoreError('invalid','Execution entrypoint must be an existing .py or .FCMacro file');
  const result=this.checkpointWorkspace(documentId,{...input,action:'run'});
  if(result.conflict||!result.version||result.version.project.entrypoint===entrypoint)return result;
  const original=result.workspace.project;
  const version=this.saveProject(documentId,{project:{...result.version.project,entrypoint},parentVersionId:result.version.versionId,actor:'user',action:'run'});
  const current=this.workspace(documentId);
  const workspace=this.saveWorkspace(documentId,{...current,project:original,source:original.files[original.entrypoint]??'',expectedBaseVersionId:current.baseVersionId});
  return{workspace,version,conflict:false};
 }
 adoptBranch(documentId:string,versionId:string,expectedHeadVersionId:string|null):SourceVersion{
  const branch=this.read(documentId,versionId);if(!['user','agent'].includes(branch.actor))throw new StoreError('invalid','Only a user or Agent source branch can be adopted');
  this.store.db.exec('BEGIN IMMEDIATE');try{const head=this.head(documentId);if((head?.versionId??null)!==expectedHeadVersionId)throw new StoreError('conflict','Current source changed; compare the latest source before adopting this branch');const adopted=this.insert(documentId,{source:branch.source,project:branch.project,parentVersionId:head?.versionId??null,actor:'user'},null);this.store.db.prepare('INSERT INTO source_workspaces VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET source=excluded.source,source_hash=excluded.source_hash,base_version_id=excluded.base_version_id,draft_revision=source_workspaces.draft_revision+1,updated_at=excluded.updated_at,source_origin=excluded.source_origin,project_json=excluded.project_json').run(documentId,adopted.source,adopted.sourceHash,adopted.versionId,0,Date.now(),'edit',JSON.stringify(adopted.project));this.store.db.exec('COMMIT');return adopted;}catch(error){this.store.db.exec('ROLLBACK');throw error;}
 }
 save(documentId:string,input:SaveSource,options:{preserveConflict?:boolean;branch?:boolean}={}):SourceVersion{
  this.project(documentId);
  const existing=this.head(documentId)?.project;if(!input.project&&existing&&(Object.keys(existing.files).length>1||existing.assets||existing.directories.length||existing.entrypoint!=='script.py'))throw new StoreError('conflict','Submit the complete Python project to preserve all files');
  if(typeof input.source!=='string'||(!input.project&&!input.source.trim())||Buffer.byteLength(input.source)>1024*1024)throw new StoreError('invalid','Invalid Python source size');
  const project=projectSnapshot(input.project??singleFileProject(input.source));
  if(input.parentVersionId!==null&&typeof input.parentVersionId!=='string')throw new StoreError('invalid','parentVersionId must be a version identifier or null');
  if(!['user','agent'].includes(input.actor))throw new StoreError('invalid','Invalid source actor');
  if(input.sourceHash!==undefined&&input.sourceHash!==projectHash(project))throw new StoreError('conflict','Source hash mismatch');
  if(input.operationId&&!this.store.db.prepare('SELECT 1 FROM jobs WHERE document_id=? AND operation_id=?').get(documentId,input.operationId))throw new StoreError('not_found','Source task not found');
  this.store.db.exec('BEGIN IMMEDIATE');
  try{
   if(input.parentVersionId!==null)this.read(documentId,input.parentVersionId);
   if(options.branch){const branch=this.insert(documentId,input,null,false,'source_conflict_branch');this.store.db.exec('COMMIT');return branch;}
   if((this.head(documentId)?.versionId??null)!==input.parentVersionId){
    if(!options.preserveConflict)throw new StoreError('conflict','Source version conflict; read the current version before editing');
    const branch=this.insert(documentId,input,null,false,'source_conflict_branch');this.store.db.exec('COMMIT');return branch;
   }
   const current=this.head(documentId);if(current&&current.sourceHash===projectHash(project)){this.store.db.exec('COMMIT');return current;}
   const value=this.insert(documentId,input,null);
   this.store.db.exec('COMMIT');return value;
  }catch(error){this.store.db.exec('ROLLBACK');throw error;}
 }
 private insert(documentId:string,input:Omit<SaveSource,'actor'>&{actor:SourceVersion['actor'];createdAt?:number},legacyKey:string|null,promote=true,eventType='source_saved'):SourceVersion{
  const project=projectSnapshot(input.project??singleFileProject(input.source)),versionId=randomUUID(),sourceHash=projectHash(project),createdAt=input.createdAt??Date.now();
  const data={versionId,documentId,sourceHash,parentVersionId:input.parentVersionId,actor:input.actor,createdAt,operationId:input.operationId??null,toolCallId:input.toolCallId??null,...(input.action?{action:input.action}:{}),...(input.sourceOrigin?{sourceOrigin:input.sourceOrigin}:{})};
  const event=this.store.appendEvent(documentId,eventType,{...data,entrypoint:project.entrypoint,changes:projectDiff(input.parentVersionId?this.read(documentId,input.parentVersionId).project:null,project).map(({path,kind})=>({path,kind}))},input.operationId??null);
  this.store.db.prepare('INSERT INTO source_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(versionId,documentId,input.source,sourceHash,input.parentVersionId,input.actor,createdAt,input.operationId??null,input.toolCallId??null,event.seq,legacyKey,JSON.stringify(project));
  if(promote){
   this.store.db.prepare('INSERT INTO source_heads VALUES(?,?) ON CONFLICT(document_id) DO UPDATE SET version_id=excluded.version_id').run(documentId,versionId);
   const draft=this.store.db.prepare('SELECT * FROM source_workspaces WHERE document_id=?').get(documentId) as any;
   if(draft&&draft.base_version_id===input.parentVersionId){
    const parent=input.parentVersionId?this.read(documentId,input.parentVersionId).project:singleFileProject(''),working=projectSnapshot(draft.project_json?JSON.parse(draft.project_json):singleFileProject(draft.source));
    const local=projectDiff(parent,working),remote=projectDiff(parent,project),localPaths=new Set(local.map(change=>change.path));
    if(!remote.some(change=>localPaths.has(change.path))&&!(working.entrypoint!==parent.entrypoint&&project.entrypoint!==parent.entrypoint&&working.entrypoint!==project.entrypoint)){
     const merged:PythonProject={...project,files:{...project.files},assets:{...(project.assets??{})},directories:[...new Set([...project.directories,...working.directories])]};
     for(const change of local){delete merged.files[change.path];delete merged.assets![change.path];if(Object.hasOwn(working.files,change.path))merged.files[change.path]=working.files[change.path];if(Object.hasOwn(working.assets??{},change.path))merged.assets![change.path]=working.assets![change.path];}
     if(working.entrypoint!==parent.entrypoint)merged.entrypoint=working.entrypoint;
     const normalized=projectSnapshot(merged);this.store.db.prepare('UPDATE source_workspaces SET source=?,source_hash=?,project_json=?,base_version_id=?,draft_revision=draft_revision+1,updated_at=? WHERE document_id=?').run(normalized.files[normalized.entrypoint]??'',projectHash(normalized),JSON.stringify(normalized),versionId,createdAt,documentId);
    }
   }
  }
  return{...data,source:input.source,project,eventSeq:event.seq};
 }
 /** Only surviving historical bytes are imported; author and missing ancestry remain unknown. */
 migrateLegacy(){
  const imports:Array<{documentId:string;key:string;source:string;sourceHash:string;parentHash?:string;createdAt:number;operationId?:string}>=[];
  const readDirectory=(documentId:string,directory:string,key:string,operationId?:string)=>{
   if(existsSync(directory)&&(lstatSync(directory).isSymbolicLink()||!lstatSync(directory).isDirectory()))throw new StoreError('corrupt','Invalid legacy source directory');
   const path=join(directory,'scripts.json');if(!existsSync(path))return;
   if(lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile())throw new StoreError('corrupt','Invalid legacy source history');
   const records=JSON.parse(readFileSync(path,'utf8'));if(!Array.isArray(records))throw new StoreError('corrupt','Invalid legacy source records');
   for(const record of records){
    if(record.sourceVersionId){this.read(documentId,record.sourceVersionId,record.sourceHash);continue;}
    if(typeof record.source!=='string'||digest(record.source)!==record.sourceHash||typeof record.executionId!=='string'||!Number.isFinite(record.createdAt))throw new StoreError('corrupt','Legacy source hash or identity mismatch');
    imports.push({documentId,key:`${key}/${record.executionId}`,source:record.source,sourceHash:record.sourceHash,parentHash:record.parentHash,createdAt:record.createdAt,operationId});
   }
  };
  for(const row of this.store.db.prepare('SELECT document_id,revision,candidate_id FROM revisions ORDER BY revision').all() as any[]){
   this.store.candidatePath(row.candidate_id);
   readDirectory(row.document_id,join(this.store.root,'revisions',row.candidate_id),`revision/${row.candidate_id}`);
  }
  for(const row of this.store.db.prepare('SELECT document_id,operation_id,job FROM jobs').all() as any[]){
   const job=JSON.parse(row.job);if(job.candidateId)readDirectory(row.document_id,this.store.candidatePath(job.candidateId),`candidate/${job.candidateId}`,row.operation_id);
  }
  imports.sort((a,b)=>a.createdAt-b.createdAt);
  this.store.db.exec('BEGIN IMMEDIATE');
  try{
   for(const item of imports){
    if(this.store.db.prepare('SELECT 1 FROM source_versions WHERE legacy_key=?').get(item.key))continue;
    // A committed candidate can also have a surviving staging copy.
    const duplicate=this.store.db.prepare('SELECT 1 FROM source_versions WHERE document_id=? AND legacy_key LIKE ?').get(item.documentId,`%/${item.key.split('/').at(-1)}`);
    if(duplicate)continue;
    const parent=item.parentHash?this.store.db.prepare('SELECT version_id FROM source_versions WHERE document_id=? AND source_hash=? ORDER BY rowid DESC LIMIT 1').get(item.documentId,item.parentHash) as any:null;
    const existingHead=this.head(item.documentId);
    this.insert(item.documentId,{source:item.source,parentVersionId:parent?.version_id??null,actor:'legacy',createdAt:item.createdAt,operationId:item.operationId},item.key);
    if(existingHead&&existingHead.createdAt>item.createdAt)this.store.db.prepare('UPDATE source_heads SET version_id=? WHERE document_id=?').run(existingHead.versionId,item.documentId);
   }
   this.store.db.exec('COMMIT');
  }catch(error){this.store.db.exec('ROLLBACK');throw error;}
 }
}
