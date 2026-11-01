import type {CadOperation,Criteria} from '../../shared/cad-contracts.ts';
export function polygonPlan(name:string,points:number[][],axes:[number,string][],dimensions:[number,number][],height:number,criteria:Criteria){
 const operations:CadOperation[]=[{op:'create_body',id:'Body'},{op:'create_sketch',id:'outline',body:'Body',plane:'XY',origin:[0,0,0]}];
 for(const [i,from] of points.entries())operations.push({op:'add_geometry',sketch:'outline',geometryId:i,geometry:{kind:'line',from,to:points[(i+1)%points.length]}});
 for(let i=0;i<points.length;i++)operations.push({op:'add_constraint',sketch:'outline',name:`corner${i}`,kind:'Coincident',args:[i,2,(i+1)%points.length,1]});
 for(const [i,kind] of axes)operations.push({op:'add_constraint',sketch:'outline',name:`axis${i}`,kind,args:[i]});
 operations.push({op:'add_constraint',sketch:'outline',name:'origin',kind:'Coincident',args:[0,1,-1,1]});
 for(const [i,value] of dimensions)operations.push({op:'add_constraint',sketch:'outline',name:`size${i}`,kind:'Distance',args:[i,value]});
 return {kind:'operations',goal:name,stages:[{name:'实际多边形草图与约束',sketchId:'outline',operations},{name:'Pad 实体',sketchId:'outline',operations:[{op:'pad',id:'solid',sketch:'outline',length:height}]}],criteria};
}
export const triangle=polygonPlan('40 × 30 × 10 mm 三角棱柱',[[0,0],[40,0],[0,30]],[[0,'Horizontal'],[2,'Vertical']],[[0,40],[2,30]],10,{bbox:[40,30,10],volume:6000});
export const bracket=polygonPlan('60 × 50 × 8 mm L 形支架，臂宽10 mm',[[0,0],[60,0],[60,10],[10,10],[10,50],[0,50]],[[0,'Horizontal'],[1,'Vertical'],[2,'Horizontal'],[3,'Vertical'],[4,'Horizontal'],[5,'Vertical']],[[0,60],[1,10],[2,50],[3,40]],8,{bbox:[60,50,8],volume:8000});
export const bracketHole={kind:'operations',goal:'L 形支架底臂增加 Ø4 mm 贯穿孔，中心 [30,5]',stages:[
 {name:'偏心孔草图与约束',sketchId:'hole',operations:[{op:'create_sketch',id:'hole',body:'Body',plane:'XY',origin:[0,0,8]},{op:'add_geometry',sketch:'hole',geometryId:0,geometry:{kind:'circle',center:[30,5],radius:2}},
  ...[{name:'diameter',kind:'Diameter',args:[0,4]},{name:'center_x',kind:'DistanceX',args:[0,3,30]},{name:'center_y',kind:'DistanceY',args:[0,3,5]}].map(c=>({op:'add_constraint',sketch:'hole',...c}))]},
 {name:'Pocket 贯穿孔',sketchId:'hole',operations:[{op:'pocket',id:'cut',sketch:'hole',length:8}]}],criteria:{bbox:[60,50,8],volume:8000-Math.PI*4*8,parameters:[{feature:'hole',parameter:'diameter',value:4}]}};
export const triangleEdit={kind:'operations',goal:'三角棱柱拉伸高度改为12 mm',stages:[{name:'修改 Pad 长度',sketchId:'outline',operations:[{op:'set_parameter',feature:'solid',parameter:'Length',value:12}]}],criteria:{bbox:[40,30,12],volume:7200,parameters:[{feature:'solid',parameter:'Length',value:12}]}};
