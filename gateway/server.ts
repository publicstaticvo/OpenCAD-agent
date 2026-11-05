import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {createReadStream,statSync,lstatSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {timingSafeEqual,randomUUID,createHash} from 'node:crypto';
import {WebSocketServer} from 'ws';
import {RevisionStore,StoreError} from './revision-store.ts';import {Supervisor} from './supervisor.ts';import {EventHub} from './events.ts';
import {SourceVersions} from './source-versions.ts';
import {projectFileHashes} from './project-source.ts';
export interface Gateway {baseUrl:string;store:RevisionStore;supervisor:Supervisor;close():Promise<void>}
import type {TextRunner} from './agent.ts';
import type {ModelConfig} from './model-config.ts';
type Options={textRunner?:TextRunner;modelConfig?:ModelConfig;dataDir:string;accessToken:string;port?:number;host?:string;allowedOrigins?:string[];taskMs?:number};
function keys(value:unknown,required:string[],optional:string[]=[]):asserts value is Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value)||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>![...required,...optional].includes(k)))throw new StoreError('invalid','Invalid request fields');}
async function body(req:IncomingMessage){
 if(!req.headers['content-type']?.startsWith('application/json'))throw new StoreError('invalid','JSON body required');
 const chunks:Buffer[]=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>16*1024*1024)throw new StoreError('invalid','Request body too large');chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new StoreError('invalid','Invalid JSON body');}
}
function json(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
export async function createGateway(options:Options):Promise<Gateway>{
 if(typeof options.accessToken!=='string'||options.accessToken.length<24)throw new Error('Configure a shared access token of at least 24 characters');
 const store=new RevisionStore(options.dataDir);let supervisor:Supervisor;
 try{supervisor=await Supervisor.start(store,{textRunner:options.textRunner,taskMs:options.taskMs});}catch(e){store.close();throw e;}
 const events=new EventHub(store),wss=new WebSocketServer({noServer:true,maxPayload:16*1048576,handleProtocols:protocols=>protocols.has('cad-v1')?'cad-v1':false});
 let baseUrl='',closed=false;
 const providerMode=()=>options.modelConfig?(options.modelConfig.status().configured?'live':'none'):options.textRunner?.mode??'none';
 const allowed=(origin:string|undefined)=>!!origin&&[baseUrl,...options.allowedOrigins??[]].includes(origin);
 const authenticated=(provided:string|undefined)=>{if(!provided)return false;const a=Buffer.from(provided),b=Buffer.from(options.accessToken);return a.length===b.length&&timingSafeEqual(a,b);};
 const server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url??'/',baseUrl||'http://127.0.0.1');
   if(req.method==='GET'&&(url.pathname==='/'||/^\/assets\/[A-Za-z0-9._-]+$/.test(url.pathname))){
    const path=join(resolve('dist'),url.pathname==='/'?'index.html':url.pathname.slice(1));
    if(!existsSync(path))throw new StoreError('not_found','Run npm run build to create Web workspace');
    const type=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html; charset=utf-8';
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(readFileSync(path));return;
   }
   if(url.pathname==='/api/health'&&req.method==='GET'){json(res,200,{status:'ok',providerMode:providerMode()});return;}
   if(!authenticated(req.headers.authorization?.replace(/^Bearer /,''))){json(res,401,{error:'unauthorized',message:'Access key required'});return;}
   if(req.headers.origin&&!allowed(req.headers.origin)){json(res,403,{error:'origin',message:'Origin not allowed'});return;}
   if(url.pathname==='/api/documents'&&req.method==='POST'){
    const input=await body(req);keys(input,[],['id','name']);const id=input.id??randomUUID();json(res,201,store.createDocument(id,input.name??id));return;
   }
   if(url.pathname==='/api/documents'&&req.method==='GET'){json(res,200,{documents:store.listDocuments()});return;}
   if(url.pathname==='/api/session'&&req.method==='GET'){json(res,200,{providerMode:providerMode(),modelConfigurationEnabled:!!options.modelConfig});return;}
   if(['/api/model-config','/api/model-config/discover','/api/model-config/probe'].includes(url.pathname)){
    if(!options.modelConfig)throw new StoreError('unavailable','当前启动模式未启用模型配置');
    if(url.pathname==='/api/model-config'&&req.method==='GET'){json(res,200,options.modelConfig.status());return;}
    if(req.method==='POST'){
     const input=await body(req);
     if(url.pathname.endsWith('/discover')){keys(input,['baseUrl'],['apiKey','protocol','timeouts']);json(res,200,await options.modelConfig.discover(input as any));}
     else{keys(input,['baseUrl','model'],['apiKey','protocol','timeouts','imageInput']);json(res,200,url.pathname.endsWith('/probe')?await options.modelConfig.probe(input as any):await options.modelConfig.save(input as any));}
     return;
    }
   }
   const match=url.pathname.match(/^\/api\/documents\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?:\/(.*))?$/);
   if(!match)throw new StoreError('not_found','Route not found');
   const [,id,suffix='']=match;
   if(!suffix&&req.method==='GET'){json(res,200,store.snapshot(id));return;}
   if(!suffix&&req.method==='PATCH'){const input=await body(req);keys(input,['name']);json(res,200,store.renameDocument(id,input.name));return;}
   if(suffix==='conversations'){
    if(req.method==='GET'){json(res,200,{conversations:store.listConversations(id)});return;}
    if(req.method==='POST'){const input=await body(req);keys(input,[],['title']);json(res,201,store.createConversation(id,input.title));return;}
   }
   const conversation=suffix.match(/^conversations\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})(\/messages)?$/);
   if(conversation){
    if(conversation[2]&&req.method==='GET'){json(res,200,store.messages(id,conversation[1],Number(url.searchParams.get('afterOrdinal')??0),Number(url.searchParams.get('limit')??100)));return;}
    if(!conversation[2]&&req.method==='GET'){json(res,200,store.conversation(id,conversation[1]));return;}
    if(!conversation[2]&&req.method==='PATCH'){const input=await body(req);keys(input,['title']);json(res,200,store.renameConversation(id,conversation[1],input.title));return;}
   }
   if(suffix==='source'&&req.method==='GET'){json(res,200,{source:new SourceVersions(store).head(id)});return;}
   if(suffix==='source'&&req.method==='POST'){
    const input=await body(req);keys(input,['source','parentVersionId'],['sourceHash']);
    const versions=new SourceVersions(store),head=versions.head(id);if(head&&(Object.keys(head.project.files).length>1||head.project.assets||head.project.directories.length||head.project.entrypoint!=='script.py'))throw new StoreError('conflict','Submit the complete project snapshot to preserve every file');
    json(res,201,versions.save(id,{source:input.source,parentVersionId:input.parentVersionId,sourceHash:input.sourceHash,actor:'user'}));return;
   }
   if(suffix==='source/workspace'&&req.method==='GET'){json(res,200,{workspace:new SourceVersions(store).workspace(id)});return;}
   if(suffix==='source/workspace'&&req.method==='PUT'){
    const input=await body(req);keys(input,['source','baseVersionId','expectedBaseVersionId','draftRevision'],['project','sourceOrigin']);json(res,200,{workspace:new SourceVersions(store).saveWorkspace(id,{source:input.source,project:input.project,baseVersionId:input.baseVersionId,expectedBaseVersionId:input.expectedBaseVersionId,draftRevision:input.draftRevision,sourceOrigin:input.sourceOrigin})});return;
   }
   if(suffix==='source/checkpoint'&&req.method==='POST'){
    const input=await body(req);keys(input,['source','baseVersionId','expectedBaseVersionId','draftRevision'],['project','sourceOrigin','action','executionEntrypoint']);
    const versions=new SourceVersions(store);
    if(input.executionEntrypoint!==undefined&&input.action!=='run')throw new StoreError('invalid','Execution entrypoint requires a run checkpoint');
    const checkpoint={source:input.source,project:input.project,baseVersionId:input.baseVersionId,expectedBaseVersionId:input.expectedBaseVersionId,draftRevision:input.draftRevision,sourceOrigin:input.sourceOrigin,action:input.action};
    json(res,201,input.executionEntrypoint!==undefined?versions.checkpointRun(id,{...checkpoint,executionEntrypoint:input.executionEntrypoint}):versions.checkpointWorkspace(id,checkpoint));return;
   }
   const sourceAdoption=suffix.match(/^sources\/([A-Za-z0-9_-]+)\/adopt$/);
   if(sourceAdoption&&req.method==='POST'){const input=await body(req);keys(input,['expectedHeadVersionId']);json(res,201,new SourceVersions(store).adoptBranch(id,sourceAdoption[1],input.expectedHeadVersionId));return;}
   if(suffix==='sources'&&req.method==='GET'){json(res,200,{versions:new SourceVersions(store).list(id).map(({source,project,...version})=>({...version,entrypoint:project.entrypoint,files:Object.keys(project.files),fileHashes:projectFileHashes(project)}))});return;}
   const sourceVersion=suffix.match(/^sources\/([A-Za-z0-9_-]+)$/);
   if(sourceVersion&&req.method==='GET'){const versions=new SourceVersions(store),version=versions.read(id,sourceVersion[1]);json(res,200,{...version,diff:versions.diff(id,sourceVersion[1]),fileDiffs:versions.fileDiffs(id,sourceVersion[1])});return;}
   const execution=suffix.match(/^executions\/([A-Za-z0-9_-]+)$/);
   if(execution&&req.method==='GET'){
    const exists=store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='python_executions'").get();
    const record=exists?store.db.prepare('SELECT record FROM python_executions WHERE document_id=? AND execution_id=?').get(id,execution[1]) as any:null;
    if(!record)throw new StoreError('not_found','Execution not found');json(res,200,JSON.parse(record.record));return;
   }
   if(suffix==='events'&&req.method==='GET'){json(res,200,{events:store.events(id,Number(url.searchParams.get('afterSeq')??0))});return;}
   const jobEvents=suffix.match(/^jobs\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/events$/);
   if(jobEvents&&req.method==='GET'){json(res,200,store.jobEvents(id,jobEvents[1],Number(url.searchParams.get('afterSeq')??0),Number(url.searchParams.get('limit')??200)));return;}
   const diagnostic=suffix.match(/^jobs\/([A-Za-z0-9_-]+)\/executions\/([A-Za-z0-9_-]+)\/preview$/);
   if(diagnostic&&req.method==='GET'){
    const job=supervisor.job(id,diagnostic[1]);
    const recorded=store.db.prepare("SELECT event FROM events WHERE document_id=? AND json_extract(event,'$.jobId')=? AND json_extract(event,'$.type')='python_diagnostic' AND json_extract(event,'$.data.executionId')=?").get(id,job.operationId,diagnostic[2]) as any;
    if(!recorded)throw new StoreError('not_found','Diagnostic preview not found');const data=JSON.parse(recorded.event).data;
    const directory=job.status==='committed'?dirname(store.artifactPath(id,job.result.revision,'model.FCStd')):store.candidatePath(job.candidateId);
    const path=join(directory,`diagnostic-${diagnostic[2]}.glb`);
    if(!existsSync(path))throw new StoreError('not_found','Diagnostic preview has expired');
    const info=lstatSync(path);if(info.isSymbolicLink()||!info.isFile()||info.size>64*1024*1024)throw new StoreError('corrupt','Invalid diagnostic preview');
    const bytes=readFileSync(path);if(bytes.length!==data.preview.bytes||createHash('sha256').update(bytes).digest('hex')!==data.preview.sha256)throw new StoreError('corrupt','Diagnostic preview hash mismatch');
    res.writeHead(200,{'Content-Type':'model/gltf-binary','Content-Length':bytes.length,'Cache-Control':'no-store','X-CAD-Candidate':job.candidateId,'X-CAD-Base-Revision':String(job.baseRevision),'X-CAD-Sequence':String(data.sequence),'X-CAD-Content-Hash':data.preview.sha256});res.end(bytes);return;
   }
   const candidate=suffix.match(/^jobs\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/candidate\/(snapshot|preview)$/);
   if(candidate&&req.method==='GET'){
    const job=supervisor.job(id,candidate[1]);if(!job.candidateId||!['running','validating','committing','committed','answered','failed','cancelled','awaiting_acceptance','rejected'].includes(job.status))throw new StoreError('not_found','Candidate preview unavailable');
    if(candidate[2]==='snapshot'){json(res,200,{status:job.status,snapshot:job.candidateSnapshot??null});return;}
    const sequence=Number(url.searchParams.get('sequence'));if(!Number.isSafeInteger(sequence)||sequence<1)throw new StoreError('not_found','Candidate sequence unavailable');
    const recorded:any=store.db.prepare("SELECT event FROM events WHERE document_id=? AND json_extract(event,'$.jobId')=? AND json_extract(event,'$.type')='candidate_snapshot' AND json_extract(event,'$.data.sequence')=?").get(id,job.operationId,sequence);
    const snapshot=recorded?JSON.parse(recorded.event).data:null;
    if(!snapshot?.preview||snapshot.candidateId!==job.candidateId||(job.plan&&job.plan.kind!=='python'&&snapshot.planHash!==job.plan.planHash))throw new StoreError('not_found','Candidate sequence unavailable');
    if(job.status==='committed'&&(job.result?.candidateId!==job.candidateId||job.result?.operationId!==job.operationId))throw new StoreError('corrupt','Recorded candidate identity mismatch');
    const directory=job.status==='committed'?dirname(store.artifactPath(id,job.result.revision,'model.FCStd')):store.candidatePath(job.candidateId);
    const path=join(directory,`candidate-${sequence}.glb`);
    if(!existsSync(path))throw new StoreError('not_found','Candidate preview is not ready');
    const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>64*1024*1024)throw new StoreError('corrupt','Invalid candidate preview file');
    const bytes=readFileSync(path);if(bytes.length!==snapshot.preview.bytes||createHash('sha256').update(bytes).digest('hex')!==snapshot.preview.sha256)throw new StoreError('corrupt','Candidate preview content changed');
    res.writeHead(200,{'Content-Type':'model/gltf-binary','Content-Length':bytes.length,'Cache-Control':'no-store','X-CAD-Candidate':job.candidateId,'X-CAD-Base-Revision':String(job.baseRevision),'X-CAD-Sequence':String(sequence),'X-CAD-Content-Hash':snapshot.preview.sha256,'X-Content-Type-Options':'nosniff'});res.end(bytes);return;
   }
   if(suffix==='jobs'&&req.method==='POST'){
    const input=await body(req);keys(input,['baseRevision','operationId'],['program','text','plan','python','run','conversationId']);
    if(['program','text','plan','python','run'].filter(key=>Object.hasOwn(input,key)).length!==1)throw new StoreError('invalid','Choose exactly one program, text, plan, python or run task');
    if(Object.hasOwn(input,'run')){json(res,202,supervisor.submitPython(id,input.baseRevision,input.operationId,{kind:'run',run:input.run},input.conversationId));return;}
    if(Object.hasOwn(input,'python')){json(res,202,supervisor.submitPython(id,input.baseRevision,input.operationId,{kind:'python',submission:input.python},input.conversationId));return;}
    if(Object.hasOwn(input,'text')&&providerMode()==='none')throw new StoreError('unavailable','请先配置模型服务');
    json(res,202,Object.hasOwn(input,'text')?supervisor.submitText(id,input.baseRevision,input.operationId,input.text,input.conversationId):Object.hasOwn(input,'plan')?supervisor.submitOperationPlan(id,input.baseRevision,input.operationId,input.plan,input.conversationId):supervisor.submit(id,input.baseRevision,input.operationId,input.program,input.conversationId));return;
   }
   const approval=suffix.match(/^jobs\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/(approve|reject)$/);
   if(approval&&req.method==='POST'){const input=await body(req);keys(input,['planHash']);json(res,200,approval[2]==='approve'?supervisor.approveJob(id,approval[1],input.planHash):supervisor.rejectJob(id,approval[1],input.planHash));return;}
   const candidateDecision=suffix.match(/^jobs\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/(accept|reject-candidate)$/);
   if(candidateDecision&&req.method==='POST'){const input=await body(req);keys(input,[]);json(res,200,candidateDecision[2]==='accept'?supervisor.acceptCandidate(id,candidateDecision[1]):supervisor.rejectCandidate(id,candidateDecision[1]));return;}
   const job=suffix.match(/^jobs\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})(\/cancel)?$/);
   if(job){if(!job[2]&&req.method==='GET'){json(res,200,supervisor.job(id,job[1]));return;}if(job[2]&&req.method==='POST'){const input=await body(req);keys(input,[]);json(res,200,supervisor.cancelJob(id,job[1]));return;}}
   if(suffix==='revisions'&&req.method==='GET'){json(res,200,{revisions:store.listRevisions(id)});return;}
   const revisionSnapshot=suffix.match(/^revisions\/([1-9][0-9]*)$/);
   if(revisionSnapshot&&req.method==='GET'){json(res,200,store.revisionSnapshot(id,Number(revisionSnapshot[1])));return;}
   const artifact=suffix.match(/^revisions\/([1-9][0-9]*)\/artifacts\/([A-Za-z0-9.]+)$/);
   if(artifact&&req.method==='GET'){
    const revision=Number(artifact[1]),name=artifact[2],path=store.artifactPath(id,revision,name);
    const type=name.endsWith('.glb')?'model/gltf-binary':name.endsWith('.json')?'application/json':'application/octet-stream';
    res.writeHead(200,{'Content-Type':type,'Content-Length':statSync(path).size,'X-CAD-Revision':String(revision),'Cache-Control':'private, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="${name}"`});
    const stream=createReadStream(path);stream.on('error',()=>res.destroy());stream.pipe(res);return;
   }
   throw new StoreError('not_found','Route not found');
  }catch(e){
   const error=e as any,code=error.code;const status=code==='not_found'?404:['conflict','idempotency','project_busy'].includes(code)||[1555,2067].includes(error.errcode)?409:code==='invalid'||error.message?.startsWith('Invalid ')?400:['corrupt','busy','closed','unavailable'].includes(code)?503:500;
   if(!res.headersSent)json(res,status,{error:code??'request_failed',message:status===500?'Internal Gateway error':error.message});else res.destroy();
  }
 });
 server.on('upgrade',(req,socket,head)=>{
  const reject=(status:number)=>{socket.write(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`);socket.destroy();};
  if(!allowed(req.headers.origin)){reject(403);return;}
  const protocols=(req.headers['sec-websocket-protocol']??'').split(',').map(s=>s.trim());
  if(!authenticated(req.headers.authorization?.replace(/^Bearer /,'')??protocols.find(s=>s.startsWith('access.'))?.slice(7))){reject(401);return;}
  try{
   const url=new URL(req.url!,baseUrl),match=url.pathname.match(/^\/api\/documents\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/events$/),after=url.searchParams.get('afterSeq')??'0';
   if(!match||!/^\d+$/.test(after)||!Number.isSafeInteger(Number(after))||wss.clients.size>=64)throw new Error('Invalid subscription');
   store.snapshot(match[1]);
   wss.handleUpgrade(req,socket,head,ws=>events.subscribe(ws,match[1],Number(after)));
  }catch{reject(400);}
 });
 try{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port??3000,options.host??'127.0.0.1',resolve);});}catch(e){events.close();await supervisor.close();store.close();throw e;}
 const address=server.address();if(!address||typeof address==='string')throw new Error('Missing HTTP listener');baseUrl=`http://${options.host??'127.0.0.1'}:${address.port}`;
 return{baseUrl,store,supervisor,async close(){if(closed)return;closed=true;events.close();wss.close();const stopped=new Promise<void>(r=>server.close(()=>r()));server.closeAllConnections();await supervisor.close();await stopped;store.close();}};
}
