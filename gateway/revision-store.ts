import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,readdirSync,lstatSync,openSync,fsyncSync,closeSync,writeSync,copyFileSync} from 'node:fs';
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
   CREATE TABLE IF NOT EXISTS operations(document_id TEXT NOT NULL,operation_id TEXT NOT NULL,request_hash TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(document_id,operation_id));
   CREATE TABLE IF NOT EXISTS events(document_id TEXT NOT NULL,seq INTEGER NOT NULL,event TEXT NOT NULL,PRIMARY KEY(document_id,seq));`);
  this.reconcile();
 }
 private id(value:string){if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value))throw new StoreError('invalid','Invalid identifier');}
 createDocument(id:string){this.id(id);this.db.prepare('INSERT INTO documents(id) VALUES(?)').run(id);return this.snapshot(id);}
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
   this.db.prepare('UPDATE documents SET head=? WHERE id=? AND head=?').run(revision,documentId,baseRevision);
   const event=this.appendEvent(documentId,'committed',{candidateId,revision,operationId},operationId,revision,candidateId);
   result={documentId,revision,candidateId,operationId,seq:event.seq,status:'committed'};
   this.db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(documentId,operationId,stableHash({baseRevision,request}),JSON.stringify(result));
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
  this.boundary('dbCommitted');return result;
 }
 appendEvent(documentId:string,type:string,data:unknown,jobId:string|null=null,revision?:number,candidateId:string|null=null):AppEvent{
  const doc=this.document(documentId),row:any=this.db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS seq FROM events WHERE document_id=?').get(documentId);
  const event:AppEvent={seq:row.seq,documentId,type,data,jobId,revision:revision??doc.head,candidateId};
  this.db.prepare('INSERT INTO events VALUES(?,?,?)').run(documentId,event.seq,JSON.stringify(event));return event;
 }
 events(id:string,after:number):AppEvent[]{this.document(id);if(!Number.isSafeInteger(after)||after<0)throw new StoreError('invalid','Invalid event cursor');return this.db.prepare('SELECT event FROM events WHERE document_id=? AND seq>? ORDER BY seq').all(id,after).map((r:any)=>JSON.parse(r.event));}
 snapshot(id:string):DocumentSnapshot{
  const doc=this.document(id);if(doc.health!=='healthy')throw new StoreError('corrupt','Formal revision corrupt or missing; no silent rollback');
  let tree:any[]=[],artifacts:Record<string,string>={};
  if(doc.head){const row:any=this.db.prepare('SELECT * FROM revisions WHERE document_id=? AND revision=?').get(id,doc.head);this.verify(this.packagePath(row.candidate_id),row.manifest_hash);tree=JSON.parse(row.tree);artifacts=Object.fromEntries(FILES.map(name=>[name,`/api/documents/${id}/revisions/${doc.head}/artifacts/${name}`]));}
  const seq:any=this.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM events WHERE document_id=?').get(id);
  return{documentId:id,revision:doc.head,lastSeq:seq.seq,tree,artifacts,jobs:[]};
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
  for(const name of readdirSync(join(this.root,'revisions'))){this.id(name);if(!refs.has(name))renameSync(join(this.root,'revisions',name),join(this.root,'quarantine',`${name}-${Date.now()}`));}
 }
 close(){if(!this.closed){this.closed=true;this.db.close();}}
}
