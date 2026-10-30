import {makeFauxProvider,runPiLoop,type PiProvider} from './pi-adapter.mjs';
import type {Job} from './supervisor.ts';import type {Criteria} from '../shared/cad-contracts.ts';
export interface Turn{calls?:{name:string;args:any;id?:string}[];text?:string}
export interface CadSession{baseRevision:number;mode?:'planning'|'execution';plan?:import('./plan.ts').CadPlan;stages?:unknown;stage?:number;propose?(proposal:unknown):Promise<any>;history?:any[];inspect():Promise<any>;apply(operations:unknown,stepId:string):Promise<any>;prepare(criteria:Criteria):Promise<any>;snapshot():Promise<any>;progress(event:any):void;transcript(report:any):void}
export type TextRunner=((job:Job,session:CadSession,signal:AbortSignal)=>Promise<Criteria|undefined>)&{mode:'fake'|'live';timeouts?:()=>import('./timeouts.ts').TimeoutSettings};
export async function runTextJob(job:Job,session:CadSession,signal:AbortSignal,provider:PiProvider,options:{maxToolCalls?:number}={}){
 return runPiLoop({task:job.request.text,session,signal,provider,...options,onProgress:session.progress,onTranscript:session.transcript});
}
export function scriptedTextRunner(turns:Turn[]|((job:Job,session:CadSession)=>Turn[]),options:{maxToolCalls?:number;tokensPerSecond?:number;planningProgram?:import('../shared/cad-contracts.ts').ModelProgram}={}):TextRunner{
 const runner=async(job:Job,session:CadSession,signal:AbortSignal)=>{
  const script=typeof turns==='function'?turns(job,session):turns;
  const finish=script.flatMap(t=>t.calls??[]).find(c=>c.name==='cad_finish');
  if(session.mode==='planning'&&finish){
   const program=options.planningProgram??{operations:script.flatMap(t=>t.calls??[]).filter(c=>c.name==='cad_apply').flatMap(c=>c.args.operations),criteria:finish.args.criteria};
   await session.propose!({kind:'program',program});
   session.transcript({provider:'fake',toolCalls:0,blockedCalls:0,messages:[{role:'assistant',content:[{type:'text',text:'离线预定义操作程序，等待用户批准；未调用真实模型。'}],stopReason:'stop'}],usage:[]});
   return undefined;
  }
  return runTextJob(job,session,signal,makeFauxProvider(script,options),options);
 };
 return Object.assign(runner,{mode:'fake' as const});
}
