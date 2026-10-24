/** Linux kernel ownership is authoritative; JSON is crash-safe diagnostic metadata. */
import {openSync,closeSync,fsyncSync,writeFileSync,renameSync,unlinkSync,existsSync,readFileSync} from 'node:fs';
import {dirname,basename,join} from 'node:path';import {spawnSync} from 'node:child_process';import {randomUUID} from 'node:crypto';
export function acquireOwner(path:string):number{
 const fd=openSync(path,'a',0o600);
 const result=spawnSync('/usr/bin/flock',['--exclusive','--nonblock','--conflict-exit-code','73','3'],{stdio:['ignore','pipe','pipe',fd]});
 if(result.status!==0){closeSync(fd);throw Object.assign(new Error(result.status===73?'Gateway already owns this data directory':'Linux /usr/bin/flock is required for safe ownership'),{code:result.status===73?'busy':'unavailable'});}
 // Child fd3 and the parent fd share an open file description: lock survives child exit.
 // Never unlink/replace this inode. Node closes the descriptor on process death.
 return fd;
}
export function writeLeaseJson(path:string,value:unknown,boundary?:(phase:string)=>void){
 const temp=join(dirname(path),`.${basename(path)}.${randomUUID()}.tmp`),text=JSON.stringify(value),fd=openSync(temp,'wx',0o600);
 try{const split=Math.floor(text.length/2);writeFileSync(fd,text.slice(0,split));boundary?.(basename(path)+':partial');writeFileSync(fd,text.slice(split));fsyncSync(fd);}catch(e){closeSync(fd);unlinkSync(temp);throw e;}
 closeSync(fd);
 try{renameSync(temp,path);const parent=openSync(dirname(path),'r');try{fsyncSync(parent);}finally{closeSync(parent);}boundary?.(basename(path)+':published');}finally{if(existsSync(temp))unlinkSync(temp);}
}
export function readLeaseJson(path:string):any{
 try{const value=JSON.parse(readFileSync(path,'utf8'));if(!value||!Number.isInteger(value.pid)||value.pid<=1||typeof value.start!=='string')throw new Error('Invalid lease fields');return value;}
 catch{throw Object.assign(new Error(`Corrupt diagnostic lease ${basename(path)}; stop all Gateways, preserve the data directory and inspect this file before manual recovery`),{code:'unsafe'});}
}
