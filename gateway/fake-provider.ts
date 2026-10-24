/** Explicit offline orchestration fixture. This is NOT a natural-language CAD model. */
import type {Job} from './supervisor.ts';
import {runTextJob,type TextRunner,type Turn,type CadSession} from './agent.ts';import {makeFauxProvider} from './pi-adapter.mjs';
import plate from '../tests/fixtures/models/plate.json';import ring from '../tests/fixtures/models/ring.json';import step from '../tests/fixtures/models/step.json';
export function fixtureTextRunner():TextRunner{
 const runner=async(job:Job,session:CadSession,signal:AbortSignal)=>{
  const snapshot=await session.snapshot(),text=job.request.text as string,numbers=(text.match(/-?\d+(?:\.\d+)?/g)??[]).map(Number);
  let operations:any[]|undefined,criteria:any;
  const has=(...values:number[])=>values.every(v=>numbers.includes(v));
  if(snapshot.revision===0){
   const sample=/(孔板|plate)/i.test(text)&&has(80,60,10,6,20,15)?plate:/(垫套|ring)/i.test(text)&&has(20,10)?ring:/(台阶|step)/i.test(text)&&has(40,30,10,20)?step:undefined;
   if(sample){operations=sample.operations;criteria=sample.criteria;}
  }else{
   let target:string|undefined,parameter:string|undefined,value:number|undefined;
   const explicit=text.match(/修改\s+([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\s*(?:为|=)\s*(-?\d+(?:\.\d+)?)/);
   if(explicit){[,target,parameter]=explicit;value=Number(explicit[3]);}
   else{
    const hole=text.match(/(?:孔径|直径|diameter)\D{0,12}?(-?\d+(?:\.\d+)?)/i);
    const inner=text.match(/内径\D{0,12}?(-?\d+(?:\.\d+)?)/);
    const upper=text.match(/(?:上层高度|台阶高度)\D{0,12}?(-?\d+(?:\.\d+)?)/);
    if(hole){target='hole';parameter='diameter';value=Number(hole[1]);}
    else if(inner){target='ring';parameter='diameter1';value=Number(inner[1]);}
    else if(upper){target='upper_pad';parameter='Length';value=Number(upper[1]);}
   }
   const params:Record<string,Record<string,number>>=Object.fromEntries(snapshot.tree.map((f:any)=>[f.id,{...f.parameters}]));
   if(target&&parameter&&value!==undefined&&Number.isFinite(value)&&value>0&&value<=1e6&&params[target]&&Object.hasOwn(params[target],parameter)){
    params[target][parameter]=value;
    const p=(id:string,key:string)=>params[id]?.[key];
    if(params.hole){const w=p('base','width'),h=p('base','height'),l=p('pad','Length'),d=p('hole','diameter');criteria={bbox:[w,h,l],volume:w*h*l-Math.PI*d*d/4*p('pocket','Length')};}
    else if(params.ring){const a=p('ring','diameter0'),b=p('ring','diameter1'),l=p('pad','Length');criteria={bbox:[a,a,l],volume:Math.PI*(a*a-b*b)/4*l};}
    else if(params.upper_pad){const w=p('base','width'),h=p('base','height'),l=p('pad','Length'),uw=p('upper','width'),uh=p('upper','height'),ul=p('upper_pad','Length');criteria={bbox:[Math.max(w,uw),Math.max(h,uh),Math.max(l,10+ul)],volume:w*h*l+uw*uh*ul};}
    if(criteria&&criteria.volume>0){criteria.parameters=[{feature:target,parameter,value}];operations=[{op:'set_parameter',feature:target,parameter,value}];}
   }
  }
  const turns:Turn[]=operations?[{calls:[{name:'cad_inspect',args:{}}]},{calls:[{name:'cad_apply',args:{operations}}]},{calls:[{name:'cad_inspect',args:{}}]},{calls:[{name:'cad_finish',args:{criteria}}]},{text:'离线样例工具流程结束。正式版本以 Gateway 持久化结果为准；这不是实际模型能力评测。'}]:[{text:'unsupported：离线 fake 仅支持明确尺寸的孔板、垫套、台阶块样例及其命名参数修改。请求缺少尺寸、超出支持范围或产生不可能的几何；正式模型未改变。未调用真实模型。'}];
  return runTextJob(job,session,signal,makeFauxProvider(turns));
 };
 return Object.assign(runner,{mode:'fake' as const});
}
