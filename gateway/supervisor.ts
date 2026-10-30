import {acquireOwner,writeLeaseJson,readLeaseJson} from './lease.ts';
import type {TextRunner,CadSession} from './agent.ts';
import {WorkerClient} from './worker-client.ts';
import {RevisionStore,StoreError,stableHash} from './revision-store.ts';
import {assertContract,budgets,type Envelope,type ModelProgram} from '../shared/cad-contracts.ts';
import {randomUUID} from 'node:crypto';
import {readFileSync,mkdirSync,copyFileSync,unlinkSync,existsSync,rmSync,closeSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {defaultTimeouts,type TimeoutSettings} from './timeouts.ts';
import {createPlan,createProgramPlan,authorizeOperations,approvedStages,assertPlanIntegrity,assertCandidateSnapshot,type CadPlan} from './plan.ts';
export interface Job{documentId:string;conversationId?:string;operationId:string;status:string;candidateId:string;baseRevision:number;request:any;result:any;error:string|null;agent?:any;planningAgent?:any;plan?:CadPlan;approval?:{planHash:string;decision:'approved'|'rejected';decidedAt:number};candidateSequence?:number;candidateSnapshot?:any;stage?:number}
type Options={metadataBoundary?:(phase:string)=>void;textRunner?:TextRunner;timeouts?:()=>TimeoutSettings;operationMs?:number;taskMs?:number;observe?:(phase:string,job:Job)=>void|Promise<void>};
const terminal=new Set(['committed','answered','rejected','failed','cancelled','interrupted']);
function startTime(pid:number){try{const data=readFileSync(`/proc/${pid}/stat`,'utf8'),fields=data.slice(data.lastIndexOf(')')+2).split(' ');return ['Z','X'].includes(fields[0])?null:fields[19];}catch{return null;}}
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
     let command:string[]=[];
     try{command=readFileSync(`/proc/${worker.pid}/cmdline`,'utf8').split('\0');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
     // Parent-death cleanup can finish between the first identity read and cmdline.
     if(startTime(worker.pid)===worker.start){
      if(!command.includes(resolve('worker/main.py'))||!command.includes(join(store.root,'staging')))throw new StoreError('unsafe','Worker lease identity mismatch');
      try{process.kill(-worker.pid,'SIGKILL');}catch{}
     }
    }
    unlinkSync(lease);
   }
   store.db.exec('BEGIN IMMEDIATE');
   try{
    for(const row of store.db.prepare("SELECT job FROM jobs WHERE status NOT IN ('committed','answered','rejected','failed','cancelled','interrupted','awaiting_approval')").all() as any[]){const job:Job=JSON.parse(row.job);job.status='interrupted';job.error='Gateway restarted; no side effects replayed';s.persist(job);store.appendEvent(job.documentId,'job_updated',job,job.operationId);}
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
 submitText(documentId:string,baseRevision:number,operationId:string,text:string,conversationId?:string):Job{
  return this.submitPlannedText(documentId,baseRevision,operationId,text,conversationId);
 }
 submitPlannedText(documentId:string,baseRevision:number,operationId:string,text:string,conversationId?:string):Job{
  if(this.closed)throw new StoreError('closed','Gateway closed');
  if(!this.options.textRunner)throw new StoreError('unavailable','No explicitly configured model provider');
  if(typeof text!=='string'||!text.trim()||text.length>8000)throw new StoreError('invalid','Invalid task text (1–8000 characters)');
  assertContract('envelope',{documentId,baseRevision,operationId,candidateId:'pending'});
  const envelope={documentId,baseRevision,operationId,candidateId:''};
  const conversation=conversationId??this.store.listConversations(documentId)[0].id;this.store.conversation(documentId,conversation);
  const request={kind:'text',text};const requestHash=stableHash({baseRevision,request});
  const prior:any=this.store.db.prepare('SELECT * FROM jobs WHERE document_id=? AND operation_id=?').get(documentId,operationId);
  if(prior){if(prior.request_hash!==requestHash||prior.conversation_id!==conversation)throw new StoreError('idempotency','Operation ID reused with different content or conversation');return JSON.parse(prior.job);}
  if(this.store.snapshot(documentId).revision!==baseRevision)throw new StoreError('conflict','Revision conflict');
  const job:Job={...envelope,conversationId:conversation,status:'planning',request,result:null,error:null};
  this.store.db.exec('BEGIN IMMEDIATE');try{this.store.db.prepare('INSERT INTO jobs(document_id,operation_id,status,request_hash,job,conversation_id) VALUES(?,?,?,?,?,?)').run(documentId,operationId,job.status,requestHash,JSON.stringify(job),conversation);this.store.saveTranscript(job,[]);this.store.appendEvent(documentId,'job_updated',job,operationId);this.store.db.exec('COMMIT');}catch(e){this.store.db.exec('ROLLBACK');throw e;}
  this.schedule(job,()=>this.runPlanning(job));
  return job;
 }
 private schedule(job:Job,run:()=>Promise<void>){const key=this.key(job.documentId,job.operationId),work=this.queue.then(run);this.running.set(key,work);this.queue=work.catch(()=>{});void work.finally(()=>{if(this.running.get(key)===work)this.running.delete(key);}).catch(()=>{});}
 private saveAgent(job:Job,report:any,planning:boolean){
  if(planning){job.planningAgent=report;job.agent=report;}else job.agent={...report,messages:[...(job.planningAgent?.messages??[]),...report.messages]};
  const current=this.job(job.documentId,job.operationId);current.agent=job.agent;current.planningAgent=job.planningAgent;
  this.store.db.exec('BEGIN IMMEDIATE');try{this.persist(current);this.store.saveTranscript(current,current.agent.messages);this.store.db.exec('COMMIT');}catch(e){this.store.db.exec('ROLLBACK');throw e;}
 }
 private async runPlanning(job:Job){
  if(this.closed||this.job(job.documentId,job.operationId).status!=='planning')return;
  this.active=job;this.controller=new AbortController();
  const snapshot=()=>this.store.snapshot(job.documentId);
  const blocked=async()=>{throw new Error('CAD writing is prohibited before user approval');};
  try{
   const session:CadSession={mode:'planning',baseRevision:job.baseRevision,history:this.store.conversationContext(job.documentId,job.conversationId!,job.operationId),snapshot:async()=>snapshot(),inspect:async()=>({tree:snapshot().tree,revision:snapshot().revision}),apply:blocked,prepare:blocked,propose:async proposal=>{
    this.check();if(job.plan)throw new Error('Only one plan per task');
    const current=snapshot();if(current.revision!==job.baseRevision)throw new Error('Revision conflict during planning');
    const identity={documentId:job.documentId,operationId:job.operationId,requestHash:stableHash({baseRevision:job.baseRevision,request:job.request})};
    if((proposal as any)?.kind==='program'){
     if(this.options.textRunner!.mode!=='fake'||Object.keys(proposal as object).sort().join(',')!=='kind,program')throw new Error('Live planning requires a supported structured design');
     job.plan=createProgramPlan((proposal as any).program,identity,current.revision);
    }else job.plan=createPlan(proposal,identity,current);
    return job.plan;
   },progress:e=>this.progress(job,e),transcript:report=>this.saveAgent(job,report,true)};
   await this.options.textRunner!(job,session,this.controller.signal);this.check();
   if(job.plan){this.state(job,'awaiting_approval');this.store.appendEvent(job.documentId,'plan_ready',job.plan,job.operationId);}else this.state(job,'answered');
  }catch(error){this.state(job,this.closed?'interrupted':'failed',(error as Error).message);}
  finally{this.active=null;this.controller=null;}
 }
 approveJob(documentId:string,operationId:string,planHash:string):Job{
  let job:Job;
  this.store.db.exec('BEGIN IMMEDIATE');try{
   job=this.job(documentId,operationId);
   if(!job.plan||job.plan.planHash!==planHash)throw new StoreError('conflict','Plan hash is stale');assertPlanIntegrity(job.plan);
   if(job.approval?.decision==='approved'){this.store.db.exec('COMMIT');return job;}
   if(job.status!=='awaiting_approval')throw new StoreError('conflict','Job is not awaiting approval');
   if(this.store.snapshot(documentId).revision!==job.baseRevision)throw new StoreError('conflict','Plan base revision is stale');
   if(this.store.db.prepare("SELECT 1 FROM jobs WHERE document_id=? AND status IN ('approved','queued','running','validating','committing')").get(documentId))throw new StoreError('project_busy','项目正在修改，请等待当前任务结束');
   job.candidateId=randomUUID();job.approval={planHash,decision:'approved',decidedAt:Date.now()};job.status='approved';job.stage=0;
   this.persist(job);this.store.appendEvent(documentId,'plan_approved',job,operationId);this.store.db.exec('COMMIT');
  }catch(e){this.store.db.exec('ROLLBACK');throw e;}
  this.schedule(job!,()=>this.runCandidate(job!));return job!;
 }
 rejectJob(documentId:string,operationId:string,planHash:string):Job{this.store.db.exec('BEGIN IMMEDIATE');try{const job=this.job(documentId,operationId);if(!job.plan||job.plan.planHash!==planHash)throw new StoreError('conflict','Plan is stale');if(job.approval?.decision==='rejected'){this.store.db.exec('COMMIT');return job;}if(job.status!=='awaiting_approval')throw new StoreError('conflict','Plan is not awaiting approval');job.status='rejected';job.approval={planHash,decision:'rejected',decidedAt:Date.now()};this.persist(job);this.store.appendEvent(documentId,'plan_rejected',job,operationId);this.store.db.exec('COMMIT');return job;}catch(e){this.store.db.exec('ROLLBACK');throw e;}}
 submit(documentId:string,baseRevision:number,operationId:string,program:unknown,conversationId?:string):Job{
  if(this.closed)throw new StoreError('closed','Gateway closed');
  assertContract('program',program);return this.enqueue(documentId,baseRevision,operationId,program,conversationId);
 }
 private enqueue(documentId:string,baseRevision:number,operationId:string,program:unknown,conversationId?:string):Job{
  if(this.closed)throw new StoreError('closed','Gateway closed');
  assertContract('envelope',{documentId,baseRevision,operationId,candidateId:'pending'});const envelope={documentId,baseRevision,operationId,candidateId:''};
  conversationId=conversationId??this.store.listConversations(documentId)[0].id;
  this.store.conversation(documentId,conversationId!);
  const requestHash=stableHash({baseRevision,request:program});
  const prior:any=this.store.db.prepare('SELECT * FROM jobs WHERE document_id=? AND operation_id=?').get(documentId,operationId);
  if(prior){if(prior.request_hash!==requestHash||prior.conversation_id!==conversationId)throw new StoreError('idempotency','Operation ID reused with different content or conversation');return JSON.parse(prior.job);}
  if(this.store.snapshot(documentId).revision!==baseRevision)throw new StoreError('conflict','Revision conflict');
  const queued:any=this.store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='queued'").get();if(queued.n>=100)throw new StoreError('busy','Queue is full');
  const job:Job={...envelope,conversationId,status:'awaiting_approval',request:program,result:null,error:null,plan:createProgramPlan(program,{documentId,operationId,requestHash},baseRevision)};
  this.store.db.exec('BEGIN IMMEDIATE');try{
   this.store.db.prepare('INSERT INTO jobs(document_id,operation_id,status,request_hash,job,conversation_id) VALUES(?,?,?,?,?,?)').run(documentId,operationId,job.status,requestHash,JSON.stringify(job),conversationId!);
   this.store.saveTranscript(job,[]);
   this.store.appendEvent(documentId,'job_updated',job,operationId);this.store.db.exec('COMMIT');
  }catch(e){this.store.db.exec('ROLLBACK');throw e;}
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
  if(this.closed||this.job(job.documentId,job.operationId).status!=='approved')return;
  this.active=job;this.controller=new AbortController();
  const settings=this.options.timeouts?.()??this.options.textRunner?.timeouts?.()??defaultTimeouts;
  const taskMs=this.options.taskMs??settings.taskSeconds*1000,operationMs=this.options.operationMs??settings.cadSeconds*1000;
  const timer=taskMs>0?setTimeout(()=>{this.controller?.abort(new Error('Task timeout'));void this.activeWorker?.close();},taskMs):undefined;
  const envelope:Envelope={documentId:job.documentId,baseRevision:job.baseRevision,operationId:job.operationId,candidateId:job.candidateId};let discardCandidate=false;
  try{
   if(this.store.snapshot(job.documentId).revision!==job.baseRevision)throw new StoreError('conflict','Revision conflict before Worker start');
   this.assertApproval(job);this.state(job,'running');const directory=this.store.candidatePath(job.candidateId);mkdirSync(directory,{mode:0o700});
   if(job.baseRevision)copyFileSync(this.store.artifactPath(job.documentId,job.baseRevision,'model.FCStd'),join(directory,'model.FCStd'));
   this.activeWorker=await WorkerClient.start({workspace:join(this.store.root,'staging'),operationMs,onProgress:event=>{if(!terminal.has(this.job(job.documentId,job.operationId).status))this.store.appendEvent(job.documentId,'cad_progress',{...event,planHash:job.plan!.planHash},job.operationId,undefined,job.candidateId);}});this.check();
   writeLeaseJson(join(this.store.root,'worker-lease.json'),{pid:this.activeWorker.process.pid,start:startTime(this.activeWorker.process.pid!)},this.options.metadataBoundary);
   const opened=await this.activeWorker.request('begin_candidate',{envelope});
   if(stableHash(opened.tree)!==stableHash(this.store.snapshot(job.documentId).tree))throw new Error('Candidate base differs from the formal revision');
   await this.phase('opened',job);
   let fatal:Error|null=null;
   const guard=()=>{this.check();if(fatal)throw fatal;this.assertApproval(job);};
   const apply=async(operations:unknown,stepId:string)=>{
    try{guard();authorizeOperations(job.plan!,operations,job.stage??0);}catch(error){fatal=error as Error;this.store.appendEvent(job.documentId,'cad_operation_rejected',{stepId,planHash:job.plan?.planHash,operations,error:String(error)},job.operationId,undefined,job.candidateId);throw error;}
    const stage=approvedStages(job.plan!)[job.stage??0];
    this.store.appendEvent(job.documentId,'cad_operation_start',{stepId,planHash:job.plan!.planHash,stage:stage.name,operations},job.operationId,undefined,job.candidateId);
    try{
     const assemblyOperation=(operations as any[])[0];
     const assemblyPlan=job.plan!.kind==='pin_plate_assembly'||job.plan!.kind==='edit_pin_plate_assembly';
     const result=assemblyPlan?(assemblyOperation.op==='assembly_check'?await this.activeWorker!.request('assembly_check',{envelope,design:assemblyOperation.design}):await this.activeWorker!.request('assembly_stage',{envelope,stage:assemblyOperation.stage,design:assemblyOperation.design})):await this.activeWorker!.request('apply_operations',{envelope,stepId,operations});guard();
     this.store.appendEvent(job.documentId,'cad_operation_complete',{stepId,stage:stage.name,result,planHash:job.plan!.planHash},job.operationId,undefined,job.candidateId);
     job.stage=(job.stage??0)+1;this.persist(job);
     if(stage.sketchId||assemblyPlan)await this.candidateSnapshot(job,stage.sketchId,job.stage===approvedStages(job.plan!).length);
     await this.phase('modified',job);return result;
    }catch(error){fatal=error as Error;this.store.appendEvent(job.documentId,'cad_operation_failed',{stepId,error:String(error),planHash:job.plan!.planHash},job.operationId,undefined,job.candidateId);throw error;}
   };
   const prepare=async(criteria:any)=>{
    try{guard();if(job.stage!==approvedStages(job.plan!).length)throw new Error('Approved CAD stages incomplete');if(stableHash(criteria)!==stableHash(job.plan!.criteria))throw new Error('Finish criteria differ from approved plan');
     this.state(job,'validating');const result=await this.activeWorker!.request('prepare_candidate',{envelope,criteria:job.plan!.criteria,design:job.plan});await this.phase('prepared',job);return result.validation;
    }catch(error){fatal=error as Error;throw error;}
   };
   if(job.request.kind==='text'){
    const offset=job.planningAgent?.messages.length??0;
    const session:CadSession={mode:'execution',plan:job.plan,stages:approvedStages(job.plan!),get stage(){return job.stage??0;},baseRevision:job.baseRevision,history:this.store.conversationContext(job.documentId,job.conversationId!,job.operationId),inspect:()=>this.activeWorker!.request('inspect_document',{}),apply,prepare,snapshot:async()=>this.store.snapshot(job.documentId),progress:event=>this.progress(job,event.messageIndex===undefined?event:{...event,messageIndex:event.messageIndex+offset}),transcript:report=>this.saveAgent(job,report,false)};
    const criteria=await this.options.textRunner!(job,session,this.controller.signal);guard();
    if(criteria===undefined){discardCandidate=true;this.state(job,'answered');return;}
   }else{await apply(job.request.operations,'program');await prepare(job.request.criteria);}
   guard();this.state(job,'committing');this.check();this.store.commitCandidate(envelope,job.request);
  }catch(e){
   const current=this.job(job.documentId,job.operationId);
   if(!terminal.has(current.status))this.state(job,this.closed?'interrupted':'failed',((this.controller?.signal.aborted?this.controller.signal.reason:e) as Error).message.slice(0,2000));
  }finally{
   clearTimeout(timer);await this.activeWorker?.close();this.activeWorker=null;if(discardCandidate)rmSync(this.store.candidatePath(job.candidateId),{recursive:true,force:true});this.active=null;this.controller=null;
   const lease=join(this.store.root,'worker-lease.json');if(existsSync(lease))unlinkSync(lease);this.prune();
  }
 }
 private assertApproval(job:Job){
  const saved=this.job(job.documentId,job.operationId);
  if(!job.plan||!saved.plan||saved.approval?.decision!=='approved'||saved.approval.planHash!==job.plan.planHash||saved.plan.planHash!==job.plan.planHash||!['approved','running','validating','committing'].includes(saved.status))throw new Error('CAD write requires an active approved plan');
  assertPlanIntegrity(saved.plan);if(this.store.snapshot(job.documentId).revision!==job.baseRevision)throw new Error('Approved base revision is stale');
 }
 private progress(job:Job,event:any){
  if(terminal.has(this.job(job.documentId,job.operationId).status))return;
  this.store.db.exec('BEGIN IMMEDIATE');try{if(event.message&&event.messageIndex!==undefined)this.store.saveMessage(job,`agent-${event.messageIndex}`,event.message);this.store.appendEvent(job.documentId,'agent_progress',event,job.operationId);this.store.db.exec('COMMIT');}catch(e){this.store.db.exec('ROLLBACK');throw e;}
 }
 private async candidateSnapshot(job:Job,sketchId:string,includePreview:boolean){
  if(!this.activeWorker||!job.candidateId||!job.plan)return;
  const sequence=(job.candidateSequence??0)+1;
  const data:any=await this.activeWorker.request('candidate_snapshot',{envelope:{documentId:job.documentId,baseRevision:job.baseRevision,operationId:job.operationId,candidateId:job.candidateId},sketchId,includePreview,sequence});
  this.check();this.assertApproval(job);
  if(data.candidateId!==job.candidateId)throw new Error('Candidate snapshot identity mismatch');
  if(job.plan.kind==='pin_plate_assembly'||job.plan.kind==='edit_pin_plate_assembly'){
   const expected=job.plan.kind==='edit_pin_plate_assembly'?2:job.stage===1?1:2;
   if(data.geometry?.solids!==expected||data.tree.filter((row:any)=>row.type==='PartDesign::Body').length!==expected)throw new Error('Assembly candidate part count mismatch');
   if((job.plan.kind==='edit_pin_plate_assembly'&&job.stage!>=1)||(job.plan.kind==='pin_plate_assembly'&&job.stage!>=3)){
    if(data.assembly?.components.length!==2)throw new Error('Assembly components missing');
   }
  }else assertCandidateSnapshot(job.plan,job.stage!,data);
  data.baseRevision=job.baseRevision;data.planHash=job.plan.planHash;data.sequence=sequence;
  if(data.preview)data.preview.url=`/api/documents/${job.documentId}/jobs/${job.operationId}/candidate/preview?sequence=${sequence}`;
  this.store.db.exec('BEGIN IMMEDIATE');try{
   this.check();this.assertApproval(job);const current=this.job(job.documentId,job.operationId);
   if(current.candidateId!==job.candidateId||(current.candidateSequence??0)!==sequence-1)throw new Error('Candidate snapshot state changed');
   current.candidateSnapshot=data;current.candidateSequence=sequence;this.persist(current);
   this.store.appendEvent(job.documentId,'candidate_snapshot',data,job.operationId,undefined,job.candidateId);
   this.store.db.exec('COMMIT');
  }catch(error){this.store.db.exec('ROLLBACK');throw error;}
  job.candidateSequence=sequence;job.candidateSnapshot=data;
 }
 private prune(){
  const jobs=this.store.db.prepare("SELECT job FROM jobs WHERE status IN ('failed','cancelled','interrupted') ORDER BY rowid DESC").all() as any[];
  for(const row of jobs.slice(10)){const job:Job=JSON.parse(row.job);if(!job.candidateId)continue;const directory=this.store.candidatePath(job.candidateId);if(existsSync(directory))rmSync(directory,{recursive:true,force:true});}
 }
 async close(){
  if(this.closed)return;this.closed=true;this.controller?.abort(new Error('Gateway shutting down'));await this.activeWorker?.close();await this.queue;
  for(const row of this.store.db.prepare("SELECT job FROM jobs WHERE status='queued'").all() as any[]){const job:Job=JSON.parse(row.job);this.state(job,'interrupted','Gateway shut down before execution');}
  const lock=join(this.store.root,'supervisor.lock');try{if(existsSync(lock)&&readLeaseJson(lock).nonce===this.nonce)unlinkSync(lock);}finally{if(this.ownerFd!==null){closeSync(this.ownerFd);this.ownerFd=null;}}
 }
}
