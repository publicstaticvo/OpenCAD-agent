import {test,expect} from 'vitest';import {WorkspaceStore,type ModelAsset} from '../web/src/store.ts';
import type {DocumentSnapshot,AppEvent} from '../shared/cad-contracts.ts';import {Group} from 'three';
const snapshot=(revision:number,lastSeq=revision):DocumentSnapshot=>({documentId:'doc',revision,lastSeq,tree:[{id:'hole',label:'hole',type:'Sketcher::SketchObject',parent:'Body',parameters:{diameter:revision===1?6:8}}],artifacts:{'preview.glb':`/api/documents/doc/revisions/${revision}/artifacts/preview.glb`},jobs:[]});
function asset(){let disposed=false;return{scene:new Group(),triangles:12,bounds:[[0,0,0],[.08,.01,.06]],dispose(){disposed=true;},get disposed(){return disposed;}} as ModelAsset&{disposed:boolean};}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};}
test('late GLB cannot replace newer snapshot; tree/parameters/mesh switch together',async()=>{
 const first=deferred<ModelAsset>(),second=deferred<ModelAsset>();let n=0;
 const s=new WorkspaceStore('doc',{snapshot:async()=>snapshot(++n),asset:(_url:string,rev:number)=>rev===1?first.promise:second.promise});
 const p1=s.refresh();await Promise.resolve();const p2=s.refresh();await Promise.resolve();const a=asset(),b=asset();second.resolve(b);await p2;
 expect(s.state.current?.snapshot.revision).toBe(2);expect(s.state.current?.snapshot.tree[0].parameters.diameter).toBe(8);expect(s.state.current?.asset).toBe(b);
 first.resolve(a);await p1;expect(s.state.current?.asset).toBe(b);expect(a.disposed).toBe(true);s.close();expect(b.disposed).toBe(true);
});
test('duplicates, out-of-order events, gaps and wrong documents converge to latest snapshot',async()=>{
 let rev=1;const s=new WorkspaceStore('doc',{snapshot:async()=>snapshot(rev,rev),asset:async()=>asset()});await s.refresh();rev=3;
 const event=(seq:number,documentId='doc'):AppEvent=>({seq,documentId,jobId:null,type:'committed',revision:seq,candidateId:'c',data:{}});
 await s.consume(event(3));expect(s.state.current?.snapshot.revision).toBe(3);
 rev=1;await s.consume(event(2));await s.consume(event(4,'other'));expect(s.state.current?.snapshot.revision).toBe(3);
 await s.refresh();expect(s.state.current?.snapshot.revision).toBe(3);s.close();
});
test('missing new artifact leaves old complete revision with explicit error; old assets disposed only after history released',async()=>{
 let rev=1,fail=false;const a=asset(),b=asset();const s=new WorkspaceStore('doc',{snapshot:async()=>snapshot(rev),asset:async()=>{if(fail)throw new Error('Artifact missing');return rev===1?a:b;}});
 await s.refresh();rev=2;fail=true;await s.refresh();expect(s.state.current?.snapshot.revision).toBe(1);expect(s.state.error).toMatch(/Artifact missing/);expect(a.disposed).toBe(false);
 fail=false;await s.refresh();expect(s.state.previous?.asset).toBe(a);expect(s.state.current?.asset).toBe(b);s.close();expect(a.disposed).toBe(true);expect(b.disposed).toBe(true);
});
test('a future or corrupt event cursor cannot permanently freeze snapshot recovery',async()=>{
 let rev=1;const s=new WorkspaceStore('doc',{snapshot:async()=>snapshot(rev),asset:async()=>asset()});await s.refresh();
 await s.consume({seq:999,documentId:'doc',jobId:null,type:'committed',revision:999,candidateId:'c',data:{}});
 rev=2;await s.consume({seq:2,documentId:'doc',jobId:null,type:'committed',revision:2,candidateId:'c2',data:{}});
 expect(s.state.current?.snapshot.revision).toBe(2);s.close();
});
