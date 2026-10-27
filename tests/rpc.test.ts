import {afterEach,describe,expect,test} from 'vitest';
import {WorkerClient, resolveRuntime} from '../gateway/worker-client.ts';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn, type ChildProcess} from 'node:child_process';
import {createConnection,type Socket} from 'node:net';
const clients:WorkerClient[]=[];
afterEach(async()=>{await Promise.all(clients.splice(0).map(c=>c.close()));});
async function worker(){const c=await WorkerClient.start();clients.push(c);return c;}
describe('real native Worker boundary',()=>{
 test('model thinking idle time does not disconnect the native worker',async()=>{
  const c=await worker();
  await new Promise(resolve=>setTimeout(resolve,31000));
  expect(await c.request('inspect_document',{})).toEqual({tree:[],loaded:false});
 },40000);
 test('handshake verifies native versions and concurrent responses correlate',async()=>{
  const c=await worker();expect(c.hello.runtime).toEqual({freecad:'1.1.3',python:'3.11.14',occt:'7.8.1',gui:0});
  expect(c.hello.protocolVersion).toBe(1);expect(c.hello.workerInstanceId).toBeTruthy();
  const values=await Promise.all(Array.from({length:8},()=>c.request('inspect_document',{})));
  expect(values).toEqual(Array(8).fill({tree:[],loaded:false}));
  expect((await stat(c.socketPath)).mode&0o777).toBe(0o600);
  expect((await stat(join(c.socketPath,'..'))).mode&0o777).toBe(0o700);
  await expect(c.request('execute_python',{code:'print(1)'})).rejects.toMatchObject({code:-32601});
  expect(await c.request('inspect_document',{})).toEqual({tree:[],loaded:false});
 });
 test('invalid runtime fails closed',async()=>{await expect(WorkerClient.start({runtimeRoot:'/does-not-exist'})).rejects.toThrow(/runtime/i);});
 test('process exit rejects requests and next instance has new identity',async()=>{
  const c=await worker(),id=c.hello.workerInstanceId;c.process.kill('SIGKILL');
  await new Promise(r=>setTimeout(r,20));await expect(c.request('inspect_document',{})).rejects.toThrow(/exit|closed/i);
  const next=await worker();expect(next.hello.workerInstanceId).not.toBe(id);
 });
 test('deadline kills the unresponsive native process without retry',async()=>{
  const c=await worker();c.process.kill('SIGSTOP');
  await expect(c.request('inspect_document',{},40)).rejects.toThrow(/timeout/i);
  await expect(c.request('inspect_document',{})).rejects.toThrow(/closed|timeout/i);
 });
 test('real fragmented/coalesced frames, malformed JSON, oversize and native logs use separate transport',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cad-raw-')),socketPath=join(dir,'w.sock'),runtime=await resolveRuntime();
  const env={...process.env};for(const k of ['PYTHONHOME','PYTHONPATH','LD_LIBRARY_PATH','DISPLAY','WAYLAND_DISPLAY'])delete env[k];
  const child=spawn(join(runtime,'usr/bin/python'),['worker/main.py','--runtime',runtime,'--socket',socketPath,'--workspace',dir],{env,stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  let socket:Socket|undefined;
  try{
   for(let i=0;i<200;i++){try{await stat(socketPath);break;}catch{await new Promise(r=>setTimeout(r,20));}}
   socket=createConnection(socketPath);await new Promise<void>((r,j)=>{socket!.once('connect',r);socket!.once('error',j);});
   let pending='';const results:any[]=[];socket.on('data',b=>{pending+=b;let n;while((n=pending.indexOf('\n'))>=0){results.push(JSON.parse(pending.slice(0,n)));pending=pending.slice(n+1);}});
   const req=(id:number)=>JSON.stringify({jsonrpc:'2.0',id,method:'hello',params:{}})+'\n';
   socket.write(req(7).slice(0,12));socket.write(req(7).slice(12)+req(8)+'{bad}\n'+JSON.stringify({jsonrpc:'1.0',id:9,method:'hello',params:{}})+'\n');
   for(let i=0;i<100&&results.length<4;i++)await new Promise(r=>setTimeout(r,10));
   expect(results.map(x=>x.id)).toEqual([7,8,null,9]);expect(results[2].error.code).toBe(-32700);expect(results[3].error.code).toBe(-32600);
   const closed=new Promise(r=>socket!.once('close',r));socket.write('x'.repeat(1048577));await closed;
   expect(results.at(-1).error.code).toBe(-32001);
  }finally{socket?.destroy();child.kill('SIGKILL');await new Promise(r=>child.exitCode!==null||child.signalCode!==null?r(null):child.once('exit',r));await rm(dir,{recursive:true,force:true});}
 });
});
