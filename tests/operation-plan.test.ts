import {test,expect} from 'vitest';
import {createPlan,approvedStages,authorizeOperations} from '../gateway/plan.ts';
const identity={documentId:'part',operationId:'create',requestHash:'request'};
export const triangleProposal={kind:'operations',goal:'40 × 30 × 10 mm 三角棱柱',stages:[
 {name:'三角形草图与约束',sketchId:'outline',operations:[
  {op:'create_body',id:'Body'},{op:'create_sketch',id:'outline',body:'Body',plane:'XY',origin:[0,0,0]},
  ...[[[0,0],[40,0]],[[40,0],[0,30]],[[0,30],[0,0]]].map(([from,to],geometryId)=>({op:'add_geometry',sketch:'outline',geometryId,geometry:{kind:'line',from,to}})),
  ...[0,1,2].map(i=>({op:'add_constraint',sketch:'outline',name:`corner${i}`,kind:'Coincident',args:[i,2,(i+1)%3,1]})),
  ...[{name:'horizontal',kind:'Horizontal',args:[0]},{name:'vertical',kind:'Vertical',args:[2]},{name:'origin',kind:'Coincident',args:[0,1,-1,1]},{name:'length',kind:'Distance',args:[0,40]},{name:'width',kind:'Distance',args:[2,30]}].map(c=>({op:'add_constraint',sketch:'outline',...c}))]},
 {name:'Pad 三角棱柱',sketchId:'outline',operations:[{op:'pad',id:'prism',sketch:'outline',length:10}]}],criteria:{bbox:[40,30,10],volume:6000}};
test('general operation plan preserves actual stages and exact approved operation order',()=>{
 const plan=createPlan(triangleProposal,identity,{revision:0,tree:[]});
 expect(plan.kind).toBe('operations');expect(approvedStages(plan)).toEqual(triangleProposal.stages);
 expect(authorizeOperations(plan,triangleProposal.stages[0].operations,0)).toBe(0);
 const changed=structuredClone(triangleProposal.stages[0].operations).reverse();
 expect(()=>authorizeOperations(plan,changed,0)).toThrow(/order|approved/i);
 const wrong=structuredClone(triangleProposal) as any;wrong.stages[1].operations[0].length=11;
 expect(createPlan(wrong,identity,{revision:0,tree:[]}).planHash).not.toBe(plan.planHash);
});
test('general plans reject unverified assembly operations and missing base history',()=>{
 const bad=structuredClone(triangleProposal) as any;bad.stages[1].operations=[{op:'assembly_check',design:{length:60,width:40,thickness:8,holeDiameter:8,pinDiameter:7,pinLength:20}}];
 expect(()=>createPlan(bad,identity,{revision:0,tree:[]})).toThrow();
 expect(()=>createPlan(triangleProposal,identity,{revision:1,tree:[{id:'Body'}]})).toThrow(/history/i);
});
test('approval requires nonempty goal and stage labels',()=>{
 for(const field of ['goal','stage']){
  const proposal=structuredClone(triangleProposal);
  if(field==='goal')proposal.goal=' ';else proposal.stages[0].name='';
  expect(()=>createPlan(proposal,identity,{revision:0,tree:[]})).toThrow();
 }
});
