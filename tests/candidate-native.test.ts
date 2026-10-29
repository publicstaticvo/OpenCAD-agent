import {expect,test} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {WorkerClient} from '../gateway/worker-client.ts';
import {createPlan,approvedStages,assertCandidateSnapshot} from '../gateway/plan.ts';
test('native candidate exposes actual constrained sketch, Pad, centered through Pocket and editable diameter',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'cad-plan-native-'));const progress:any[]=[];
 const worker=await WorkerClient.start({workspace:directory,onProgress:p=>progress.push(p)});
 const envelope={documentId:'part',operationId:'create',candidateId:'candidate',baseRevision:0};
 try{
  await worker.request('begin_candidate',{envelope});
  const identity={documentId:'part',operationId:'create',requestHash:'request'};
  const box=createPlan({kind:'create_box',length:40,width:30,height:10},identity,{revision:0,tree:[]});
  let seq=0;const execute=async(plan:any)=>{let completed=0;for(const stage of approvedStages(plan)){await worker.request('apply_operations',{envelope,stepId:`step${seq}`,operations:stage.operations});const snapshot=await worker.request('candidate_snapshot',{envelope,sketchId:stage.sketchId,includePreview:++seq%2===0,sequence:seq});assertCandidateSnapshot(plan,++completed,snapshot);expect(snapshot.sketch.fullyConstrained).toBe(true);if(seq===1){expect(snapshot.sketch.geometry).toHaveLength(4);expect(snapshot.geometry).toBeUndefined();const wrong=structuredClone(snapshot);wrong.sketch.geometry[0].end[0]=99;expect(()=>assertCandidateSnapshot(plan,completed,wrong)).toThrow(/sketch/i);}if(snapshot.preview)expect(snapshot.preview.sha256).toMatch(/^[a-f0-9]{64}$/);}};
  await execute(box);
  const actual=await worker.request('candidate_snapshot',{envelope,sketchId:'base',includePreview:false,sequence:20});
  const wrongReferences=structuredClone(actual);wrongReferences.sketch.constraints.find((c:any)=>c.kind==='Coincident').firstGeometry=3;
  expect(()=>assertCandidateSnapshot(box,2,wrongReferences)).toThrow(/constraint/i);
  const wrongType=structuredClone(actual);wrongType.sketch.constraints.find((c:any)=>c.kind==='Horizontal').kind='Vertical';
  expect(()=>assertCandidateSnapshot(box,2,wrongType)).toThrow(/constraint/i);
  const state=await worker.request('inspect_document',{});
  const hole=createPlan({kind:'add_hole',diameter:6},identity,{revision:1,tree:state.tree});await execute(hole);
  const withHole=await worker.request('inspect_document',{});
  const edit=createPlan({kind:'edit_hole',diameter:8},identity,{revision:2,tree:withHole.tree});await execute(edit);
  const result=await worker.request('prepare_candidate',{envelope,criteria:edit.criteria,design:edit});
  expect(result.validation.volume).toBeCloseTo(12000-Math.PI*16*10,6);
  expect(result.validation.throughHole).toMatchObject({diameter:8,center:[20,15],through:true});
  expect(progress.filter(p=>p.stage==='operation').length).toBeGreaterThan(20);
 }finally{await worker.close();rmSync(directory,{recursive:true,force:true});}
},20000);
