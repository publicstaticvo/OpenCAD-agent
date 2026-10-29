import {expect,test} from 'vitest';
import {createPlan,authorizeOperations,approvedStages} from '../gateway/plan.ts';

const identity={documentId:'part',operationId:'create',requestHash:'request'};
const empty={revision:0,tree:[]};
test('plan binds request and derives acceptance from requested dimensions',()=>{
 const plan=createPlan({kind:'create_box',length:40,width:30,height:10},identity,empty);
 expect(plan.criteria.bbox).toEqual([40,30,10]);expect(plan.criteria.volume).toBe(12000);
 expect(plan.planHash).not.toBe(createPlan({kind:'create_box',length:50,width:30,height:10},identity,empty).planHash);
 const stages=approvedStages(plan);
 expect(authorizeOperations(plan,stages[0].operations,0)).toBe(0);
 expect(authorizeOperations(plan,stages[1].operations,1)).toBe(1);
 const wrong=structuredClone(stages[0].operations) as any[];wrong.find(o=>o.op==='add_geometry').geometry.to=[99,0];
 expect(()=>authorizeOperations(plan,wrong,0)).toThrow(/approved/i);
 expect(()=>authorizeOperations(plan,stages[1].operations,0)).toThrow();
 expect(()=>authorizeOperations(plan,[...stages[0].operations,...stages[1].operations],0)).toThrow();
});
test('hole and diameter edit derive dimensions and volume from formal feature data',()=>{
 const tree=[{id:'Body',type:'PartDesign::Body',parameters:{}},{id:'base',type:'Sketcher::SketchObject',parameters:{width:40,height:30}},{id:'pad',type:'PartDesign::Pad',parameters:{Length:10}}];
 const hole=createPlan({kind:'add_hole',diameter:6},identity,{revision:1,tree});
 expect(hole.criteria.volume).toBeCloseTo(12000-Math.PI*9*10,8);
 expect(hole.center).toEqual([20,15]);
 expect(approvedStages(hole)[0].operations.some((o:any)=>o.geometry?.kind==='circle')).toBe(true);
 const edit=createPlan({kind:'edit_hole',diameter:8},identity,{revision:2,tree:[...tree,{id:'hole',type:'Sketcher::SketchObject',parameters:{diameter:6,center_x:20,center_y:15}},{id:'pocket',type:'PartDesign::Pocket',parameters:{Length:10}}]});
 expect(edit.previousDiameter).toBe(6);expect(edit.criteria.volume).toBeCloseTo(12000-Math.PI*16*10,8);
 expect(()=>createPlan({kind:'add_hole',diameter:40},identity,{revision:1,tree})).toThrow();
 expect(()=>createPlan({kind:'create_box',length:40,width:30,height:10,extra:true},identity,empty)).toThrow();
});

test('approved batches check creation and geometry dependencies before native execution',()=>{
 const plan=createPlan({kind:'create_box',length:40,width:30,height:10},identity,empty);
 const operations=approvedStages(plan)[0].operations;
 const reversedGeometry=structuredClone(operations);[reversedGeometry[2],reversedGeometry[3]]=[reversedGeometry[3],reversedGeometry[2]];
 expect(()=>authorizeOperations(plan,reversedGeometry,0)).toThrow(/dependency|order/i);
 const earlySketch=structuredClone(operations);[earlySketch[0],earlySketch[1]]=[earlySketch[1],earlySketch[0]];
 expect(()=>authorizeOperations(plan,earlySketch,0)).toThrow(/dependency|order/i);
 const earlyConstraint=structuredClone(operations);const constraint=earlyConstraint.splice(6,1)[0];earlyConstraint.splice(2,0,constraint);
 expect(()=>authorizeOperations(plan,earlyConstraint,0)).toThrow(/dependency|order/i);
 const legalOrder=[...operations.slice(0,6),...operations.slice(6).reverse()];
 expect(authorizeOperations(plan,legalOrder,0)).toBe(0);
});
