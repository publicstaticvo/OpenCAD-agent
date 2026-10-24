import {makeFauxProvider,runPiLoop,type PiProvider} from './pi-adapter.mjs';
import type {Job} from './supervisor.ts';import type {Criteria} from '../shared/cad-contracts.ts';
export interface Turn{calls?:{name:string;args:any;id?:string}[];text?:string}
export interface CadSession{baseRevision:number;inspect():Promise<any>;apply(operations:unknown,stepId:string):Promise<any>;prepare(criteria:Criteria):Promise<any>;snapshot():Promise<any>;progress(event:any):void;transcript(report:any):void}
export type TextRunner=((job:Job,session:CadSession,signal:AbortSignal)=>Promise<Criteria>)&{mode:'fake'|'live'};
export async function runTextJob(job:Job,session:CadSession,signal:AbortSignal,provider:PiProvider,options:{maxToolCalls?:number}={}){
 return runPiLoop({task:job.request.text,session,signal,provider,...options,onProgress:session.progress,onTranscript:session.transcript});
}
export function scriptedTextRunner(turns:Turn[]|((job:Job)=>Turn[]),options:{maxToolCalls?:number;tokensPerSecond?:number}={}):TextRunner{
 const runner=(job:Job,session:CadSession,signal:AbortSignal)=>runTextJob(job,session,signal,makeFauxProvider(typeof turns==='function'?turns(job):turns,options),options);
 return Object.assign(runner,{mode:'fake' as const});
}
