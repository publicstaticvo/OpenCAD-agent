import {test,expect} from 'vitest';import {createGateway} from '../gateway/server.ts';import plate from './fixtures/models/plate.json';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import WebSocket from 'ws';
const token='test-access-key-0123456789abcdef';
async function setup(){const root=mkdtempSync(join(tmpdir(),'cad-api-'));const app=await createGateway({dataDir:root,accessToken:token,port:0});return{root,app,async close(){await app.close();rmSync(root,{recursive:true,force:true});}};}
async function request(base:string,path:string,body?:unknown,headers:Record<string,string>={}){return fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});}
async function stream(app:any,doc:string,after:number){
 const ws=new WebSocket(app.baseUrl.replace('http:','ws:')+`/api/documents/${doc}/events?afterSeq=${after}`,['cad-v1',`access.${token}`],{origin:app.baseUrl});
 const messages:any[]=[];ws.on('message',b=>messages.push(JSON.parse(b.toString())));
 await new Promise<void>((r,j)=>{ws.once('open',r);ws.once('error',j);});return{ws,messages};
}
async function until(condition:()=>boolean){for(let i=0;i<500;i++){if(condition())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Event deadline');}
test('actual HTTP+WS create, commit, replay after snapshot race, controlled artifacts and restart',async()=>{
 const x=await setup();try{
  const created=await request(x.app.baseUrl,'/api/documents',{id:'plate'});expect(created.status).toBe(201);
  const initial=await (await request(x.app.baseUrl,'/api/documents/plate')).json();expect(initial.revision).toBe(0);
  const submitted=await request(x.app.baseUrl,'/api/documents/plate/jobs',{baseRevision:0,operationId:'create',program:plate});expect(submitted.status).toBe(202);
  const job=await x.app.supervisor.waitForJob('plate','create');expect(job.status).toBe('committed');
  const resumed=await stream(x.app,'plate',initial.lastSeq);try{
   await until(()=>resumed.messages.some(x=>x.type==='event'&&x.event.type==='committed'));
   const events=resumed.messages.filter(x=>x.type==='event').map(x=>x.event);
   expect(new Set(events.map(e=>e.seq)).size).toBe(events.length);expect(events.at(-1).revision).toBe(1);
  }finally{resumed.ws.close();}
  const snap=await (await request(x.app.baseUrl,'/api/documents/plate')).json();expect(snap.revision).toBe(1);expect(snap.jobs[0].result.revision).toBe(1);
  for(const name of ['model.FCStd','model.step','preview.glb']){const artifact=await request(x.app.baseUrl,snap.artifacts[name]);expect(artifact.status).toBe(200);expect(artifact.headers.get('x-cad-revision')).toBe('1');expect((await artifact.arrayBuffer()).byteLength).toBeGreaterThan(1000);}
  expect((await request(x.app.baseUrl,'/api/documents/plate/jobs',{baseRevision:0,operationId:'create',program:plate})).status).toBe(202);
  expect((await request(x.app.baseUrl,'/api/documents/plate/jobs',{baseRevision:0,operationId:'stale',program:plate})).status).toBe(409);
  expect((await request(x.app.baseUrl,'/api/documents/plate/revisions/0/artifacts/model.FCStd')).status).toBe(404);
  const data=x.root;await x.app.close();x.app=await createGateway({dataDir:data,accessToken:token,port:0});
  const restored=await (await request(x.app.baseUrl,'/api/documents/plate')).json();expect(restored).toEqual(snap);
 }finally{await x.close();}
});
test('authentication, Origin, strict payloads and user paths rejected before Worker start',async()=>{
 const x=await setup();try{
  expect((await fetch(x.app.baseUrl+'/api/documents',{method:'POST',body:'{}'})).status).toBe(401);
  expect((await request(x.app.baseUrl,'/api/documents',{id:'x'},{Origin:'https://attacker.invalid'})).status).toBe(403);
  await request(x.app.baseUrl,'/api/documents',{id:'x'});
  expect((await request(x.app.baseUrl,'/api/documents/x/jobs',{baseRevision:0,operationId:'bad',program:{...plate,operations:[{op:'pad',id:'x',sketch:'y',length:true}]}})).status).toBe(400);
  expect((await request(x.app.baseUrl,'/api/documents/x/jobs',{baseRevision:0,operationId:'path',program:plate,path:'/tmp/formal'})).status).toBe(400);
  expect(x.app.supervisor.activeWorker).toBeNull();expect(x.app.store.snapshot('x').jobs).toHaveLength(0);
  const ws=new WebSocket(x.app.baseUrl.replace('http:','ws:')+'/api/documents/x/events?afterSeq=0',['cad-v1',`access.${token}`],{origin:'https://attacker.invalid'});
  const code=await new Promise<number>((r,j)=>{ws.once('unexpected-response',(_q,res)=>{r(res.statusCode!);res.resume();});ws.once('open',()=>j(new Error('Foreign origin accepted')));ws.once('error',()=>{});});expect(code).toBe(403);ws.terminate();
 }finally{await x.close();}
});
test('HTTP text request uses explicitly configured Pi runner and persists completed conversation',async()=>{
 const {scriptedTextRunner}=await import('../gateway/agent.ts');
 const root=mkdtempSync(join(tmpdir(),'cad-http-agent-'));
 const runner=scriptedTextRunner([{calls:[{name:'cad_apply',args:{operations:plate.operations}}]},{calls:[{name:'cad_finish',args:{criteria:plate.criteria}}]},{text:'validated candidate'}]);
 const app=await createGateway({dataDir:root,accessToken:token,port:0,textRunner:runner});
 try{await request(app.baseUrl,'/api/documents',{id:'plate'});const res=await request(app.baseUrl,'/api/documents/plate/jobs',{baseRevision:0,operationId:'text',text:'create plate'});expect(res.status).toBe(202);expect((await app.supervisor.waitForJob('plate','text')).status).toBe('committed');const snap=await (await request(app.baseUrl,'/api/documents/plate')).json();expect(snap.jobs[0].agent.messages.some((m:any)=>m.role==='assistant')).toBe(true);}finally{await app.close();rmSync(root,{recursive:true,force:true});}
});
