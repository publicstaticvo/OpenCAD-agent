import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,readdirSync,lstatSync,openSync,fsyncSync,closeSync,writeSync,copyFileSync,cpSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {assertContract,type Envelope,type DocumentSnapshot,type AppEvent} from '../shared/cad-contracts.ts';
const FILES=['model.FCStd','model.step','preview.glb','tree.json','validation.json','criteria.json'];
const hash=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
export function stableHash(value:unknown):string{
 const canonical=(x:any):any=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
 return hash(JSON.stringify(canonical(value)));
}
export class StoreError extends Error {code:string;constructor(code:string,message:string){super(message);this.code=code;}}
export type Boundary='beforeStageWrite'|'stageWrite'|'published'|'dbCommitted';
export class RevisionStore {
 readonly root:string;readonly db:DatabaseSync;private closed=false;
 private boundary:(name:Boundary)=>void;
 constructor(root:string,options:{boundary?:(name:Boundary)=>void}={}){
  this.root=resolve(root);this.boundary=options.boundary??(()=>{});
  for(const name of ['staging','revisions','quarantine'])mkdirSync(join(this.root,name),{recursive:true,mode:0o700});
  this.db=new DatabaseSync(join(this.root,'store.sqlite'));
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,head INTEGER NOT NULL DEFAULT 0,health TEXT NOT NULL DEFAULT 'healthy');
   CREATE TABLE IF NOT EXISTS revisions(document_id TEXT NOT NULL,revision INTEGER NOT NULL,candidate_id TEXT NOT NULL UNIQUE,manifest_hash TEXT NOT NULL,tree TEXT NOT NULL,validation TEXT NOT NULL,PRIMARY KEY(document_id,revision),FOREIGN KEY(document_id) REFERENCES documents(id));
   CREATE TABLE IF NOT EXISTS jobs(document_id TEXT NOT NULL,operation_id TEXT NOT NULL,status TEXT NOT NULL,request_hash TEXT NOT NULL,job TEXT NOT NULL,PRIMARY KEY(document_id,operation_id));
   CREATE TABLE IF NOT EXISTS operations(document_id TEXT NOT NULL,operation_id TEXT NOT NULL,request_hash TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(document_id,operation_id));
   CREATE TABLE IF NOT EXISTS events(document_id TEXT NOT NULL,seq INTEGER NOT NULL,event TEXT NOT NULL,PRIMARY KEY(document_id,seq));`);
  this.migrateWorkspace();this.reconcile();
 }
 private id(value:string){if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value))throw new StoreError('invalid','Invalid identifier');}
 createDocument(id:string,name:unknown=id){this.id(id);const title=this.title(name);this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT INTO documents(id,name,created_at,updated_at) VALUES(?,?,?,?)').run(id,title,Date.now(),Date.now());this.createConversation(id,'建模对话');this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}return this.snapshot(id);}
 private title(value:unknown){if(typeof value!=='string'||!value.trim()||value.trim().length>120)throw new StoreError('invalid','名称需要包含 1–120 个字符');return value.trim();}
 private migrateWorkspace(){
  const version=(this.db.prepare('PRAGMA user_version').get() as any).user_version;
  if(version>1)throw new StoreError('invalid','数据库版本高于当前程序支持范围');if(version===1)return;
  // SQLite backup is a consistent database snapshot, including committed WAL pages.
  const backup=join(this.root,`before-workspace-${randomUUID()}`);mkdirSync(backup,{mode:0o700});
  this.db.exec(`VACUUM INTO '${join(backup,'store.sqlite').replaceAll("'","''")}'`);
  cpSync(join(this.root,'revisions'),join(backup,'revisions'),{recursive:true,errorOnExist:true});
  this.db.exec('BEGIN IMMEDIATE');
  try{
   this.db.exec(`ALTER TABLE documents ADD COLUMN name TEXT NOT NULL DEFAULT ''; ALTER TABLE documents ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0; ALTER TABLE documents ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE jobs ADD COLUMN conversation_id TEXT;
    CREATE TABLE conversations(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id),title TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),ordinal INTEGER NOT NULL,operation_id TEXT NOT NULL,base_revision INTEGER NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(conversation_id,ordinal));
    CREATE INDEX conversation_project ON conversations(document_id);
    CREATE INDEX message_operation ON messages(conversation_id,operation_id);`);
   this.db.prepare("UPDATE documents SET name=id,created_at=?,updated_at=?").run(Date.now(),Date.now());
   for(const row of this.db.prepare('SELECT id FROM documents').all() as any[]){
    const conversation=this.createConversation(row.id,'建模对话');
    for(const old of this.db.prepare('SELECT job FROM jobs WHERE document_id=? ORDER BY rowid').all(row.id) as any[]){const job=JSON.parse(old.job);job.conversationId=conversation.id;this.db.prepare('UPDATE jobs SET conversation_id=?,job=? WHERE document_id=? AND operation_id=?').run(conversation.id,JSON.stringify(job),row.id,job.operationId);this.saveTranscript(job,job.agent?.messages??[]);}
   }
   this.db.exec('PRAGMA user_version=1; COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 listDocuments(){return this.db.prepare("SELECT id,name,created_at AS createdAt,updated_at AS updatedAt,head AS revision,(SELECT COUNT(*) FROM jobs WHERE document_id=documents.id AND status IN ('queued','running','validating','committing')) AS activeTasks FROM documents ORDER BY updated_at DESC,id").all();}
 renameDocument(id:string,name:unknown){this.document(id);this.db.prepare('UPDATE documents SET name=?,updated_at=? WHERE id=?').run(this.title(name),Date.now(),id);return this.snapshot(id);}
 listConversations(id:string){this.document(id);return this.db.prepare("SELECT c.*, (SELECT COUNT(*) FROM jobs WHERE conversation_id=c.id AND status IN ('queued','running','validating','committing')) AS activeTasks FROM conversations c WHERE document_id=? ORDER BY created_at,id").all(id) as any[];}
 createConversation(id:string,title:unknown='新对话'){this.document(id);const value={id:randomUUID(),document_id:id,title:this.title(title),created_at:Date.now(),updated_at:Date.now()};this.db.prepare('INSERT INTO conversations VALUES(?,?,?,?,?)').run(value.id,id,value.title,value.created_at,value.updated_at);return value;}
 conversation(id:string,conversationId:string){this.document(id);this.id(conversationId);const row=this.db.prepare('SELECT * FROM conversations WHERE id=? AND document_id=?').get(conversationId,id) as any;if(!row)throw new StoreError('not_found','该项目中不存在此对话');return row;}
 renameConversation(id:string,conversationId:string,title:unknown){this.conversation(id,conversationId);this.db.prepare('UPDATE conversations SET title=?,updated_at=? WHERE id=?').run(this.title(title),Date.now(),conversationId);return this.conversation(id,conversationId);}
 messages(id:string,conversationId:string,after=0,limit=100){this.conversation(id,conversationId);if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>500)throw new StoreError('invalid','无效的消息分页');const rows=this.db.prepare('SELECT * FROM messages WHERE conversation_id=? AND ordinal>? ORDER BY ordinal LIMIT ?').all(conversationId,after,limit+1) as any[];return{messages:rows.slice(0,limit).map(m=>({...m,content:JSON.parse(m.content),payload:JSON.parse(m.payload)})),hasMore:rows.length>limit,lastOrdinal:(this.db.prepare('SELECT COALESCE(MAX(ordinal),0) AS n FROM messages WHERE conversation_id=?').get(conversationId) as any).n};}
 saveMessage(job:any,key:string,message:any){
  if(!job.conversationId)return;this.conversation(job.documentId,job.conversationId);
  const id=`${job.documentId}/${job.operationId}/${key}`,old=this.db.prepare('SELECT ordinal FROM messages WHERE id=?').get(id) as any;
  const ordinal=old?.ordinal??(this.db.prepare('SELECT COALESCE(MAX(ordinal),0)+1 AS n FROM messages WHERE conversation_id=?').get(job.conversationId) as any).n;
  this.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,payload=excluded.payload').run(id,job.conversationId,ordinal,job.operationId,job.baseRevision,message.role,JSON.stringify(message.content),JSON.stringify(message),Date.now());
  this.db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(Date.now(),job.conversationId);
 }
 saveTranscript(job:any,messages:any[]){if(job.request?.text)this.saveMessage(job,'user',{role:'user',content:job.request.text,timestamp:Date.now()});let index=0;for(const message of messages)if(message.role==='assistant'||message.role==='toolResult')this.saveMessage(job,`agent-${index++}`,message);}
 conversationContext(id:string,conversationId:string,excludeOperation:string){this.conversation(id,conversationId);return(this.db.prepare("SELECT m.payload,m.base_revision FROM messages m JOIN jobs j ON j.document_id=? AND j.operation_id=m.operation_id WHERE m.conversation_id=? AND m.operation_id<>? AND j.status IN ('committed','answered') ORDER BY m.ordinal").all(id,conversationId,excludeOperation) as any[]).map(m=>({...JSON.parse(m.payload),cadBaseRevision:m.base_revision}));}
 private document(id:string):any{this.id(id);const row=this.db.prepare('SELECT * FROM documents WHERE id=?').get(id);if(!row)throw new StoreError('not_found','Document not found');return row;}
 health(id:string){return this.document(id).health as string;}
 candidatePath(id:string){this.id(id);return join(this.root,'staging',id);}
 private packagePath(id:string){this.id(id);return join(this.root,'revisions',id);}
 private verify(directory:string,expectedHash?:string){
  if(lstatSync(directory).isSymbolicLink())throw new StoreError('corrupt','Unsafe package directory');
  const manifestPath=join(directory,'manifest.json');if(lstatSync(manifestPath).isSymbolicLink())throw new StoreError('corrupt','Unsafe manifest');
  const raw=readFileSync(manifestPath);if(raw.length>65536)throw new StoreError('corrupt','Manifest too large');
  if(expectedHash&&hash(raw)!==expectedHash)throw new StoreError('corrupt','Manifest hash mismatch');
  const manifest=JSON.parse(raw.toString()).files;
  if(!manifest||Object.keys(manifest).sort().join('|')!==[...FILES].sort().join('|'))throw new StoreError('corrupt','Incomplete manifest');
  for(const name of FILES){
   const path=join(directory,name),stat=lstatSync(path);
   if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024||stat.size<=0)throw new StoreError('corrupt','Invalid package file');
   const entry=manifest[name],contents=readFileSync(path);
   if(stat.size!==entry.bytes||hash(contents)!==entry.sha256)throw new StoreError('corrupt','Artifact hash mismatch');
  }
  const tree=JSON.parse(readFileSync(join(directory,'tree.json'),'utf8')),validation=JSON.parse(readFileSync(join(directory,'validation.json'),'utf8'));
  if(!Array.isArray(tree)||!tree.length||validation.solids!==1||!(validation.volume>0)||!validation.glb?.triangles||!validation.step)throw new StoreError('corrupt','Missing validation report');
  return{manifestHash:hash(raw),tree,validation};
 }
 operationResult(documentId:string,operationId:string,request:unknown,baseRevision:number){
  this.id(documentId);this.id(operationId);const row:any=this.db.prepare('SELECT * FROM operations WHERE document_id=? AND operation_id=?').get(documentId,operationId);
  if(!row)return null;if(row.request_hash!==stableHash({baseRevision,request}))throw new StoreError('idempotency','Operation ID reused with different content');
  return JSON.parse(row.result);
 }
 restoreRevision(documentId:string,oldRevision:number,baseRevision:number,operationId:string){
  const request={restoreRevision:oldRevision},previous=this.operationResult(documentId,operationId,request,baseRevision);if(previous)return previous;
  if(this.db.prepare("SELECT 1 FROM jobs WHERE document_id=? AND status IN ('queued','running','validating','committing')").get(documentId))throw new StoreError('project_busy','项目正在修改，请等待当前任务结束');
  if(this.document(documentId).head!==baseRevision)throw new StoreError('conflict','Revision conflict');
  const candidateId=randomUUID(),directory=this.candidatePath(candidateId);
  const source=this.artifactPath(documentId,oldRevision,'model.FCStd');
  mkdirSync(directory,{mode:0o700});
  for(const name of [...FILES,'manifest.json'])copyFileSync(join(source,'..',name),join(directory,name));
  return this.commitCandidate({documentId,baseRevision,operationId,candidateId},request);
 }
 commitCandidate(envelope:Envelope,request:unknown){
  assertContract('envelope',envelope);
  const {documentId,candidateId,baseRevision,operationId}=envelope;
  const previous=this.operationResult(documentId,operationId,request,baseRevision);if(previous)return previous;
  const doc=this.document(documentId);if(doc.health!=='healthy')throw new StoreError('corrupt','Document is corrupt');
  if(doc.head!==baseRevision)throw new StoreError('conflict','Revision conflict');
  const stage=this.candidatePath(candidateId),official=this.packagePath(candidateId),verified=this.verify(stage);
  this.boundary('beforeStageWrite');
  const metadata=join(stage,'package.json'),text=JSON.stringify({envelope,requestHash:stableHash({baseRevision,request})}),fd=openSync(metadata,'w');
  try{const half=Math.floor(text.length/2);writeSync(fd,text.slice(0,half));this.boundary('stageWrite');writeSync(fd,text.slice(half));fsyncSync(fd);}finally{closeSync(fd);}
  for(const name of [...FILES,'manifest.json','package.json'])this.sync(join(stage,name));this.sync(stage);
  renameSync(stage,official);this.sync(join(this.root,'staging'));this.sync(join(this.root,'revisions'));
  this.boundary('published');
  let result:any;
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const repeated=this.operationResult(documentId,operationId,request,baseRevision);
   if(repeated){this.db.exec('ROLLBACK');return repeated;}
   const current=this.document(documentId);
   if(current.head!==baseRevision||current.health!=='healthy')throw new StoreError('conflict','Revision conflict');
   const revision=baseRevision+1;
   this.db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?,?)').run(documentId,revision,candidateId,verified.manifestHash,JSON.stringify(verified.tree),JSON.stringify(verified.validation));
   this.db.prepare('UPDATE documents SET head=?,updated_at=? WHERE id=? AND head=?').run(revision,Date.now(),documentId,baseRevision);
   const event=this.appendEvent(documentId,'committed',{candidateId,revision,operationId},operationId,revision,candidateId);
   result={documentId,revision,candidateId,operationId,seq:event.seq,status:'committed'};
   this.db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(documentId,operationId,stableHash({baseRevision,request}),JSON.stringify(result));
   const jobRow:any=this.db.prepare('SELECT job FROM jobs WHERE document_id=? AND operation_id=?').get(documentId,operationId);
   if(jobRow){const job=JSON.parse(jobRow.job);job.status='committed';job.result=result;job.error=null;this.db.prepare('UPDATE jobs SET status=?,job=? WHERE document_id=? AND operation_id=?').run('committed',JSON.stringify(job),documentId,operationId);}
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
  this.boundary('dbCommitted');return result;
 }
 appendEvent(documentId:string,type:string,data:unknown,jobId:string|null=null,revision?:number,candidateId:string|null=null):AppEvent{
  const doc=this.document(documentId),row:any=this.db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS seq FROM events WHERE document_id=?').get(documentId);
  const job=jobId?this.db.prepare('SELECT conversation_id FROM jobs WHERE document_id=? AND operation_id=?').get(documentId,jobId) as any:null;
  const event:AppEvent={seq:row.seq,documentId,type,data,jobId,revision:revision??doc.head,candidateId,conversationId:job?.conversation_id??null};
  this.db.prepare('INSERT INTO events VALUES(?,?,?)').run(documentId,event.seq,JSON.stringify(event));return event;
 }
 events(id:string,after:number):AppEvent[]{this.document(id);if(!Number.isSafeInteger(after)||after<0)throw new StoreError('invalid','Invalid event cursor');return this.db.prepare('SELECT event FROM events WHERE document_id=? AND seq>? ORDER BY seq').all(id,after).map((r:any)=>JSON.parse(r.event));}
 jobEvents(id:string,operationId:string,after=0,limit=200){
  this.document(id);if(!this.db.prepare('SELECT 1 FROM jobs WHERE document_id=? AND operation_id=?').get(id,operationId))throw new StoreError('not_found','Job not found');
  if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>500)throw new StoreError('invalid','Invalid event pagination');
  const rows=(this.db.prepare("SELECT event FROM events WHERE document_id=? AND json_extract(event,'$.jobId')=? AND seq>? ORDER BY seq LIMIT ?").all(id,operationId,after,limit+1) as any[]).map(row=>JSON.parse(row.event));
  const events=rows.slice(0,limit);return{events,hasMore:rows.length>limit,lastSeq:events.at(-1)?.seq??after};
 }
 snapshot(id:string):DocumentSnapshot{
  const doc=this.document(id);if(doc.health!=='healthy')throw new StoreError('corrupt','Formal revision corrupt or missing; no silent rollback');
  let tree:any[]=[],artifacts:Record<string,string>={};
  if(doc.head){const row:any=this.db.prepare('SELECT * FROM revisions WHERE document_id=? AND revision=?').get(id,doc.head);this.verify(this.packagePath(row.candidate_id),row.manifest_hash);tree=JSON.parse(row.tree);artifacts=Object.fromEntries(FILES.map(name=>[name,`/api/documents/${id}/revisions/${doc.head}/artifacts/${name}`]));}
  const seq:any=this.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM events WHERE document_id=?').get(id);
  const jobs=this.db.prepare('SELECT job FROM jobs WHERE document_id=? ORDER BY rowid').all(id).map((r:any)=>JSON.parse(r.job));
  const progress=(this.db.prepare("SELECT event FROM events WHERE document_id=? AND json_extract(event,'$.type') IN ('agent_progress','cad_progress') ORDER BY seq DESC LIMIT 500").all(id) as any[]).reverse().map(row=>JSON.parse(row.event));
  return{documentId:id,name:doc.name,conversations:this.listConversations(id),progress,revision:doc.head,lastSeq:seq.seq,tree,artifacts,jobs};
 }
 artifactPath(id:string,revision:number,name:string){
  this.document(id);if(!Number.isSafeInteger(revision)||revision<1||!FILES.includes(name))throw new StoreError('not_found','Artifact not found');
  const row:any=this.db.prepare('SELECT * FROM revisions WHERE document_id=? AND revision=?').get(id,revision);if(!row)throw new StoreError('not_found','Revision not found');
  const directory=this.packagePath(row.candidate_id);this.verify(directory,row.manifest_hash);return join(directory,name);
 }
 private sync(path:string){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
 private reconcile(){
  const revisions=this.db.prepare('SELECT * FROM revisions').all() as any[],refs=new Set(revisions.map(r=>r.candidate_id));
  for(const row of revisions){try{this.verify(this.packagePath(row.candidate_id),row.manifest_hash);}catch{this.db.prepare("UPDATE documents SET health='corrupt' WHERE id=?").run(row.document_id);}}
 }
 quarantineOrphans(){
  const refs=new Set((this.db.prepare('SELECT candidate_id FROM revisions').all() as any[]).map(r=>r.candidate_id));
  for(const name of readdirSync(join(this.root,'revisions'))){this.id(name);if(!refs.has(name))renameSync(join(this.root,'revisions',name),join(this.root,'quarantine',`${name}-${Date.now()}`));}
 }
 close(){if(!this.closed){this.closed=true;this.db.close();}}
}
