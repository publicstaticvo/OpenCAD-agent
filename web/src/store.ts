import type {Object3D} from 'three';import type {DocumentSnapshot,AppEvent} from '../../shared/cad-contracts.ts';
export interface ModelAsset{scene:Object3D;triangles:number;bounds:number[][];dispose():void}
export interface LoadedRevision{snapshot:DocumentSnapshot;asset:ModelAsset|null}
export interface WorkspaceApi{snapshot(signal?:AbortSignal):Promise<DocumentSnapshot>;asset(url:string,revision:number,signal?:AbortSignal):Promise<ModelAsset>;watch?(after:()=>number,onEvent:(e:AppEvent)=>void,onConnection:(connected:boolean)=>void):()=>void}
export interface WorkspaceState{current:LoadedRevision|null;previous:LoadedRevision|null;error:string|null;pendingRevision:number|null;connected:boolean;jobs:unknown[];progress:AppEvent[]}
export class WorkspaceStore{
 state:WorkspaceState={current:null,previous:null,error:null,pendingRevision:null,connected:false,jobs:[],progress:[]};
 private generation=0;private lastSeq=0;private closed=false;private listeners=new Set<()=>void>();private disconnect?:()=>void;
 private request?:AbortController;
 constructor(readonly documentId:string,private api:WorkspaceApi){}
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
 getState=()=>this.state;
 private update(patch:Partial<WorkspaceState>){if(this.closed)return;this.state={...this.state,...patch};for(const notify of this.listeners)notify();}
 async start(){await this.refresh();if(!this.closed)this.disconnect=this.api.watch?.(()=>this.lastSeq,event=>{void this.consume(event);},connected=>{this.update({connected});if(connected)void this.refresh();});}
 async refresh(){
  if(this.closed)return;const generation=++this.generation;this.request?.abort();const request=this.request=new AbortController();
  try{
   const snapshot=await this.api.snapshot(request.signal);
   if(this.closed||generation!==this.generation||snapshot.documentId!==this.documentId||snapshot.lastSeq<this.lastSeq||snapshot.revision<(this.state.current?.snapshot.revision??0))return;
   this.lastSeq=snapshot.lastSeq;this.update({jobs:snapshot.jobs,progress:snapshot.progress??[],error:null});
   if(snapshot.revision===this.state.current?.snapshot.revision){this.update({current:{...this.state.current,snapshot},pendingRevision:null});return;}
   this.update({pendingRevision:snapshot.revision});
   const url=snapshot.artifacts['preview.glb'];
   if(snapshot.revision&&!url)throw new Error(`正式版本 ${snapshot.revision} 缺少预览文件`);
   const asset=snapshot.revision?await this.api.asset(url,snapshot.revision,request.signal):null;
   if(this.closed||generation!==this.generation){asset?.dispose();return;}
   this.state.previous?.asset?.dispose();
   this.update({previous:this.state.current,current:{snapshot,asset},pendingRevision:null,error:null});
  }catch(e){if(!this.closed&&generation===this.generation)this.update({pendingRevision:null,error:(e as Error).message});}
 }
 async consume(event:AppEvent){
  if(this.closed||event.documentId!==this.documentId||!Number.isSafeInteger(event.seq)||event.seq<=this.lastSeq)return;
  if(event.seq===this.lastSeq+1&&['agent_progress','cad_progress'].includes(event.type)){
   this.lastSeq=event.seq;const progress=[...this.state.progress,event].slice(-500);this.update({progress});return;
  }
  await this.refresh();
 }
 close(){if(this.closed)return;this.closed=true;this.generation++;this.request?.abort();this.disconnect?.();for(const asset of new Set([this.state.current?.asset,this.state.previous?.asset]))asset?.dispose();this.listeners.clear();}
}
