import {spawn,type ChildProcess} from 'node:child_process';
import {createConnection,type Socket} from 'node:net';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,isAbsolute} from 'node:path';
import {budgets} from '../shared/cad-contracts.ts';
export async function resolveRuntime():Promise<string>{
 if(process.env.FREECAD_RUNTIME_ROOT)return process.env.FREECAD_RUNTIME_ROOT;
 try{return JSON.parse(await readFile('runtime.local.json','utf8')).freecadRuntimeRoot;}catch{throw new Error('Configure FREECAD_RUNTIME_ROOT: verified runtime required');}
}
export class RpcError extends Error {constructor(public code:number,message:string){super(message);}}
export class WorkerClient {
 private socket!:Socket;private directory='';private closed:Error|null=null;private seq=0;private buffer=Buffer.alloc(0);
 private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>|undefined;method:string;candidateId?:string;progressSequence:number;progressIndex:number}>();
 private operationMs:number=budgets.operationMs;
 private onProgress?:(value:any)=>void;
 socketPath='';process!:ChildProcess;hello:any;logs='';
 private constructor(){}
 static async start(opts:{runtimeRoot?:string;workspace?:string;startupMs?:number;operationMs?:number;onProgress?:(value:any)=>void}={}):Promise<WorkerClient>{
  const c=new WorkerClient(),root=opts.runtimeRoot??await resolveRuntime();
  c.onProgress=opts.onProgress;
  c.operationMs=opts.operationMs??budgets.operationMs;
  if(!root||!isAbsolute(root))throw new Error('Invalid runtime root');
  try{await stat(join(root,'usr/bin/python'));}catch{throw new Error('Invalid runtime: bundled Python missing');}
  c.directory=await mkdtemp(join(tmpdir(),'cad-w-'));c.socketPath=join(c.directory,'worker.sock');
  const env={...process.env,PYTHONDONTWRITEBYTECODE:'1'};for(const k of ['PYTHONHOME','PYTHONPATH','LD_LIBRARY_PATH','DISPLAY','WAYLAND_DISPLAY'])delete (env as Record<string,string|undefined>)[k];
  c.process=spawn(join(root,'usr/bin/python'),[resolve('worker/main.py'),'--runtime',root,'--socket',c.socketPath,'--workspace',resolve(opts.workspace??c.directory),'--parent-pid',String(process.pid)],{env,detached:true,stdio:['ignore','pipe','pipe']});
  for(const stream of [c.process.stdout,c.process.stderr])stream?.on('data',b=>{c.logs=(c.logs+b.toString()).slice(-65536);});
  c.process.once('error',e=>c.fail(e));c.process.once('exit',(code,signal)=>c.fail(new Error(`Worker exit ${code??signal}`)));
  try{
   const until=Date.now()+(opts.startupMs??budgets.startupMs);
   while(true){
    if(c.closed)throw new Error(`${c.closed.message}: ${c.logs}`);
    try{await stat(c.socketPath);break;}catch{}
    if(Date.now()>=until)throw new Error('Worker startup timeout');
    await new Promise(r=>setTimeout(r,10));
   }
   c.socket=createConnection(c.socketPath);
   await new Promise<void>((r,j)=>{c.socket.once('connect',r);c.socket.once('error',j);});
   c.socket.on('error',e=>c.fail(e));c.socket.on('close',()=>c.fail(new Error('Worker connection closed')));
   c.socket.on('data',b=>c.receive(Buffer.isBuffer(b)?b:Buffer.from(b)));
   c.hello=await c.request('hello',{},Math.max(1,until-Date.now()));
   if(c.hello.protocolVersion!==1||!c.hello.capabilities?.includes('cad_progress')||JSON.stringify(c.hello.runtime)!==JSON.stringify({freecad:'1.1.3',python:'3.11.14',occt:'7.8.1',gui:0}))throw new Error('Worker runtime/protocol drift');
   return c;
  }catch(e){await c.close();throw e;}
 }
 private receive(chunk:Buffer){
  this.buffer=Buffer.concat([this.buffer,chunk]);
  let pos:number;
  while((pos=this.buffer.indexOf(10))>=0){
   if(pos>budgets.frameBytes){this.fail(new Error('Worker frame too large'));return;}
   const line=this.buffer.subarray(0,pos);this.buffer=this.buffer.subarray(pos+1);
   try{const msg=JSON.parse(line.toString('utf8'));
    if(msg.jsonrpc==='2.0'&&msg.method==='cad_progress'&&!Object.hasOwn(msg,'id')){
     const p=msg.params,request=this.pending.get(p?.requestId);
     if(['assembly','interference'].includes(p?.stage)){
      if(!request||request.method!=='assembly_check'&&request.method!=='assembly_stage'||p.candidateId!==request.candidateId||!Number.isSafeInteger(p.sequence)||p.sequence<=request.progressSequence)throw new Error('Invalid assembly notification');
      request.progressSequence=p.sequence;this.onProgress?.(p);continue;
     }
     if(p?.stage==='operation'){
      if(!request||request.method!=='apply_operations'||p.candidateId!==request.candidateId||!['start','returned','batch_complete','batch_aborted'].includes(p.status)||!Number.isSafeInteger(p.sequence)||p.sequence<=request.progressSequence||!Number.isSafeInteger(p.index)||p.index<0||typeof p.stepId!=='string')throw new Error('Invalid Worker operation notification');
      request.progressSequence=p.sequence;this.onProgress?.(p);continue;
     }
     if(!request||request.method!=='prepare_candidate'||p.candidateId!==request.candidateId||!['geometry','save','reopen','export_step','export_glb'].includes(p.stage)||!['start','complete'].includes(p.status)||!Number.isSafeInteger(p.sequence)||p.sequence<=request.progressSequence||Object.keys(p).sort().join(',')!=='candidateId,requestId,sequence,stage,status')throw new Error('Invalid Worker progress notification');
     const expected=['geometry:start','geometry:complete','save:start','save:complete','reopen:start','reopen:complete','export_step:start','export_step:complete','export_glb:start','export_glb:complete'];
     if(`${p.stage}:${p.status}`!==expected[request.progressIndex++])throw new Error('Worker progress stage out of order');
     request.progressSequence=p.sequence;this.onProgress?.(p);continue;
    }
    if(msg.jsonrpc!=='2.0'||typeof msg.id!=='number'||!this.pending.has(msg.id))throw new Error('Unmatched Worker response');
    const hasResult=Object.hasOwn(msg,'result'),hasError=Object.hasOwn(msg,'error');
    if(hasResult===hasError||hasError&&(!msg.error||typeof msg.error!=='object'||Array.isArray(msg.error)||!Number.isSafeInteger(msg.error.code)||typeof msg.error.message!=='string'))throw new Error('Invalid Worker response');
    const p=this.pending.get(msg.id)!;
    if(!hasError&&p.method==='prepare_candidate'&&p.progressIndex!==10)throw new Error('Worker preparation completed without all progress stages');
    this.pending.delete(msg.id);clearTimeout(p.timer);
    if(hasError)p.reject(new RpcError(msg.error.code,msg.error.message));else p.resolve(msg.result);
   }catch(e){this.fail(e as Error);return;}
  }
  if(this.buffer.length>budgets.frameBytes)this.fail(new Error('Worker frame too large'));
 }
 async request(method:string,params:unknown,timeout:number=this.operationMs):Promise<any>{
  if(!Number.isSafeInteger(timeout)||timeout<0||timeout>2147483647)throw new Error('Invalid Worker operation timeout');
  if(this.closed)throw this.closed;
  const id=++this.seq,frame=JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n';
  if(Buffer.byteLength(frame)>budgets.frameBytes)throw new Error('Request frame too large');
  return new Promise((resolve,reject)=>{
   const timer=timeout>0?setTimeout(()=>this.fail(new Error(`Worker timeout: ${method}; outcome unknown, no automatic retry`)),timeout):undefined;
   this.pending.set(id,{resolve,reject,timer,method,candidateId:(params as any)?.envelope?.candidateId,progressSequence:0,progressIndex:0});this.socket.write(frame,e=>{if(e)this.fail(e);});
  });
 }
 private fail(error:Error){
  if(this.closed)return;this.closed=error;
  for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();
  this.socket?.destroy();if(this.process?.pid){try{process.kill(-this.process.pid,'SIGKILL');}catch{this.process.kill('SIGKILL');}}
 }
 async close(){
  this.fail(new Error('Worker closed'));
  if(this.process&&this.process.exitCode===null&&this.process.signalCode===null)await new Promise(r=>this.process.once('exit',r));
  if(this.directory)await rm(this.directory,{recursive:true,force:true});
 }
}
