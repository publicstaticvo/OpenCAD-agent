import type {AppEvent,DocumentSnapshot} from '../../shared/cad-contracts.ts';import type {WorkspaceApi} from './store.ts';import {loadModel} from './viewer.tsx';
export class ApiError extends Error{constructor(readonly status:number,message:string){super(message);}}
export class Api{
 providerMode="none";
 modelConfigurationEnabled=false;
 constructor(readonly token:string){}
 async fetch(path:string,init:RequestInit={}){
  const url=new URL(path,window.location.origin);if(url.origin!==window.location.origin||!url.pathname.startsWith('/api/'))throw new Error('拒绝非工作区地址');
  const response=await fetch(url,{...init,cache:'no-store',headers:{Authorization:`Bearer ${this.token}`,...init.headers}});
  if(!response.ok){const data=await response.json().catch(()=>({message:response.statusText}));throw new ApiError(response.status,data.message??'请求失败');}return response;
 }
 async json(path:string,body?:unknown){const r=await this.fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return r.json();}
 async patch(path:string,body:unknown){return(await this.fetch(path,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();}
 async session(){const session=await this.json('/api/session');this.providerMode=session.providerMode;this.modelConfigurationEnabled=!!session.modelConfigurationEnabled;return session;}
 project(documentId:string):WorkspaceApi{
  const root=`/api/documents/${encodeURIComponent(documentId)}`;
  return{snapshot:async(signal)=>(await this.fetch(root,{signal})).json() as Promise<DocumentSnapshot>,asset:async(url,revision,signal)=>{const response=await this.fetch(url,{signal});if(response.headers.get('x-cad-revision')!==String(revision))throw new Error('预览文件版本不一致');return loadModel(await response.arrayBuffer());},watch:(after,onEvent,onConnection)=>{
   let stopped=false,socket:WebSocket|undefined,timer:ReturnType<typeof setTimeout>,delay=300;
   const connect=()=>{
    if(stopped)return;const url=new URL(root+'/events',window.location.origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set('afterSeq',String(after()));
    socket=new WebSocket(url,['cad-v1',`access.${this.token}`]);
    socket.onopen=()=>{delay=300;onConnection(true);};
    socket.onmessage=message=>{try{const packet=JSON.parse(message.data);if(packet.type==='event')onEvent(packet.event as AppEvent);}catch{socket?.close(1002,'Invalid event');}};
    socket.onerror=()=>onConnection(false);socket.onclose=()=>{onConnection(false);if(!stopped){timer=setTimeout(connect,delay);delay=Math.min(delay*2,5000);}};
   };connect();return()=>{stopped=true;clearTimeout(timer);socket?.close();};
  }};
 }
 async candidateAsset(path:string,candidateId:string,baseRevision:number,sequence:number,sha256:string,signal?:AbortSignal){
  const response=await this.fetch(path,{signal});if(response.headers.get('x-cad-candidate')!==candidateId||response.headers.get('x-cad-base-revision')!==String(baseRevision)||response.headers.get('x-cad-sequence')!==String(sequence)||response.headers.get('x-cad-content-hash')!==sha256)throw new Error('候选预览身份不一致');
  const bytes=await response.arrayBuffer();const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');if(digest!==sha256)throw new Error('候选预览内容校验失败');return loadModel(bytes);
 }
}
