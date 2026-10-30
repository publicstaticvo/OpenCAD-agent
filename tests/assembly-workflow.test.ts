import {test,expect} from 'vitest';
import {mkdtempSync,readdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createGateway} from '../gateway/server.ts';
import {approvedStages} from '../gateway/plan.ts';
import type {TextRunner,CadSession} from '../gateway/agent.ts';
import type {Job} from '../gateway/supervisor.ts';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Box3,Mesh} from 'three';
test('native assembly commits only after approval and complete ordered checks',async()=>{
 const root=mkdtempSync(resolve('.work/assembly-flow-'));
 const runner:TextRunner=Object.assign(async(job:Job,session:CadSession)=>{
  if(session.mode==='planning'){await session.propose!({kind:'pin_plate_assembly',assembly:{length:80,width:60,thickness:10,holeDiameter:8,pinDiameter:job.request.text==='collision'?9:7,pinLength:20}});return;}
  for(const [index,stage] of approvedStages(session.plan!).entries())await session.apply(stage.operations,`stage-${index}`);
  await session.prepare(session.plan!.criteria);return session.plan!.criteria;
 },{mode:'fake' as const});
 const gateway=await createGateway({dataDir:root,accessToken:'assembly-workflow-test-token-12345',port:0,textRunner:runner});
 try{
  for(const id of ['normal','collision']){
   gateway.store.createDocument(id);gateway.supervisor.submitText(id,0,'build',id);
   const planned=await gateway.supervisor.waitForJob(id,'build');expect(planned.status).toBe('awaiting_approval');
   expect(readdirSync(resolve(root,'staging'))).toEqual([]);
   gateway.supervisor.approveJob(id,'build',planned.plan!.planHash);
   const done=await gateway.supervisor.waitForJob(id,'build');
   if(id==='normal'){
    expect(done.error).toBeNull();expect(done.status).toBe('committed');
    const snapshot=gateway.store.snapshot(id);expect(snapshot.revision).toBe(1);expect(snapshot.validation.assembly.interference.status).toBe('clear');
    expect(snapshot.validation.assembly.components[1].position).toEqual([40,30,0]);
    expect(snapshot.validation.glb.meshes).toBe(2);
    const bytes=readFileSync(gateway.store.artifactPath(id,1,'preview.glb'));
    const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
    const componentBounds=new Map<string,Box3>();gltf.scene.updateMatrixWorld(true);gltf.scene.traverse(object=>{if(object instanceof Mesh){const parent=object.parent;if(parent?.type!=='Group'||!['PlateComponent','PinComponent'].includes(parent.name))return;const box=new Box3().setFromObject(object);componentBounds.set(parent.name,componentBounds.has(parent.name)?componentBounds.get(parent.name)!.union(box):box);}});
    expect([...componentBounds.keys()].sort()).toEqual(['PinComponent','PlateComponent']);
    const plate=componentBounds.get('PlateComponent')!,pin=componentBounds.get('PinComponent')!;
    for(const [axis,value] of [...plate.min.toArray(),...plate.max.toArray()].entries())expect(value).toBeCloseTo([0,0,-.06,.08,.01,0][axis],4);
    for(const [axis,value] of [...pin.min.toArray(),...pin.max.toArray()].entries())expect(value,JSON.stringify([pin.min.toArray(),pin.max.toArray()])).toBeCloseTo([.0365,0,-.0335,.0435,.02,-.0265][axis],4);
    expect(JSON.parse(readFileSync(gateway.store.artifactPath(id,1,'validation.json'),'utf8')).assembly.bom).toHaveLength(2);
   }else {expect(done.status).toBe('failed');expect(done.error).toContain('133.517687');expect(gateway.store.snapshot(id).revision).toBe(0);const events=gateway.store.snapshot(id).progress??[];expect(events.some((event:any)=>event.type==='cad_progress'&&event.data.stage==='interference'&&event.data.report.status==='collision')).toBe(true);}
  }
 }finally{await gateway.close();}
},30000);
