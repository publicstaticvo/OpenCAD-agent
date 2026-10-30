import {stableHash} from './revision-store.ts';
import {assertContract,type Criteria,type CadOperation} from '../shared/cad-contracts.ts';

export interface CadPlan {
 version:1;kind:'create_box'|'add_hole'|'edit_hole'|'program'|'pin_plate_assembly'|'edit_pin_plate_assembly';documentId:string;operationId:string;requestHash:string;
 assembly?:{length:number;width:number;thickness:number;holeDiameter:number;pinDiameter:number;pinLength:number};
 baseRevision:number;dimensions:{length:number;width:number;height:number;unit:'mm'};
 diameter?:number;previousDiameter?:number;center?:[number,number];criteria:Criteria;program?:import('../shared/cad-contracts.ts').ModelProgram;planHash:string;
}
export function createProgramPlan(program:unknown,identity:{documentId:string;operationId:string;requestHash:string},baseRevision:number):CadPlan{
 assertContract('program',program);const p=structuredClone(program) as import('../shared/cad-contracts.ts').ModelProgram;
 const content={version:1 as const,kind:'program' as const,...identity,baseRevision,dimensions:{length:p.criteria.bbox[0],width:p.criteria.bbox[1],height:p.criteria.bbox[2],unit:'mm' as const},criteria:p.criteria,program:p};
 return{...content,planHash:stableHash(content)};
}
export function createPlan(proposal:unknown,identity:{documentId:string;operationId:string;requestHash:string},snapshot:{revision:number;tree:any[]}):CadPlan{
 assertContract('plan',proposal);const p=proposal as any,rows=snapshot.tree;
 if(p.kind==='pin_plate_assembly'||p.kind==='edit_pin_plate_assembly'){
  const a=p.assembly,editing=p.kind==='edit_pin_plate_assembly';
  if(!editing&&(snapshot.revision!==0||rows.length))throw new Error('Assembly creation requires an empty project');
  if(editing){
   const value=(id:string,key:string)=>rows.find(row=>row.id===id)?.parameters?.[key];
   if(snapshot.revision<1||rows.filter(row=>row.type==='PartDesign::Body').length!==2||!rows.some(row=>row.id==='Assembly'&&row.type==='Assembly::AssemblyObject'))throw new Error('Assembly edit requires an existing formal assembly');
   if(value('PlateOutline','length')!==a.length||value('PlateOutline','width')!==a.width||value('PlatePad','Length')!==a.thickness||value('PlateHole','diameter')!==a.holeDiameter||value('PinPad','Length')!==a.pinLength)throw new Error('Assembly edit cannot change the plate or pin length');
   const currentPin=value('PinOutline','diameter');if(typeof currentPin!=='number'||currentPin===a.pinDiameter)throw new Error('Assembly edit must change the pin diameter');
  }
  if(a.holeDiameter>=Math.min(a.length,a.width)||a.pinDiameter>=Math.min(a.length,a.width))throw new Error('Assembly diameters must fit inside plate');
  const criteria:Criteria={bbox:[a.length,a.width,Math.max(a.thickness,a.pinLength)],volume:a.length*a.width*a.thickness-Math.PI*(a.holeDiameter/2)**2*a.thickness+Math.PI*(a.pinDiameter/2)**2*a.pinLength};assertContract('criteria',criteria);
  const content={version:1 as const,...identity,kind:p.kind as 'pin_plate_assembly'|'edit_pin_plate_assembly',baseRevision:snapshot.revision,assembly:structuredClone(a),dimensions:{length:a.length,width:a.width,height:Math.max(a.thickness,a.pinLength),unit:'mm' as const},criteria};
  return{...content,planHash:stableHash(content)};
 }
 let length=p.length,width=p.width,height=p.height,previousDiameter:number|undefined;
 if(p.kind==='create_box'){
  if(snapshot.revision!==0||rows.length)throw new Error('Create box requires an empty project');
 }else{
  const base=rows.find(r=>r.id==='base'&&r.type==='Sketcher::SketchObject'),pad=rows.find(r=>r.id==='pad'&&r.type==='PartDesign::Pad');
  if(!base||!pad||rows.filter(r=>r.type==='PartDesign::Body').length!==1||rows.find(r=>r.type==='PartDesign::Body')?.id!=='Body')throw new Error('Current model does not have the supported rectangular prism structure');
  length=base.parameters.width;width=base.parameters.height;height=pad.parameters.Length;
  const hole=rows.find(r=>r.id==='hole'&&r.type==='Sketcher::SketchObject'),pocket=rows.find(r=>r.id==='pocket'&&r.type==='PartDesign::Pocket');
  if(p.kind==='add_hole'&&(hole||pocket||rows.length!==3))throw new Error('Add hole requires the uncut prism');
  if(p.kind==='edit_hole'){
   if(!hole||!pocket||rows.length!==5||pocket.parameters.Length!==height||hole.parameters.center_x!==length/2||hole.parameters.center_y!==width/2)throw new Error('Current model does not have the supported center through hole');
   previousDiameter=hole.parameters.diameter;
  }
 }
 for(const n of [length,width,height])if(!Number.isFinite(n)||n<=0||n>1000000)throw new Error('Invalid prism dimensions');
 if(p.kind!=='create_box'&&(!(p.diameter<Math.min(length,width))||previousDiameter!==undefined&&(!Number.isFinite(previousDiameter)||previousDiameter===p.diameter)))throw new Error('Hole diameter must fit inside prism and change the existing dimension');
 const parameters=[{feature:'base',parameter:'width',value:length},{feature:'base',parameter:'height',value:width},{feature:'pad',parameter:'Length',value:height}];
 if(p.kind!=='create_box')parameters.push({feature:'hole',parameter:'diameter',value:p.diameter},{feature:'hole',parameter:'center_x',value:length/2},{feature:'hole',parameter:'center_y',value:width/2},{feature:'pocket',parameter:'Length',value:height});
 const criteria:Criteria={bbox:[length,width,height],volume:length*width*height-(p.kind==='create_box'?0:Math.PI*(p.diameter/2)**2*height),parameters};assertContract('criteria',criteria);
 const content={version:1 as const,...identity,kind:p.kind as CadPlan['kind'],baseRevision:snapshot.revision,dimensions:{length,width,height,unit:'mm' as const},...(p.kind==='create_box'?{}:{diameter:p.diameter,center:[length/2,width/2] as [number,number],...(previousDiameter===undefined?{}:{previousDiameter})}),criteria};
 return{...content,planHash:stableHash(content)};
}

/** Finite authorization contracts. This module never executes CAD operations. */
export function approvedStages(plan:CadPlan):{name:string;sketchId:string;operations:CadOperation[]}[]{
 if(plan.kind==='pin_plate_assembly')return [...['plate','pin','assemble'].map((stage,index)=>({name:['底板：矩形、约束、Pad、中心孔 Pocket','圆柱销：圆草图、约束、Pad','原生固定关节装配'][index],sketchId:'',operations:[{op:'assembly_stage',stage,design:plan.assembly!}]})),{name:'实际几何干涉检查',sketchId:'',operations:[{op:'assembly_check',design:plan.assembly!}]}];
 if(plan.kind==='edit_pin_plate_assembly')return [{name:'修改圆柱销直径',sketchId:'',operations:[{op:'assembly_stage',stage:'pin_edit',design:plan.assembly!}]},{name:'实际几何干涉检查',sketchId:'',operations:[{op:'assembly_check',design:plan.assembly!}]}];
 if(plan.kind==='program')return[{name:'批准的 CAD 操作程序',sketchId:'',operations:plan.program!.operations}];
 const {length:l,width:w,height:h}=plan.dimensions;
 const constraint=(sketch:string,name:string,kind:string,args:number[]):CadOperation=>({op:'add_constraint',sketch,name,kind,args});
 if(plan.kind==='edit_hole')return[{name:'修改孔径',sketchId:'hole',operations:[{op:'set_parameter',feature:'hole',parameter:'diameter',value:plan.diameter!}]}];
 if(plan.kind==='add_hole')return[
  {name:'中心圆草图与约束',sketchId:'hole',operations:[{op:'create_sketch',id:'hole',body:'Body',plane:'XY',origin:[0,0,h]},{op:'add_geometry',sketch:'hole',geometryId:0,geometry:{kind:'circle',center:[l/2,w/2],radius:plan.diameter!/2}},constraint('hole','diameter','Diameter',[0,plan.diameter!]),constraint('hole','center_x','DistanceX',[0,3,l/2]),constraint('hole','center_y','DistanceY',[0,3,w/2])]},
  {name:'贯穿 Pocket',sketchId:'hole',operations:[{op:'pocket',id:'pocket',sketch:'hole',length:h}]}];
 const corners=[[0,0],[l,0],[l,w],[0,w]];
 const ops:CadOperation[]=[{op:'create_body',id:'Body'},{op:'create_sketch',id:'base',body:'Body',plane:'XY',origin:[0,0,0]}];
 for(let i=0;i<4;i++)ops.push({op:'add_geometry',sketch:'base',geometryId:i,geometry:{kind:'line',from:corners[i],to:corners[(i+1)%4]}});
 for(let i=0;i<4;i++)ops.push(constraint('base',`corner${i}`,'Coincident',[i,2,(i+1)%4,1]),constraint('base',`axis${i}`,i%2?'Vertical':'Horizontal',[i]));
 ops.push(constraint('base','origin','Coincident',[0,1,-1,1]),constraint('base','width','Distance',[0,l]),constraint('base','height','Distance',[1,w]));
 return[{name:'矩形草图与约束',sketchId:'base',operations:ops},{name:'Pad 实体',sketchId:'base',operations:[{op:'pad',id:'pad',sketch:'base',length:h}]}];
}

export function assertPlanIntegrity(plan:CadPlan){const {planHash,...content}=plan;if(plan.version!==1)throw new Error('Unsupported approved plan version');if(stableHash(content)!==planHash)throw new Error('Approved plan content changed');}
/** Check actual Worker readback before allowing the next stage or displaying it. */
export function assertCandidateSnapshot(plan:CadPlan,completed:number,snapshot:any){
 const stages=approvedStages(plan),stage=stages[completed-1];if(!stage||plan.kind==='program')throw new Error('Invalid candidate stage');
 const final=completed===stages.length,{length:l,width:w,height:h}=plan.dimensions,sketch=snapshot.sketch;
 const near=(value:unknown,expected:number,tolerance=1e-6)=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value-expected)<=tolerance;
 const vector=(actual:any,expected:number[])=>Array.isArray(actual)&&actual.length===expected.length&&actual.every((n:any,i:number)=>near(n,expected[i]));
 const expected:Record<string,string>={Body:'PartDesign::Body',base:'Sketcher::SketchObject'};
 if(plan.kind!=='create_box'||final)expected.pad='PartDesign::Pad';
 if(plan.kind!=='create_box')expected.hole='Sketcher::SketchObject';
 if(plan.kind==='edit_hole'||plan.kind==='add_hole'&&final)expected.pocket='PartDesign::Pocket';
 if(stableHash(snapshot.tree.map((r:any)=>[r.id,r.type]).sort())!==stableHash(Object.entries(expected).sort()))throw new Error('Actual candidate feature structure differs from approved stage');
 if(!sketch||sketch.featureId!==stage.sketchId||sketch.fullyConstrained!==true||!vector(sketch.placement.base,[0,0,plan.kind==='create_box'?0:h])||!vector(sketch.placement.rotation,[0,0,0,1]))throw new Error('Actual candidate sketch placement or constraint state differs from approval');
 let dimensions:Record<string,number>;
 if(plan.kind==='create_box'){
  const points=[[0,0],[l,0],[l,w],[0,w]];
  if(sketch.geometry.length!==4||!sketch.geometry.every((g:any,i:number)=>g.index===i&&g.kind==='line'&&vector(g.start,points[i])&&vector(g.end,points[(i+1)%4])))throw new Error('Actual rectangle sketch geometry differs from approval');
  if(sketch.constraints.length!==11)throw new Error('Actual rectangle sketch constraints differ from approval');
  dimensions={width:l,height:w};
 }else{
  const circle=sketch.geometry[0];
  if(sketch.geometry.length!==1||circle.kind!=='circle'||!vector(circle.center,[l/2,w/2])||!near(circle.radius,plan.diameter!/2)||sketch.constraints.length!==3)throw new Error('Actual circle sketch differs from approval');
  dimensions={diameter:plan.diameter!,center_x:l/2,center_y:w/2};
 }
 for(const [name,value] of Object.entries(dimensions))if(!sketch.constraints.some((c:any)=>c.name===name&&near(c.value,value)))throw new Error('Actual sketch dimension differs from approval');
 const contract=approvedStages(plan.kind==='edit_hole'?{...plan,kind:'add_hole'}:plan)[0].operations.filter((op:any)=>op.op==='add_constraint') as any[];
 const remaining=[...sketch.constraints];
 if(new Set(remaining.map(c=>c.name)).size!==remaining.length)throw new Error('Actual sketch constraint names are duplicated');
 for(const op of contract){
  const index=remaining.findIndex(c=>{
   if(c.kind!==op.kind||c.firstGeometry!==op.args[0])return false;
   if(op.kind==='Coincident')return c.firstPos===op.args[1]&&c.secondGeometry===op.args[2]&&c.secondPos===op.args[3];
   if(op.kind==='Horizontal'||op.kind==='Vertical')return true;
   if(c.name!==op.name||!near(c.value,op.args.at(-1)))return false;
   return !['DistanceX','DistanceY'].includes(op.kind)||c.firstPos===op.args[1];
  });
  if(index<0)throw new Error('Actual sketch constraint type or reference differs from approval');
  remaining.splice(index,1);
 }
 if(remaining.length)throw new Error('Actual sketch has unapproved constraints');
 if(final&&(!snapshot.geometry||!vector(snapshot.geometry.bbox,plan.criteria.bbox)||!near(snapshot.geometry.volume,plan.criteria.volume,Math.max(1e-6,plan.criteria.volume*1e-9))||snapshot.geometry.solids!==1))throw new Error('Actual candidate geometry differs from approval');
}
export function authorizeOperations(plan:CadPlan,operations:unknown,stage:number):number{
 assertPlanIntegrity(plan);
 if(!Array.isArray(operations)||!operations.length)throw new Error('Invalid approved operation batch');
 for(const op of operations)assertContract('operation',op);
 const expected=approvedStages(plan)[stage];if(!expected)throw new Error('Approved stages already completed');
 const normalize=(op:any)=>plan.kind!=='program'&&op.op==='add_constraint'&&!['Distance','DistanceX','DistanceY','Diameter','Radius'].includes(op.kind)?{...op,name:'constraint'}:op;
 const keys=expected.operations.map(o=>stableHash(normalize(o)));
 const names=new Set<string>();
 for(const op of operations){
  if(op.op==='add_constraint'){const key=`${op.sketch}/${op.name}`;if(names.has(key))throw new Error('Duplicate approved constraint name');names.add(key);}
  const index=keys.indexOf(stableHash(normalize(op)));if(index<0)throw new Error('Operation exceeds approved geometry, parameters or stage');keys.splice(index,1);
 }
 if(keys.length)throw new Error('Incomplete approved operation batch');
 if(plan.kind==='program'){
  if(stableHash(operations)!==stableHash(expected.operations))throw new Error('Approved program operation order changed');
  return stage;
 }
 let bodyExists=plan.kind!=='create_box'||stage>0;
 const sketches=new Map<string,number>();
 if(plan.kind!=='create_box'||stage>0)sketches.set('base',4);
 if(plan.kind==='edit_hole'||plan.kind==='add_hole'&&stage>0)sketches.set('hole',1);
 for(const op of operations){
  if(op.op==='create_body')bodyExists=true;
  else if(op.op==='create_sketch'){
   if(!bodyExists)throw new Error('Approved operation dependency order requires Body before Sketch');
   sketches.set(op.id,0);
  }else if(op.op==='add_geometry'){
   if(sketches.get(op.sketch)!==op.geometryId)throw new Error('Approved geometry dependency order must be contiguous');
   sketches.set(op.sketch,op.geometryId+1);
  }else if(op.op==='add_constraint'){
   const count=sketches.get(op.sketch),refs=op.kind==='Coincident'?[op.args[0],op.args[2]]:[op.args[0]];
   if(count===undefined||refs.some((index:number)=>index!==-1&&index>=count))throw new Error('Approved constraint dependency order requires existing geometry');
  }else if((op.op==='pad'||op.op==='pocket')&&!sketches.has(op.sketch))throw new Error('Approved feature dependency requires existing Sketch');
 }
 return stage;
}
