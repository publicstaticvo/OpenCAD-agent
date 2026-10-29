import {test,expect} from 'vitest';
import {approvedProgram} from './helpers/approved-program.ts';
import {mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {RevisionStore} from '../gateway/revision-store.ts';
import {Supervisor} from '../gateway/supervisor.ts';
import plate from './fixtures/models/plate.json';

test('native geometry, save, independent reopen and export stages persist in execution order',async()=>{
 const root=mkdtempSync(resolve('.work/progress-'));let store=new RevisionStore(root);store.createDocument('part');
 const supervisor=await Supervisor.start(store);
 try{
  approvedProgram(supervisor,'part',0,'create',plate);
  expect((await supervisor.waitForJob('part','create')).status).toBe('committed');
  const events=store.events('part',0),progress=events.filter(e=>e.type==='cad_progress'&&(e.data as any).stage!=='operation').map(e=>e.data as any);
  expect(progress.map(p=>`${p.stage}:${p.status}`)).toEqual(['geometry:start','geometry:complete','save:start','save:complete','reopen:start','reopen:complete','export_step:start','export_step:complete','export_glb:start','export_glb:complete']);
  expect(progress.every(p=>p.candidateId&&Number.isSafeInteger(p.requestId))).toBe(true);
  expect(events.every((e,i)=>e.seq===i+1&&e.conversationId===store.listConversations('part')[0].id)).toBe(true);
  expect(events.at(-1)?.type).toBe('committed');
  const replay:any[]=[];let cursor=0;
  for(;;){const page=store.jobEvents('part','create',cursor,1);replay.push(...page.events);if(!page.hasMore)break;cursor=page.lastSeq;}
  expect(replay).toEqual(events);
  expect(()=>store.jobEvents('part','missing')).toThrow('Job not found');
  expect(()=>store.jobEvents('part','create',0,0)).toThrow('pagination');
 }finally{await supervisor.close();store.close();}
 store=new RevisionStore(root);try{expect(store.snapshot('part').progress!.filter(e=>e.type==='cad_progress'&&(e.data as any).stage!=='operation')).toHaveLength(10);expect(store.snapshot('part').jobs[0]).toMatchObject({status:'committed'});}finally{store.close();}
});

test('older execution records remain paginated after the real progress window exceeds 500 events',async()=>{
 const root=mkdtempSync(resolve('.work/progress-window-')),store=new RevisionStore(root);store.createDocument('part');
 const supervisor=await Supervisor.start(store);
 try{
  approvedProgram(supervisor,'part',0,'create',plate);expect((await supervisor.waitForJob('part','create')).status).toBe('committed');
  const first=store.jobEvents('part','create').events;
  for(let revision=1;revision<=50;revision++){
   const diameter=revision%2?8:6,operationId=`edit-${revision}`;
   approvedProgram(supervisor,'part',revision,operationId,{operations:[{op:'set_parameter',feature:'hole',parameter:'diameter',value:diameter}],criteria:{bbox:[80,60,10],volume:48000-Math.PI*(diameter/2)**2*10}});
   expect((await supervisor.waitForJob('part',operationId)).status).toBe('committed');
  }
  expect(store.snapshot('part').progress).toHaveLength(500);
  expect(store.snapshot('part').progress!.some(event=>event.jobId==='create')).toBe(false);
  expect(store.jobEvents('part','create').events).toEqual(first);
 }finally{await supervisor.close();store.close();}
 const restored=new RevisionStore(root);try{expect(restored.jobEvents('part','create').events.filter(event=>event.type==='cad_progress'&&(event.data as any).stage!=='operation')).toHaveLength(10);}finally{restored.close();}
},180000);
