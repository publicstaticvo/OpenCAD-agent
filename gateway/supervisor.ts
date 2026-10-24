import {acquireOwner,writeLeaseJson,readLeaseJson} from './lease.ts';
import type {TextRunner,CadSession} from './agent.ts';
import {WorkerClient} from './worker-client.ts';
import {RevisionStore,StoreError,stableHash} from './revision-store.ts';
import {assertContract,budgets,type Envelope,type ModelProgram} from '../shared/cad-contracts.ts';
import {randomUUID} from 'node:crypto';
import {readFileSync,mkdirSync,copyFileSync,unlinkSync,existsSync,rmSync,closeSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
export interface Job{documentId:string;operationId:string;status:string;candidateId:string;baseRevision:number;request:any;result:any;error:string|null;agent?:any}
type Options={metadataBoundary?:(phase:string)=>void;textRunner?:TextRunner;operationMs?:number;taskMs?:number;observe?:(phase:string,job:Job)=>void|Promise<void>};
const terminal=new Set(['committed','failed','cancelled','interrupted']);
function startTime(pid:number){try{const data=readFileSync(`/proc/${pid}/stat`,'utf8');return data.slice(data.lastIndexOf(')')+2).split(' ')[19];}catch{return null;}}
export class Supervisor{
 activeWorker:WorkerClient|null=null;
 private store:RevisionStore;private options:Options;private nonce=randomUUID();private closed=false;private ownerFd:number|null=null;
 private queue:Promise<void>=Promise.resolve();private running=new Map<string,Promise<void>>();private active:Job|null=null;private controller:AbortController|null=null;
 private constructor(store:RevisionStore,options:Options){this.store=store;this.options=options;}
 static async start(store:RevisionStore,options:Options={}):Promise<Supervisor>{
  const s=new Supervisor(store,options),lock=join(store.root,'supervisor.lock');
  s.ownerFd=acquireOwner(join(store.root,'supervisor.owner.lock'));
  try{
   if(existsSync(lock)){
    readLeaseJson(lock); // diagnostic validation only; kernel fd is the ownership authority
   }
   // Only these known temporary diagnostic names belong to this lease protocol.
   for(const name of readdirSync(store.root))if(/^\.(supervisor\.lock|worker-lease\.json)\.[0-9a-f-]+\.tmp$/.test(name))unlinkSync(join(store.root,name));
   writeLeaseJson(lock,{pid:process.pid,start:startTime(process.pid),nonce:s.nonce},options.metadataBoundary);
   const lease=join(store.root,'worker-lease.json');
   if(existsSync(lease)){
    const worker=readLeaseJson(lease);
    if(Number.isInteger(worker.pid)&&worker.pid>1&&startTime(worker.pid)===worker.start){
     const command=readFileSync(`/proc/${worker.pid}/cmdline`,'utf8').split('\0');
     if(!command.includes(resolve('worker/main.py'))||!command.includes(join(store.root,'staging')))throw new StoreError('unsafe','Worker lease identity mismatch');
     try{process.kill(-worker.pid,'SIGKILL');}catch{}
    }
    unlinkSync(lease);
   }
   store.db.exec('BEGIN IMMEDIATE');
   try{
    for(const row of store.db.prepare("SELECT job FROM jobs WHERE status NOT IN ('committed','failed','cancelled','interrupted')").all() as any[]){const job:Job=JSON.parse(row.job);job.status='interrupted';job.error='Gateway restarted; no side effects replayed';s.persist(job);store.appendEvent(job.documentId,'job_updated',job,job.operationId);}
    store.db.exec('COMMIT');
   }catch(e){store.db.exec('ROLLBACK');throw e;}
   store.quarantineOrphans();s.prune();return s;
  }catch(e){if(existsSync(lock)){try{if(readLeaseJson(lock).nonce===s.nonce)unlinkSync(lock);}catch{}}if(s.ownerFd!==null){closeSync(s.ownerFd);s.ownerFd=null;}throw e;}
 }
 private key(doc:string,op:string){return `${doc}/${op}`;}
 job(doc:string,op:string):Job{
  const row:any=this.store.db.prepare('SELECT job FROM jobs WHERE document_id=? AND operation_id=?').get(doc,op);
  if(!row)throw new StoreError('not_found','Job not found');return JSON.parse(row.job);
 }
 private persist(job:Job){this.store.db.prepare('UPDATE jobs SET status=?,job=? WHERE document_id=? AND operation_id=?').run(job.status,JSON.stringify(job),job.documentId,job.operationId);}
 private state(job:Job,status:string,error:string|null=null){
  if(terminal.has(this.job(job.documentId,job.operationId).status))return;
  job.status=status;job.error=error;
  this.store.db.exec('BEGIN IMMEDIATE');try{this.persist(job);this.store.appendEvent(job.documentId,'job_updated',job,job.operationId);this.store.db.exec('COMMIT');}catch(e){this.store.db.exec('ROLLBACK');throw e;}
 }
 submitText(documentId:string,baseRevision:number,operationId:string,text:string):Job{
  if(!this.options.textRunner)throw new StoreError('unavailable','No explicitly configured model provider; fake mode must also be enabled explicitly');
  if(typeof text!=='string'||!text.trim()||text.length>8000)throw new StoreError('invalid','Invalid task text (1–8000 characters)');
  return this.enqueue(documentId,baseRevision,operationId,{kind:'text',text});
 }
 submit(documentId:string,baseRevision:number,operationId:string,program:unknown):Job{
  if(this.closed)throw new StoreError('closed','Gateway closed');
  assertContract('program',program);return this.enqueue(documentId,baseRevision,operationId,program);
 }
 private enqueue(documentId:string,baseRevision:number,operationId:string,program:unknown):Job{
  if(this.closed)throw new StoreError('closed','Gateway closed');
  const envelope={documentId,baseRevision,operationId,candidateId:randomUUID()};assertContract('envelope',envelope);
  const requestHash=stableHash({baseRevision,request:program});
  const prior:any=this.store.db.prepare('SELECT * FROM jobs WHERE document_id=? AND operation_id=?').get(documentId,operationId);
  if(prior){if(prior.request_hash!==requestHash)throw new StoreError('idempotency','Operation ID reused with different content');return JSON.parse(prior.job);}
  if(this.store.snapshot(documentId).revision!==baseRevision)throw new StoreError('conflict','Revision conflict');
  const queued:any=this.store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='queued'").get();if(queued.n>=100)throw new StoreError('busy','Queue is full');
  const job:Job={...envelope,status:'queued',request:program,result:null,error:null};
  this.store.db.exec('BEGIN IMMEDIATE');try{
   this.store.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run(documentId,operationId,'queued',requestHash,JSON.stringify(job));
   this.store.appendEvent(documentId,'job_updated',job,operationId);this.store.db.exec('COMMIT');
  }catch(e){this.store.db.exec('ROLLBACK');throw e;}
  const key=this.key(documentId,operationId),work=this.queue.then(()=>this.runCandidate(job));
  this.running.set(key,work);this.queue=work.catch(()=>{});
  void work.finally(()=>this.running.delete(key)).catch(()=>{});
  return job;
 }
 async waitForJob(doc:string,op:string){await this.running.get(this.key(doc,op));return this.job(doc,op);}
 cancelJob(doc:string,op:string){
  const job=this.job(doc,op);if(terminal.has(job.status))return job;
  this.state(job,'cancelled','Cancelled; no automatic resume');
  if(this.active?.documentId===doc&&this.active.operationId===op){this.controller?.abort(new Error('Cancelled'));void this.activeWorker?.close();}
  return this.job(doc,op);
 }
 private check(){
  if(this.controller?.signal.aborted)throw this.controller.signal.reason;
  if(this.activeWorker&&(this.activeWorker.process.exitCode!==null||this.activeWorker.process.signalCode!==null))throw new Error('Worker exited before formal commit');
 }
 private async phase(name:string,job:Job){await this.options.observe?.(name,job);this.check();}
 private async runCandidate(job:Job){
  if(this.closed||this.job(job.documentId,job.operationId).status!=='queued')return;
  this.active=job;this.controller=new AbortController();
  const timer=setTimeout(()=>{this.controller?.abort(new Error('Task timeout'));void this.activeWorker?.close();},this.options.taskMs??budgets.taskMs);
  const envelope:Envelope={documentId:job.documentId,baseRevision:job.baseRevision,operationId:job.operationId,candidateId:job.candidateId};
  try{
   if(this.store.snapshot(job.documentId).revision!==job.baseRevision)throw new StoreError('conflict','Revision conflict before Worker start');
   this.state(job,'running');const directory=this.store.candidatePath(job.candidateId);mkdirSync(directory,{mode:0o700});
   if(job.baseRevision)copyFileSync(this.store.artifactPath(job.documentId,job.baseRevision,'model.FCStd'),join(directory,'model.FCStd'));
   this.activeWorker=await WorkerClient.start({workspace:join(this.store.root,'staging')});this.check();
   writeLeaseJson(join(this.store.root,'worker-lease.json'),{pid:this.activeWorker.process.pid,start:startTime(this.activeWorker.process.pid!)},this.options.metadataBoundary);
   await this.activeWorker.request('begin_candidate',{envelope},this.options.operationMs);await this.phase('opened',job);
   const apply=async(operations:unknown,stepId:string)=>{this.check();const result=await this.activeWorker!.request('apply_operations',{envelope,stepId,operations},this.options.operationMs);await this.phase('modified',job);return result;};
   const prepare=async(criteria:any)=>{this.check();this.state(job,'validating');const result=await this.activeWorker!.request('prepare_candidate',{envelope,criteria},this.options.operationMs);await this.phase('prepared',job);return result.validation;};
   if(job.request.kind==='text'){
    const session:CadSession={baseRevision:job.baseRevision,inspect:()=>this.activeWorker!.request('inspect_document',{}),apply,prepare,snapshot:async()=>this.store.snapshot(job.documentId),progress:event=>this.store.appendEvent(job.documentId,'agent_progress',event,job.operationId),transcript:report=>{const current=this.job(job.documentId,job.operationId);current.agent=report;job.agent=report;this.persist(current);}};
    await this.options.textRunner!(job,session,this.controller.signal);this.check();
   }else{await apply(job.request.operations,'program');await prepare(job.request.criteria);}
   this.state(job,'committing');this.check();this.store.commitCandidate(envelope,job.request);
  }catch(e){
   const current=this.job(job.documentId,job.operationId);
   if(!terminal.has(current.status))this.state(job,this.closed?'interrupted':'failed',(e as Error).message.slice(0,2000));
  }finally{
   clearTimeout(timer);await this.activeWorker?.close();this.activeWorker=null;this.active=null;this.controller=null;
   const lease=join(this.store.root,'worker-lease.json');if(existsSync(lease))unlinkSync(lease);this.prune();
  }
 }
 private prune(){
  const jobs=this.store.db.prepare("SELECT job FROM jobs WHERE status IN ('failed','cancelled','interrupted') ORDER BY rowid DESC").all() as any[];
  for(const row of jobs.slice(10)){const job:Job=JSON.parse(row.job);const directory=this.store.candidatePath(job.candidateId);if(existsSync(directory))rmSync(directory,{recursive:true,force:true});}
 }
 async close(){
  if(this.closed)return;this.closed=true;this.controller?.abort(new Error('Gateway shutting down'));await this.activeWorker?.close();await this.queue;
  for(const row of this.store.db.prepare("SELECT job FROM jobs WHERE status='queued'").all() as any[]){const job:Job=JSON.parse(row.job);this.state(job,'interrupted','Gateway shut down before execution');}
  const lock=join(this.store.root,'supervisor.lock');try{if(existsSync(lock)&&readLeaseJson(lock).nonce===this.nonce)unlinkSync(lock);}finally{if(this.ownerFd!==null){closeSync(this.ownerFd);this.ownerFd=null;}}
 }
}
