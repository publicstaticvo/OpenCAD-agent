import {test,expect} from 'vitest';import {mkdtempSync,existsSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync,spawn} from 'node:child_process';import {once} from 'node:events';
import {RevisionStore} from '../gateway/revision-store.ts';import {Supervisor} from '../gateway/supervisor.ts';import plate from './fixtures/models/plate.json';
import {approvedProgram} from './helpers/approved-program.ts';
test.each(['supervisor.lock:partial','supervisor.lock:published','worker-lease.json:partial','worker-lease.json:published'])('real SIGKILL at metadata %s leaves only complete public JSON and restart can commit',async phase=>{
 const root=mkdtempSync(join(tmpdir(),'cad-lease-crash-')),initial=new RevisionStore(root);initial.createDocument('plate');initial.close();
 const child=spawnSync(process.execPath,['--import','tsx','tests/helpers/lease-crash.ts',root,phase],{encoding:'utf8',timeout:4000});expect(child.signal,child.stderr).toBe('SIGKILL');
 for(const name of ['supervisor.lock','worker-lease.json'])if(existsSync(join(root,name)))expect(()=>JSON.parse(readFileSync(join(root,name),'utf8'))).not.toThrow();
 const store=new RevisionStore(root),s=await Supervisor.start(store);try{approvedProgram(s,'plate',0,'fresh',plate);expect((await s.waitForJob('plate','fresh')).status).toBe('committed');expect(store.snapshot('plate').revision).toBe(1);}finally{await s.close();store.close();}
},15000);
test('metadata write failure does not publish partial lease and kernel ownership is released',async()=>{
 const root=mkdtempSync(join(tmpdir(),'cad-lease-full-')),store=new RevisionStore(root);let s:Supervisor|undefined,error:any;
 try{try{s=await Supervisor.start(store,{metadataBoundary(phase:string){if(phase==='supervisor.lock:partial')throw new Error('ENOSPC');}} as any);}catch(e){error=e;}await s?.close();expect(error?.message).toBe('ENOSPC');expect(existsSync(join(root,'supervisor.lock'))).toBe(false);expect(readdirSync(root).filter(n=>n.endsWith('.tmp'))).toHaveLength(0);const next=await Supervisor.start(store);await next.close();}finally{store.close();}
});
test('two actual Gateway owners competing over stale metadata yield one kernel owner; SIGKILL releases it',async()=>{
 const root=mkdtempSync(join(tmpdir(),'cad-lease-concurrent-')),store=new RevisionStore(root);writeFileSync(join(root,'supervisor.lock'),JSON.stringify({pid:99999999,start:'0',nonce:'stale'}));store.close();
 const children=[0,1].map(()=>spawn(process.execPath,['--import','tsx','tests/helpers/lease-crash.ts',root,'hold'],{stdio:['pipe','pipe','pipe']}));
 try{const outputs=await Promise.all(children.map(child=>new Promise<string>((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('ownership timeout')),3000);child.stdout.on('data',chunk=>{text+=chunk;if(text.includes('\n')){clearTimeout(timer);resolve(text);}});child.once('error',reject);})));expect(outputs.filter(x=>x.startsWith('LOCKED'))).toHaveLength(1);expect(outputs.filter(x=>x.startsWith('BUSY'))).toHaveLength(1);const owner=children[outputs.findIndex(x=>x.startsWith('LOCKED'))];const exited=once(owner,'exit');owner.kill('SIGKILL');await exited;
 const nextStore=new RevisionStore(root),next=await Supervisor.start(nextStore);await next.close();nextStore.close();
 }finally{for(const child of children)if(child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill('SIGKILL');await stopped;}}
});
