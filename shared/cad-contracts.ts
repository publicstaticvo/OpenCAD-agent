import contracts from './cad-schema.json';
type Schema = { $ref?:string; const?:unknown; enum?:unknown[]; oneOf?:Schema[]; type?:string; minimum?:number; exclusiveMinimum?:number; maximum?:number; pattern?:string; maxLength?:number; minItems?:number; maxItems?:number; items?:Schema; required?:string[]; properties?:Record<string,Schema>; additionalProperties?:boolean };
const registry = contracts as unknown as Record<string, Schema> & {definitions:Record<string,Schema>};
function check(schema: Schema, v: unknown): boolean {
  if (schema.$ref) return check(registry.definitions[schema.$ref] ?? registry[schema.$ref], v);
  if ('const' in schema && v !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(v)) return false;
  if (schema.oneOf && schema.oneOf.filter(s => check(s,v)).length !== 1) return false;
  if (schema.type === 'object') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    const obj = v as Record<string,unknown>;
    if ((schema.required ?? []).some(k => !Object.hasOwn(obj,k))) return false;
    for (const [k,value] of Object.entries(obj)) {
      if (!schema.properties?.[k]) { if (schema.additionalProperties === false) return false; }
      else if (!check(schema.properties[k],value)) return false;
    }
  }
  if (schema.type === 'array') {
    if (!Array.isArray(v) || v.length < (schema.minItems ?? 0) || v.length > (schema.maxItems ?? Infinity)) return false;
    if (schema.items && !v.every(x => check(schema.items!, x))) return false;
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof v !== 'number' || !Number.isFinite(v) || (schema.type === 'integer' && !Number.isSafeInteger(v))) return false;
    if (v < (schema.minimum ?? -Infinity) || v > (schema.maximum ?? Infinity) || (schema.exclusiveMinimum !== undefined && v <= schema.exclusiveMinimum)) return false;
  }
  if (schema.type === 'string' && (typeof v !== 'string' || v.length > (schema.maxLength ?? Infinity) || (schema.pattern && !new RegExp(schema.pattern).test(v)))) return false;
  return true;
}
function isJson(v: unknown): boolean {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isJson);
  return typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype && Object.values(v).every(isJson);
}
export function assertContract(kind: string, value: unknown): void {
  const schema = registry[kind];
  if (!schema || !isJson(value) || !check(schema,value)) throw new Error(`Invalid ${kind}: strict CAD schema`);
}
export const budgets = {maxToolCalls:20, taskMs:0, operationMs:0, startupMs:15000, frameBytes:1048576} as const;
export interface CadOperation { op:string; [key:string]:unknown }
export interface Criteria { bbox:[number,number,number]; volume:number; parameters?:{feature:string;parameter:string;value:number}[] }
export interface ModelProgram {operations:CadOperation[];criteria:Criteria}
export interface Envelope {documentId:string;baseRevision:number;operationId:string;candidateId:string}
export interface RpcRequest {jsonrpc:'2.0';id:string|number;method:string;params:Record<string,unknown>}
export type RpcResponse = {jsonrpc:'2.0';id:string|number;result:unknown} | {jsonrpc:'2.0';id:string|number;error:{code:number;message:string;data?:unknown}};
export interface Feature {id:string;label:string;type:string;parent:string|null;parameters:Record<string,number>;constraints?:Record<string,number>}
export interface CandidateResult {candidateId:string;manifest:Record<string,{sha256:string;bytes:number}>;tree:Feature[];validation:{volume:number;bbox:number[];solids:number}}
export interface AppEvent {seq:number;documentId:string;jobId:string|null;type:string;revision:number;candidateId:string|null;conversationId?:string|null;data:unknown}
export interface DocumentSnapshot {documentId:string;name?:string;conversations?:any[];progress?:AppEvent[];revision:number;lastSeq:number;tree:Feature[];artifacts:Record<string,string>;jobs:unknown[];validation?:any}
