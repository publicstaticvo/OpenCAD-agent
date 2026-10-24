import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {OrbitControls} from 'three/addons/controls/OrbitControls.js';import type {ModelAsset} from './store.ts';
export async function loadModel(buffer:ArrayBuffer):Promise<ModelAsset>{
 const gltf=await new GLTFLoader().parseAsync(buffer,''),scene=gltf.scene;scene.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(scene);let triangles=0;
 const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
 scene.traverse(object=>{if(object instanceof THREE.Mesh){const g=object.geometry;triangles+=(g.index?.count??g.attributes.position.count)/3;geometries.add(g);for(const m of Array.isArray(object.material)?object.material:[object.material])materials.add(m);}});
 if(!triangles||box.isEmpty()){for(const g of geometries)g.dispose();for(const m of materials)m.dispose();throw new Error('GLB 未包含有效三角网格');}
 for(const m of materials)m.dispose();materials.clear();
 const bodyMaterial=new THREE.MeshStandardMaterial({color:0x688fa6,metalness:.15,roughness:.55,side:THREE.DoubleSide});materials.add(bodyMaterial);
 scene.traverse(object=>{if(object instanceof THREE.Mesh)object.material=bodyMaterial;});
 let disposed=false;
 return{scene,triangles,bounds:[box.min.toArray(),box.max.toArray()],dispose(){if(disposed)return;disposed=true;for(const g of geometries)g.dispose();for(const m of materials)m.dispose();}};
}
type View='iso'|'top';
class Viewport{
 readonly canvas:HTMLCanvasElement;private renderer:THREE.WebGLRenderer;private world=new THREE.Scene();private camera=new THREE.OrthographicCamera(-1,1,1,-1,.0001,100);private controls:OrbitControls;
 private observer:ResizeObserver;private frame=0;private model:THREE.Object3D|null=null;private center=new THREE.Vector3();private span=.124;private view:View='iso';private grid:THREE.GridHelper;private size=.08;
 constructor(private host:HTMLDivElement,onStats:(renderer:string)=>void,onSelect:()=>void){
  this.renderer=new THREE.WebGLRenderer({antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.setClearColor(0xf2f5f7);this.renderer.outputColorSpace=THREE.SRGBColorSpace;
  this.canvas=this.renderer.domElement;this.canvas.setAttribute('aria-label','三维模型');this.canvas.dataset.view=this.view;host.appendChild(this.canvas);
  this.controls=new OrbitControls(this.camera,this.canvas);this.controls.enableDamping=true;this.controls.dampingFactor=.1;
  this.world.add(new THREE.HemisphereLight(0xf5fbff,0x82919a,2.5));const sun=new THREE.DirectionalLight(0xffffff,3);sun.position.set(.08,.2,.1);this.world.add(sun);
  this.grid=new THREE.GridHelper(1,100,0xc0ccd3,0xdce4e9);this.grid.position.y=-.00005;this.world.add(this.grid);
  this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);this.resize();
  const gl=this.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');const renderer=ext?String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)):String(gl.getParameter(gl.RENDERER));onStats(`${gl.getParameter(gl.VERSION)} · ${renderer}`);
  this.canvas.onclick=event=>{if(!this.model)return;const rect=this.canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),this.camera);if(ray.intersectObject(this.model,true).length)onSelect();};
  const render=()=>{this.frame=requestAnimationFrame(render);this.controls.update();this.renderer.render(this.world,this.camera);};render();
 }
 setModel(asset:ModelAsset){if(this.model)this.world.remove(this.model);this.model=asset.scene;this.world.add(this.model);const box=new THREE.Box3().setFromObject(this.model);box.getCenter(this.center);this.size=Math.max(...box.getSize(new THREE.Vector3()).toArray());this.span=this.size*1.55;this.setView(this.view);this.resize();}
 setView(view:View){this.view=view;this.canvas.dataset.view=view;this.controls.target.copy(this.center);this.camera.up.set(0,view==='top'?0:1,view==='top'?-1:0);this.camera.position.copy(this.center).add(view==='top'?new THREE.Vector3(0,this.size*3,0):new THREE.Vector3(this.size*1.6,this.size*1.4,this.size*1.6));this.camera.lookAt(this.center);this.controls.update();}
 highlight(selected:boolean){this.model?.traverse(o=>{if(o instanceof THREE.Mesh){for(const m of Array.isArray(o.material)?o.material:[o.material])if(m instanceof THREE.MeshStandardMaterial){m.emissive.set(selected?0x007fa3:0);m.emissiveIntensity=selected?.22:0;}}});}
 private resize(){const w=Math.max(1,this.host.clientWidth),h=Math.max(1,this.host.clientHeight),aspect=w/h;this.camera.left=-this.span*aspect/2;this.camera.right=this.span*aspect/2;this.camera.top=this.span/2;this.camera.bottom=-this.span/2;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h);}
 dispose(){cancelAnimationFrame(this.frame);this.observer.disconnect();this.controls.dispose();this.canvas.onclick=null;if(this.model)this.world.remove(this.model);this.grid.geometry.dispose();for(const m of Array.isArray(this.grid.material)?this.grid.material:[this.grid.material])m.dispose();this.renderer.dispose();this.renderer.forceContextLoss();this.canvas.remove();}
}
export function Viewer({asset,selected,onSelect}:{asset:ModelAsset;selected:boolean;onSelect:()=>void}){
 const host=useRef<HTMLDivElement>(null),viewport=useRef<Viewport|null>(null),callback=useRef(onSelect);callback.current=onSelect;const [view,setView]=useState<View>('iso'),[renderer,setRenderer]=useState(''),[error,setError]=useState('');
 useEffect(()=>{try{viewport.current=new Viewport(host.current!,setRenderer,()=>callback.current());}catch(e){setError(`WebGL 初始化失败：${(e as Error).message}`);}return()=>{viewport.current?.dispose();viewport.current=null;};},[]);
 useEffect(()=>{viewport.current?.setModel(asset);},[asset]);useEffect(()=>{viewport.current?.setView(view);},[view]);useEffect(()=>viewport.current?.highlight(selected),[selected,asset]);
 return <div className="viewer"><div className="view-buttons"><button onClick={()=>setView('iso')} aria-pressed={view==='iso'}>立体</button><button onClick={()=>setView('top')} aria-pressed={view==='top'}>俯视</button></div><div ref={host} className="canvas-host"/>{error&&<p role="alert" className="viewer-error">{error}</p>}<div className="mesh-info" data-testid="mesh-stats" data-triangles={asset.triangles} data-bounds={JSON.stringify(asset.bounds)} title={renderer}>{renderer?'WebGL · ':''}{asset.triangles} 三角面</div><div className="axis-note">X →　Y ↗　Z ↑<span>模型尺寸以毫米显示</span></div></div>;
}
