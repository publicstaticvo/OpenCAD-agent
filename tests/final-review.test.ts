import {test,expect} from 'vitest';import {WorkerClient} from '../gateway/worker-client.ts';import {Supervisor} from '../gateway/supervisor.ts';import {RevisionStore} from '../gateway/revision-store.ts';
import {mkdtempSync,writeFileSync,readFileSync,openSync,closeSync} from 'node:fs';import {spawnSync} from 'node:child_process';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {readDataset} from '../gateway/evaluation.ts';import {runEvaluation} from '../gateway/evaluation-runner.ts';import {scriptedTextRunner} from '../gateway/agent.ts';import plate from './fixtures/models/plate.json';
test.each([{},{result:null,error:{code:1,message:'both'}},{error:{}}])('malformed matching response %j settles the real Worker request and closes without hanging',async fields=>{
 const c=await WorkerClient.start();try{c.process.kill('SIGSTOP');const request=c.request('inspect_document',{},30).then(()=> 'resolved',(e:Error)=>e.message);(c as any).receive(Buffer.from(JSON.stringify({jsonrpc:'2.0',id:(c as any).seq,...fields})+'\n'));expect(await Promise.race([request,new Promise(r=>setTimeout(()=>r('hung'),100))])).toMatch(/Invalid Worker response/);await c.close();const next=await WorkerClient.start();try{expect(await next.request('inspect_document',{})).toEqual({tree:[],loaded:false});}finally{await next.close();}}finally{await c.close();}
});
test('kernel owner lock cannot be bypassed by absent or stale diagnostic JSON',async()=>{
 const root=mkdtempSync(join(tmpdir(),'cad-owner-')),store=new RevisionStore(root),fd=openSync(join(root,'supervisor.owner.lock'),'a',0o600);let s:Supervisor|undefined;
 try{expect(spawnSync('/usr/bin/flock',['-n','3'],{stdio:['ignore','pipe','pipe',fd]}).status).toBe(0);let error:any;try{s=await Supervisor.start(store);}catch(e){error=e;}expect(error?.code).toBe('busy');}finally{await s?.close();closeSync(fd);store.close();}
});
test('corrupt historical metadata fails closed with actionable error and releases ownership',async()=>{
 const root=mkdtempSync(join(tmpdir(),'cad-corrupt-lock-')),store=new RevisionStore(root);writeFileSync(join(root,'supervisor.lock'),'');
 try{await expect(Supervisor.start(store)).rejects.toMatchObject({code:'unsafe',message:expect.stringMatching(/corrupt.*lease/i)});expect(readFileSync(join(root,'supervisor.lock'),'utf8')).toBe('');const fd=openSync(join(root,'supervisor.owner.lock'),'a');try{expect(spawnSync('/usr/bin/flock',['-n','3'],{stdio:['ignore','pipe','pipe',fd]}).status).toBe(0);}finally{closeSync(fd);}}finally{store.close();}
});
test.each(['constraint','placement'])('independent golden rejects native-valid wrong hole position via %s',async mutation=>{
 const wrong=structuredClone(plate);for(const op of wrong.operations as any[]){if(mutation==='constraint'&&op.op==='add_constraint'&&op.sketch==='hole'&&op.name==='center_x')op.args[2]=40;if(mutation==='placement'&&op.op==='create_sketch'&&op.id==='hole')op.origin=[10,0,10];}
 const runner=scriptedTextRunner([{calls:[{name:'cad_apply',args:{operations:wrong.operations}}]},{calls:[{name:'cad_finish',args:{criteria:wrong.criteria}}]}]);
 const data=readDataset('evals/text-to-cad/v1.json');const report=await runEvaluation({...data,cases:data.cases.filter(c=>c.id==='plate-create')},runner,mkdtempSync(join(tmpdir(),'cad-golden-shift-')),'offline');expect(report.rows[0].pass).toBe(false);expect(report.rows[0].error).toMatch(/reference geometry/i);
},15000);
test('benchmark exposes its stable feature and dimensional naming contract in model input',async()=>{
 const {benchmarkPrompt}=await import('../gateway/evaluation.ts');const c=readDataset('evals/text-to-cad/v1.json').cases[0];const prompt=benchmarkPrompt(c);expect(prompt).toContain('命名约定');for(const name of ['Body','base','pad','hole','pocket','center_x','center_y','diameter'])expect(prompt).toContain(name);
});
