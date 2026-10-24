export interface PiProvider {mode:string;model:unknown;streamFn:(...args:any[])=>any}
export function makeFauxProvider(turns:any[],options?:{tokensPerSecond?:number}):PiProvider;
export function runPiLoop(options:{task:string;session:any;signal:AbortSignal;provider:PiProvider;maxToolCalls?:number;onProgress?:(value:any)=>void;onTranscript?:(value:any)=>void}):Promise<import('../shared/cad-contracts.ts').Criteria>;
