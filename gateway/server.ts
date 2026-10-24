import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {createReadStream,statSync} from 'node:fs';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {WebSocketServer} from 'ws';
import {RevisionStore,StoreError} from './revision-store.ts';import {Supervisor} from './supervisor.ts';import {EventHub} from './events.ts';
export interface Gateway {baseUrl:string;store:RevisionStore;supervisor:Supervisor;close():Promise<void>}
type Options={dataDir:string;accessToken:string;port?:number;host?:string;allowedOrigins?:string[]};
function keys(value:unknown,required:string[],optional:string[]=[]):asserts value is Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value)||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>![...required,...optional].includes(k)))throw new StoreError('invalid','Invalid request fields');}
async function body(req:IncomingMessage){
 if(!req.headers['content-type']?.startsWith('application/json'))throw new StoreError('invalid','JSON body required');
 const chunks:Buffer[]=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>524288)throw new StoreError('invalid','Request body too large');chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new StoreError('invalid','Invalid JSON body');}
}
function json(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
export async function createGateway(options:Options):Promise<Gateway>{
 if(typeof options.accessToken!=='string'||options.accessToken.length<24)throw new Error('Configure a shared access token of at least 24 characters');
 const store=new RevisionStore(options.dataDir);let supervisor:Supervisor;
 try{supervisor=await Supervisor.start(store);}catch(e){store.close();throw e;}
 const events=new EventHub(store),wss=new WebSocketServer({noServer:true,maxPayload:1048576,handleProtocols:protocols=>protocols.has('cad-v1')?'cad-v1':false});
 let baseUrl='',closed=false;
 const allowed=(origin:string|undefined)=>!!origin&&[baseUrl,...options.allowedOrigins??[]].includes(origin);
 const authenticated=(provided:string|undefined)=>{if(!provided)return false;const a=Buffer.from(provided),b=Buffer.from(options.accessToken);return a.length===b.length&&timingSafeEqual(a,b);};
 const server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url??'/',baseUrl||'http://127.0.0.1');
   if(url.pathname==='/api/health'&&req.method==='GET'){json(res,200,{status:'ok'});return;}
   if(!authenticated(req.headers.authorization?.replace(/^Bearer /,''))){json(res,401,{error:'unauthorized',message:'Access key required'});return;}
   if(req.headers.origin&&!allowed(req.headers.origin)){json(res,403,{error:'origin',message:'Origin not allowed'});return;}
   if(url.pathname==='/api/documents'&&req.method==='POST'){
    const input=await body(req);keys(input,[],['id']);json(res,201,store.createDocument(input.id??randomUUID()));return;
   }
   const match=url.pathname.match(/^\/api\/documents\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?:\/(.*))?$/);
   if(!match)throw new StoreError('not_found','Route not found');
   const [,id,suffix='']=match;
   if(!suffix&&req.method==='GET'){json(res,200,store.snapshot(id));return;}
   if(suffix==='jobs'&&req.method==='POST'){
    const input=await body(req);keys(input,['baseRevision','operationId','program']);
    json(res,202,supervisor.submit(id,input.baseRevision,input.operationId,input.program));return;
   }
   const job=suffix.match(/^jobs\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})(\/cancel)?$/);
   if(job){if(!job[2]&&req.method==='GET'){json(res,200,supervisor.job(id,job[1]));return;}if(job[2]&&req.method==='POST'){const input=await body(req);keys(input,[]);json(res,200,supervisor.cancelJob(id,job[1]));return;}}
   const artifact=suffix.match(/^revisions\/([1-9][0-9]*)\/artifacts\/([A-Za-z0-9.]+)$/);
   if(artifact&&req.method==='GET'){
    const revision=Number(artifact[1]),name=artifact[2],path=store.artifactPath(id,revision,name);
    const type=name.endsWith('.glb')?'model/gltf-binary':name.endsWith('.json')?'application/json':'application/octet-stream';
    res.writeHead(200,{'Content-Type':type,'Content-Length':statSync(path).size,'X-CAD-Revision':String(revision),'Cache-Control':'private, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="${name}"`});
    const stream=createReadStream(path);stream.on('error',()=>res.destroy());stream.pipe(res);return;
   }
   throw new StoreError('not_found','Route not found');
  }catch(e){
   const error=e as any,code=error.code;const status=code==='not_found'?404:['conflict','idempotency'].includes(code)||[1555,2067].includes(error.errcode)?409:code==='invalid'||error.message?.startsWith('Invalid ')?400:['corrupt','busy','closed'].includes(code)?503:500;
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
