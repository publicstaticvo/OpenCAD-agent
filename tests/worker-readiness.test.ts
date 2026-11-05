import {test,expect} from 'vitest';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {connectWorkerSocket} from '../gateway/worker-client.ts';

test('a real bound Unix socket becomes connectable only after listen and startup waits for that boundary',async()=>{
 mkdirSync('.work/tmp',{recursive:true});const directory=mkdtempSync(resolve('.work/tmp/readiness-')),path=resolve(directory,'worker.sock');
 const server=spawn('python',['tests/helpers/bound-socket.py',path],{stdio:['pipe','pipe','pipe']});
 try{
  const [bound]=await once(server.stdout,'data');expect(String(bound)).toBe('bound\n');
  const start=Date.now();const pending=connectWorkerSocket(path,start+2000,()=>{});
  const timer=setTimeout(()=>server.stdin.end('listen\n'),80);const socket=await pending;clearTimeout(timer);
  expect(Date.now()-start).toBeGreaterThanOrEqual(60);const [result]=await once(socket,'data');expect(String(result)).toBe('listening\n');socket.destroy();
 }finally{if(server.exitCode===null){const exited=once(server,'exit');server.kill('SIGKILL');await exited;}}
});

test('a real bound socket that never listens fails at the startup deadline',async()=>{
 mkdirSync('.work/tmp',{recursive:true});const directory=mkdtempSync(resolve('.work/tmp/readiness-')),path=resolve(directory,'worker.sock');
 const server=spawn('python',['tests/helpers/bound-socket.py',path],{stdio:['pipe','pipe','pipe']});
 try{await once(server.stdout,'data');await expect(connectWorkerSocket(path,Date.now()+80,()=>{})).rejects.toThrow('Worker startup timeout');}
 finally{if(server.exitCode===null){const exited=once(server,'exit');server.kill('SIGKILL');await exited;}}
});
