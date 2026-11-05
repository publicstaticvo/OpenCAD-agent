import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {scriptSource,type ScriptVersion} from './python-source.ts';
import {WorkerClient} from './worker-client.ts';
import {RevisionStore,stableHash} from './revision-store.ts';
import {assertContract,type Criteria,type Envelope} from '../shared/cad-contracts.ts';
import {SourceVersions} from './source-versions.ts';

export class PythonSession{
 readonly envelope:Envelope;
 private worker?:WorkerClient;private parent?:ScriptVersion;private valid:any;private latest:any;
 private versions:any[]=[];private sequence=0;private sealed=false;private closed=false;private busy=false;
 private directory:string;
 readonly sources:SourceVersions;
 constructor(private store:RevisionStore,identity:Omit<Envelope,'candidateId'>&{candidateId?:string},private emit:(type:string,data:any)=>void,private signal:AbortSignal,private seconds=0){
  this.envelope={documentId:identity.documentId,operationId:identity.operationId,baseRevision:identity.baseRevision,candidateId:identity.candidateId??randomUUID()};this.directory=store.candidatePath(this.envelope.candidateId);
  this.sources=new SourceVersions(store);
  store.db.exec(`CREATE TABLE IF NOT EXISTS python_executions(execution_id TEXT PRIMARY KEY,document_id TEXT NOT NULL,operation_id TEXT NOT NULL,record TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS python_acceptance(document_id TEXT NOT NULL,operation_id TEXT NOT NULL,criteria TEXT NOT NULL,PRIMARY KEY(document_id,operation_id));`);
  mkdirSync(this.directory,{mode:0o700});
  if(identity.baseRevision){
   copyFileSync(store.artifactPath(identity.documentId,identity.baseRevision,'model.FCStd'),join(this.directory,'base.FCStd'));
   if(store.snapshot(identity.documentId).validation?.python){const source=readFileSync(store.artifactPath(identity.documentId,identity.baseRevision,'script.py'),'utf8');this.parent=scriptSource({source});}
  }
  signal.addEventListener('abort',this.abort,{once:true});
 }
 private abort=()=>{void this.worker?.close();};
 get source(){return this.sources.head(this.envelope.documentId);}
 get candidate(){return this.valid;}
 get client(){return this.worker;}
 private check(){if(this.closed)throw new Error('Python session closed');if(this.signal.aborted)throw this.signal.reason;if(this.store.snapshot(this.envelope.documentId).revision!==this.envelope.baseRevision)throw new Error('Python base revision changed');}
 async submit(input:{source?:string;patch?:string;parentHash?:string;criteria:Criteria}):Promise<any>{
  if(this.busy)throw new Error('Python submission already running');
  this.check();assertContract('pythonSubmission',input);
  const head=this.sources.head(this.envelope.documentId);
  let source:ScriptVersion;
  try{source=scriptSource(({source:input.source,patch:input.patch,parentHash:input.parentHash}.source!==undefined?{source:input.source,parentHash:input.parentHash}:{patch:input.patch,parentHash:input.parentHash}),head?{source:head.source,sourceHash:head.sourceHash,parentHash:null}:this.parent);}catch(error){return{status:'rejected',error:{stage:'patch',type:'InvalidSubmission',message:(error as Error).message},parentHash:head?.sourceHash};}
  const version=this.sources.save(this.envelope.documentId,{source:source.source,parentVersionId:head?.versionId??null,actor:'user'});
  return this.run({sourceVersionId:version.versionId,sourceHash:version.sourceHash,criteria:input.criteria});
 }
 async run(input:{sourceVersionId:string;sourceHash:string;criteria?:Criteria}):Promise<any>{
  if(this.busy)throw new Error('Python execution already running');
  this.check();if(this.sealed)throw new Error('Candidate sealed');
  assertContract('pythonRun',input);
  const version=this.sources.read(this.envelope.documentId,input.sourceVersionId,input.sourceHash);
  if(input.criteria)assertContract('criteria',input.criteria);
  const bound=this.store.db.prepare('SELECT criteria FROM python_acceptance WHERE document_id=? AND operation_id=?').get(this.envelope.documentId,this.envelope.operationId) as any;
  if(bound&&input.criteria&&stableHash(JSON.parse(bound.criteria))!==stableHash(input.criteria))throw new Error('Task acceptance is immutable; propose a new task to change acceptance');
  if(!bound&&input.criteria)this.store.db.prepare('INSERT INTO python_acceptance VALUES(?,?,?)').run(this.envelope.documentId,this.envelope.operationId,JSON.stringify(input.criteria));
  const criteria:Criteria|null=bound?JSON.parse(bound.criteria):input.criteria??null;
  this.busy=true;try{return await this.execute(version,criteria);}finally{this.busy=false;}
 }
 private persistExecution(record:any){
  this.store.db.prepare('INSERT INTO python_executions VALUES(?,?,?,?) ON CONFLICT(execution_id) DO UPDATE SET record=excluded.record').run(record.executionId,this.envelope.documentId,this.envelope.operationId,JSON.stringify(record));
  writeFileSync(join(this.directory,'scripts.json'),JSON.stringify(this.versions),{mode:0o600});
 }
 private async execute(version:import('./source-versions.ts').SourceVersion,criteria:Criteria|null):Promise<any>{
  const parentHash=version.parentVersionId?this.sources.read(this.envelope.documentId,version.parentVersionId).sourceHash:null;
  const executionId=randomUUID(),identity={...this.envelope,executionId,sourceVersionId:version.versionId,sourceHash:version.sourceHash,parentHash};
  const record={...identity,source:version.source,project:version.project,criteria,status:'running',createdAt:Date.now(),result:null as any};
  this.parent={source:version.source,sourceHash:version.sourceHash,parentHash};this.versions.push(record);this.persistExecution(record);
  this.latest=record;this.emit('python_execution',{...identity,status:'running'});
  let result:any;
  try{
   if(!this.worker){this.worker=await WorkerClient.start({workspace:join(this.store.root,'staging'),operationMs:0,onProgress:data=>this.emit('cad_progress',{...data,executionId:this.latest?.executionId})});this.check();this.emit('python_worker',{pid:this.worker.process.pid});await this.worker.request('begin_python',{envelope:this.envelope});}
   const projectJson=JSON.stringify(version.project);
   result=await this.worker.request('execute_script',{envelope:this.envelope,executionId,projectJson,sourceHash:version.sourceHash,criteria,seconds:this.seconds});
  }catch(error){
   if(this.signal.aborted){record.status='cancelled';record.result={status:'cancelled',error:{stage:'execution',type:'Cancelled',message:String(this.signal.reason)}};this.persistExecution(record);this.emit('python_execution',{...identity,...record.result});throw this.signal.reason;}
   await this.worker?.close();this.worker=undefined;
   result={status:'failed',error:{stage:'worker',type:'WorkerError',message:(error as Error).message,line:null}};
  }
  record.status=result.status;record.result=result;this.persistExecution(record);this.check();
  this.emit('python_execution',{...identity,...result});
  if(result.status!=='valid'){
   if(result.healthStatus==='passed'&&result.deliveryStatus==='passed'){
    const file=`diagnostic-${executionId}.glb`,path=join(this.directory,'executions',executionId,'preview.glb');copyFileSync(path,join(this.directory,file));
    const sequence=++this.sequence,bytes=readFileSync(path),preview={file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),url:`/api/documents/${identity.documentId}/jobs/${identity.operationId}/executions/${executionId}/preview`};
    this.emit('python_diagnostic',{...identity,...result,sequence,geometry:result.validation,preview});
    return{...identity,...result,diagnosticPreview:preview,observation:{...result,image:{mimeType:'image/png',data:readFileSync(join(this.directory,'executions',executionId,'observation.png')).toString('base64')}}};
   }
   return{...identity,...result};
  }
  const file=`candidate-${++this.sequence}.glb`;copyFileSync(join(this.directory,'preview.glb'),join(this.directory,file));
  const bytes=readFileSync(join(this.directory,file));
  const snapshot={...identity,sequence:this.sequence,planHash:version.sourceHash,tree:result.tree,geometry:result.validation,preview:{file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}};
  snapshot.preview=Object.assign(snapshot.preview,{url:`/api/documents/${identity.documentId}/jobs/${identity.operationId}/candidate/preview?sequence=${this.sequence}`});
  writeFileSync(join(this.directory,'script.py'),version.source,{mode:0o600});writeFileSync(join(this.directory,'project.json'),JSON.stringify(version.project),{mode:0o600});
  writeFileSync(join(this.directory,'execution.json'),JSON.stringify(identity),{mode:0o600});
  this.valid={...snapshot,criteria};this.emit('candidate_snapshot',snapshot);
  return{...identity,...result,observation:{...result,image:{mimeType:'image/png',data:readFileSync(join(this.directory,'observation.png')).toString('base64')}},preview:snapshot.preview};
 }
 inspect(){const row=this.latest?null:this.store.db.prepare('SELECT record FROM python_executions WHERE document_id=? ORDER BY rowid DESC LIMIT 1').get(this.envelope.documentId) as any;const latest=this.latest??(row?JSON.parse(row.record):null);return{source:this.sources.head(this.envelope.documentId),candidate:this.valid,latest:latest&&{operationId:latest.operationId,executionId:latest.executionId,sourceVersionId:latest.sourceVersionId,sourceHash:latest.sourceHash,status:latest.status,result:latest.result}};}
 async finishExecution(executionId:string){
  if(!this.valid||this.valid.executionId!==executionId)throw new Error('Execution is not the current valid candidate');
  if(this.sources.head(this.envelope.documentId)?.versionId!==this.valid.sourceVersionId)throw new Error('Source version changed since execution');
  if(this.sealed)return this.valid.geometry;
  return this.finish(this.valid.criteria);
 }
 async finish(criteria:Criteria){
  if(this.busy)throw new Error('Python execution still running');
  this.check();if(!this.valid||this.latest?.status!=='valid'||this.latest.executionId!==this.valid.executionId)throw new Error('Latest script execution is not valid');
  if(stableHash(criteria)!==stableHash(this.valid.criteria))throw new Error('Finish criteria differ from executed acceptance');
  if(this.sources.head(this.envelope.documentId)?.versionId!==this.valid.sourceVersionId)throw new Error('Source version changed since execution');
  const identity={...this.envelope,executionId:this.valid.executionId,sourceVersionId:this.valid.sourceVersionId,sourceHash:this.valid.sourceHash,parentHash:this.valid.parentHash};
  const result=await this.worker!.request('prepare_python',{envelope:this.envelope,identity,criteria});this.check();this.sealed=true;return result.validation;
 }
 async close(){this.closed=true;this.signal.removeEventListener('abort',this.abort);await this.worker?.close();}
}
