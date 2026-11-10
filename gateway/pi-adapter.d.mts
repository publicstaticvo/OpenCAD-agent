export interface PiProvider {mode:string;model:unknown;streamFn:(...args:any[])=>any}
export const cadToolSchemas:Record<string,any>;
export const pythonToolSchemas:Record<string,any>;
export function pythonObservation(value:any,model:{input?:string[]}):{content:any[];details:Record<string,unknown>};
export function normalizeProbeContext(context:any):any;
export function selectHistory(messages:any[],budget:number):{messages:any[];included:number;omitted:number};
export function makeFauxProvider(turns:any[],options?:{tokensPerSecond?:number}):PiProvider;
export function runPiLoop(options:{task:string;ideContext?:import('../shared/ide-context.ts').AgentIDEContext;session:any;signal:AbortSignal;provider:PiProvider;maxToolCalls?:number;onProgress?:(value:any)=>void;onTranscript?:(value:any)=>void}):Promise<import('../shared/cad-contracts.ts').Criteria|undefined>;
export function operationPlanningRules():string;
