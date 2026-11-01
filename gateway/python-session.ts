import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {scriptSource,type ScriptVersion} from './python-source.ts';
import {WorkerClient} from './worker-client.ts';
import {RevisionStore,stableHash} from './revision-store.ts';
import {assertContract,type Criteria,type Envelope} from '../shared/cad-contracts.ts';

export class PythonSession{
 readonly envelope:Envelope;
 private worker?:WorkerClient;private parent?:ScriptVersion;private valid:any;private latest:any;
 private versions:any[]=[];private sequence=0;private sealed=false;private closed=false;private busy=false;
 private directory:string;
 constructor(private store:RevisionStore,identity:Omit<Envelope,'candidateId'>&{candidateId?:string},private emit:(type:string,data:any)=>void,private signal:AbortSignal,private seconds=0){
  this.envelope={documentId:identity.documentId,operationId:identity.operationId,baseRevision:identity.baseRevision,candidateId:identity.candidateId??randomUUID()};this.directory=store.candidatePath(this.envelope.candidateId);
  mkdirSync(this.directory,{mode:0o700});
  if(identity.baseRevision){
   copyFileSync(store.artifactPath(identity.documentId,identity.baseRevision,'model.FCStd'),join(this.directory,'base.FCStd'));
   if(store.snapshot(identity.documentId).validation?.python){const source=readFileSync(store.artifactPath(identity.documentId,identity.baseRevision,'script.py'),'utf8');this.parent=scriptSource({source});}
  }
  signal.addEventListener('abort',this.abort,{once:true});
 }
 private abort=()=>{void this.worker?.close();};
 get source(){return this.parent;}
 get candidate(){return this.valid;}
 get client(){return this.worker;}
 private check(){if(this.closed)throw new Error('Python session closed');if(this.signal.aborted)throw this.signal.reason;if(this.store.snapshot(this.envelope.documentId).revision!==this.envelope.baseRevision)throw new Error('Python base revision changed');}
 async submit(input:{source?:string;patch?:string;parentHash?:string;criteria:Criteria}):Promise<any>{
  if(this.busy)throw new Error('Python submission already running');
  this.busy=true;try{return await this.execute(input);}finally{this.busy=false;}
 }
 private async execute(input:{source?:string;patch?:string;parentHash?:string;criteria:Criteria}):Promise<any>{
  this.check();if(this.sealed)throw new Error('Candidate sealed');assertContract('pythonSubmission',input);
  const {criteria,...proposal}=input;
  let version:ScriptVersion;
  try{version=scriptSource(proposal,this.parent);}catch(error){return{status:'rejected',error:{stage:'patch',type:'InvalidSubmission',message:(error as Error).message},parentHash:this.parent?.sourceHash};}
  const executionId=randomUUID(),identity={...this.envelope,executionId,sourceHash:version.sourceHash,parentHash:version.parentHash};
  const record={...identity,source:version.source,criteria,status:'running',createdAt:Date.now(),result:null as any};
  this.parent=version;this.versions.push(record);writeFileSync(join(this.directory,'scripts.json'),JSON.stringify(this.versions),{mode:0o600});
  this.latest=record;this.emit('python_execution',{...identity,status:'running'});
  let result:any;
  try{
   if(!this.worker){this.worker=await WorkerClient.start({workspace:join(this.store.root,'staging'),operationMs:0});this.check();this.emit('python_worker',{pid:this.worker.process.pid});await this.worker.request('begin_python',{envelope:this.envelope});}
   result=await this.worker.request('execute_script',{envelope:this.envelope,executionId,source:version.source,criteria,seconds:this.seconds});
  }catch(error){
   if(this.signal.aborted){record.status='cancelled';record.result={status:'cancelled',error:{stage:'execution',type:'Cancelled',message:String(this.signal.reason)}};writeFileSync(join(this.directory,'scripts.json'),JSON.stringify(this.versions),{mode:0o600});throw this.signal.reason;}
   await this.worker?.close();this.worker=undefined;
   result={status:'failed',error:{stage:'worker',type:'WorkerError',message:(error as Error).message,line:null}};
  }
  this.check();record.status=result.status;record.result=result;writeFileSync(join(this.directory,'scripts.json'),JSON.stringify(this.versions),{mode:0o600});
  this.emit('python_execution',{...identity,...result});
  if(result.status!=='valid')return{...identity,...result};
  const file=`candidate-${++this.sequence}.glb`;copyFileSync(join(this.directory,'preview.glb'),join(this.directory,file));
  const bytes=readFileSync(join(this.directory,file));
  const snapshot={...identity,sequence:this.sequence,planHash:version.sourceHash,tree:result.tree,geometry:result.validation,preview:{file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}};
  snapshot.preview=Object.assign(snapshot.preview,{url:`/api/documents/${identity.documentId}/jobs/${identity.operationId}/candidate/preview?sequence=${this.sequence}`});
  writeFileSync(join(this.directory,'script.py'),version.source,{mode:0o600});
  writeFileSync(join(this.directory,'execution.json'),JSON.stringify(identity),{mode:0o600});
  this.valid={...snapshot,criteria};this.emit('candidate_snapshot',snapshot);
  return{...identity,status:'valid',observation:{...result,image:{mimeType:'image/png',data:readFileSync(join(this.directory,'observation.png')).toString('base64')}},preview:snapshot.preview};
 }
 inspect(){return{source:this.parent,candidate:this.valid,latest:this.latest&&{executionId:this.latest.executionId,status:this.latest.status,result:this.latest.result}};}
 async finish(criteria:Criteria){
  if(this.busy)throw new Error('Python execution still running');
  this.check();if(!this.valid||this.latest?.status!=='valid'||this.latest.executionId!==this.valid.executionId)throw new Error('Latest script execution is not valid');
  if(stableHash(criteria)!==stableHash(this.valid.criteria))throw new Error('Finish criteria differ from executed acceptance');
  const identity={...this.envelope,executionId:this.valid.executionId,sourceHash:this.valid.sourceHash,parentHash:this.valid.parentHash};
  const result=await this.worker!.request('prepare_python',{envelope:this.envelope,identity,criteria});this.check();this.sealed=true;return result.validation;
 }
 async close(){this.closed=true;this.signal.removeEventListener('abort',this.abort);await this.worker?.close();}
}
