import {test,expect} from 'vitest';
import {createPlan,approvedStages,authorizeOperations} from '../gateway/plan.ts';
test('assembly approval binds both parts, fixed relation and ordered native stages',()=>{
 const plan=createPlan({kind:'pin_plate_assembly',assembly:{length:80,width:60,thickness:10,holeDiameter:8,pinDiameter:7,pinLength:20}},{documentId:'part',operationId:'build',requestHash:'request'},{revision:0,tree:[]});
 expect(plan.kind).toBe('pin_plate_assembly');
 const stages=approvedStages(plan);expect(stages.map(stage=>stage.name)).toHaveLength(4);
 for(const [index,stage] of stages.entries())expect(authorizeOperations(plan,stage.operations,index)).toBe(index);
 expect(()=>authorizeOperations(plan,stages[1].operations,0)).toThrow();
 expect(()=>authorizeOperations(plan,[{...stages[0].operations[0],design:{...plan.assembly,pinDiameter:9}}],0)).toThrow();
 expect(plan.criteria.bbox).toEqual([80,60,20]);
});

test('assembly pin edit plan binds the existing formal assembly and only changes pin diameter',()=>{
 const tree=[
  {id:'plate',type:'PartDesign::Body'},
  {id:'PlateOutline',type:'Sketcher::SketchObject',parameters:{length:60,width:40}},
  {id:'PlatePad',type:'PartDesign::Pad',parameters:{Length:8}},
  {id:'PlateHole',type:'Sketcher::SketchObject',parameters:{diameter:8}},
  {id:'PlatePocket',type:'PartDesign::Pocket',parameters:{Length:8}},
  {id:'pin',type:'PartDesign::Body'},
  {id:'PinOutline',type:'Sketcher::SketchObject',parameters:{diameter:7}},
  {id:'PinPad',type:'PartDesign::Pad',parameters:{Length:20}},
  {id:'Assembly',type:'Assembly::AssemblyObject'}
 ];
 const plan=createPlan({kind:'edit_pin_plate_assembly',assembly:{length:60,width:40,thickness:8,holeDiameter:8,pinDiameter:10,pinLength:20}},{documentId:'part',operationId:'edit',requestHash:'request'},{revision:1,tree});
 expect(plan.kind).toBe('edit_pin_plate_assembly');expect(plan.baseRevision).toBe(1);expect(approvedStages(plan).map(stage=>stage.operations[0].op)).toEqual(['assembly_stage','assembly_check']);
 expect(()=>createPlan({kind:'edit_pin_plate_assembly',assembly:{length:60,width:40,thickness:8,holeDiameter:9,pinDiameter:10,pinLength:20}},{documentId:'part',operationId:'edit',requestHash:'request'},{revision:1,tree})).toThrow();
});
