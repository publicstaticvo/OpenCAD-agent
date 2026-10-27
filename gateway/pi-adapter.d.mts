export interface PiProvider {mode:string;model:unknown;streamFn:(...args:any[])=>any}
export const cadToolSchemas:Record<string,any>;
export function normalizeProbeContext(context:any):any;
export function selectHistory(messages:any[],budget:number):{messages:any[];included:number;omitted:number};
export function makeFauxProvider(turns:any[],options?:{tokensPerSecond?:number}):PiProvider;
export function runPiLoop(options:{task:string;session:any;signal:AbortSignal;provider:PiProvider;maxToolCalls?:number;onProgress?:(value:any)=>void;onTranscript?:(value:any)=>void}):Promise<import('../shared/cad-contracts.ts').Criteria|undefined>;
