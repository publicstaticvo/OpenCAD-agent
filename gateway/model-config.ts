import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync,chmodSync,lstatSync,readdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {parse} from 'yaml';
import {StoreError} from './revision-store.ts';
import {evaluationProvider} from './eval-provider.mjs';
import {runTextJob,type TextRunner} from './agent.ts';
import {probeProvider} from './model-probe.ts';
import {timeoutSettings,type TimeoutSettings} from './timeouts.ts';
import {modelFetch} from './model-http.mjs';

type ModelEntry={id:string;[key:string]:unknown};
export interface ModelLimits {contextWindow:number;maxTokens:number;contextSource:string;outputSource:string}
export type ModelProtocol='openai-completions'|'openai-responses';
interface Settings {version:3;apiKey:string;provider:ModelLimits&{protocol:ModelProtocol;baseUrl:string;model:string};timeouts:TimeoutSettings;configuredAt:string}
type ConfigInput={baseUrl:unknown;apiKey?:unknown;model:unknown;protocol?:unknown;timeouts?:unknown};
export function modelProtocol(value:unknown):ModelProtocol{if(value===undefined)return'openai-completions';if(value==='openai-completions'||value==='openai-responses')return value;throw new StoreError('invalid','不支持的 API 协议');}
export function normalizeBaseUrl(value:unknown):string{
 if(typeof value!=='string'||!value.trim())throw new StoreError('invalid','请填写模型服务地址');
 let url:URL;try{url=new URL(value.trim());}catch{throw new StoreError('invalid','模型服务地址无效');}
 if(url.username||url.password||url.search||url.hash||!['https:','http:'].includes(url.protocol))throw new StoreError('invalid','模型服务地址不能包含凭据、查询参数或片段');
 if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new StoreError('invalid','远程模型服务需要 HTTPS；本机服务可使用 HTTP');
 url.pathname=url.pathname.replace(/\/+$/,'')||'/v1';
 return url.toString().replace(/\/$/,'');
}
function positive(value:unknown,name:string){if(!Number.isSafeInteger(value)||(value as number)<1)throw new StoreError('invalid',`模型服务返回的 ${name} 无效`);return value as number;}
function metadata(entry:ModelEntry,fields:string[]){
 const limits=entry.limits&&typeof entry.limits==='object'?entry.limits as Record<string,unknown>:{};
 const topProvider=entry.top_provider&&typeof entry.top_provider==='object'?entry.top_provider as Record<string,unknown>:{};
 for(const key of fields)for(const item of [entry,limits,topProvider])if(item[key]!==undefined&&item[key]!==null)return positive(item[key],key);
 return undefined;
}
/** Pi's shipped catalog, when present, is scoped to the exact endpoint and model ID. */
function catalogModel(baseUrl:string,id:string):ModelEntry|undefined{
 const dir=new URL('../pi/packages/ai/src/providers/data/',import.meta.url);
 if(!existsSync(dir))return undefined;
 for(const name of readdirSync(dir).filter(n=>n.endsWith('.json')&&n!=='manifest.json')){
  const groups=JSON.parse(readFileSync(new URL(name,dir),'utf8'));
  for(const group of Object.values(groups))if(group&&typeof group==='object')for(const model of Object.values(group)){
   const item=model as ModelEntry;
   if(item.type==='chat'&&item.id===id&&typeof item.baseUrl==='string'&&normalizeBaseUrl(item.baseUrl)===baseUrl)return item;
  }
 }
 return undefined;
}
export function resolveModelLimits(entry:ModelEntry,baseUrl?:string):ModelLimits{
 const catalog=baseUrl?catalogModel(baseUrl,entry.id):undefined;
 const context=metadata(entry,['contextWindow','context_length','context_window','max_model_len','max_context_length']);
 const output=metadata(entry,['maxTokens','max_output_tokens','max_completion_tokens','max_output_length']);
 const contextWindow=context??(catalog?.contextWindow as number|undefined)??262144;
 const maxTokens=output??(catalog?.maxTokens as number|undefined)??Math.min(16384,Math.max(1,contextWindow-4096));
 return{contextWindow,maxTokens,contextSource:context?'service':catalog?'pi-catalog':'default-256k',outputSource:output?'service':catalog?'pi-catalog':'pi-custom-default'};
}
export function readModelYaml(path:string){
 const value=parse(readFileSync(path,'utf8'));
 const data=value?.test_llm??value;
 if(!data||typeof data.model!=='string'||!data.model.trim()||typeof data.api_key!=='string'||!data.api_key.trim())throw new Error('模型 YAML 需要 base_url、api_key、model');
 return{baseUrl:normalizeBaseUrl(data.base_url),apiKey:data.api_key.trim(),model:data.model.trim(),protocol:modelProtocol(data.protocol),...(data.timeouts===undefined?{}:{timeouts:timeoutSettings(data.timeouts)})};
}
export class ModelConfig{
 private current:Settings|undefined;
 private saving=false;
 readonly runner:TextRunner;
 constructor(readonly dataDir:string){
  mkdirSync(dataDir,{recursive:true,mode:0o700});
  const path=join(dataDir,'model-settings.json');
  if(existsSync(path)){
   if(lstatSync(path).isSymbolicLink())throw new Error('Unsafe model-settings path');
   const settings=JSON.parse(readFileSync(path,'utf8'));
   if(![1,2,3].includes(settings.version)||typeof settings.apiKey!=='string'||!settings.apiKey.trim()||typeof settings.provider?.model!=='string'||!settings.provider.model.trim()||!settings.configuredAt)throw new Error('Invalid persisted model settings');
   settings.timeouts=timeoutSettings(settings.version===3?settings.timeouts:undefined);
   settings.provider.protocol=modelProtocol(settings.provider.protocol);
   if(normalizeBaseUrl(settings.provider.baseUrl)!==settings.provider.baseUrl)throw new Error('Invalid persisted model URL');
   positive(settings.provider.contextWindow,'contextWindow');positive(settings.provider.maxTokens,'maxTokens');
   if(!['service','pi-catalog','default-256k'].includes(settings.provider.contextSource)||!['service','pi-catalog','pi-custom-default'].includes(settings.provider.outputSource))throw new Error('Invalid persisted model limit sources');
   if(settings.version!==3){settings.version=3;this.write('model-settings.json',settings);}
   chmodSync(path,0o600);this.current=settings;
   // Settings are authoritative; repair the public derivative after an interrupted save.
   this.writeApproval(settings);
  }else{
   const approval=join(dataDir,'approved.json');
   if(existsSync(approval)){if(lstatSync(approval).isSymbolicLink())throw new Error('Unsafe model approval path');unlinkSync(approval);}
  }
  this.runner=Object.assign((job:Parameters<TextRunner>[0],session:Parameters<TextRunner>[1],signal:AbortSignal)=>runTextJob(job,session,signal,this.provider()),{mode:'live' as const,timeouts:()=>this.timeouts()});
 }
 timeouts(){return {...(this.current?.timeouts??timeoutSettings())};}
 status(){return this.current?{configured:true,provider:{...this.current.provider},timeouts:this.timeouts(),configuredAt:this.current.configuredAt,pricing:null}:{configured:false,timeouts:this.timeouts()};}
 private credentials(input:{baseUrl:unknown;apiKey?:unknown}){
  const baseUrl=normalizeBaseUrl(input.baseUrl);
  const apiKey=typeof input.apiKey==='string'&&input.apiKey.trim()?input.apiKey.trim():this.current?.provider.baseUrl===baseUrl?this.current.apiKey:undefined;
  if(!apiKey||apiKey.length>8192||/[\r\n]/.test(apiKey))throw new StoreError('invalid','请填写该模型服务的 API key');
  return{baseUrl,apiKey};
 }
 async discover(input:{baseUrl:unknown;apiKey?:unknown;protocol?:unknown;timeouts?:unknown}){
  modelProtocol(input.protocol);
  const timeouts=timeoutSettings(input.timeouts??this.current?.timeouts);
  const {baseUrl,apiKey}=this.credentials(input);
  let response:Response;
  try{response=await modelFetch(baseUrl+'/models',{headers:{Authorization:`Bearer ${apiKey}`},redirect:'error',...(timeouts.requestSeconds>0?{signal:AbortSignal.timeout(timeouts.requestSeconds*1000)}:{})});}catch{throw new StoreError('unavailable','无法连接模型服务，请检查地址、网络、证书和请求超时设置');}
  if(!response.ok){await response.body?.cancel();throw new StoreError('invalid',`模型列表请求失败（HTTP ${response.status}），请检查地址和 API key`);}
  let payload:any;try{payload=await response.json();}catch{throw new StoreError('invalid','模型服务没有返回有效 JSON');}
  if(!Array.isArray(payload.data)||payload.data.length===0||payload.data.length>10000||payload.data.some((m:any)=>typeof m?.id!=='string'||!m.id.trim()||m.id.length>256))throw new StoreError('invalid','模型服务没有返回有效的模型列表');
  return {baseUrl,models:payload.data.map((m:ModelEntry)=>({id:m.id,...resolveModelLimits(m,baseUrl)})) as (ModelLimits&{id:string})[]};
 }
 private async resolve(input:ConfigInput){
  const {baseUrl,apiKey}=this.credentials(input),protocol=modelProtocol(input.protocol);
  const timeouts=timeoutSettings(input.timeouts??this.current?.timeouts);
  if(typeof input.model!=='string'||!input.model.trim()||input.model.trim().length>256)throw new StoreError('invalid','请填写模型 ID');
  let limits=resolveModelLimits({id:input.model.trim()},baseUrl);
  try{const found=(await this.discover({baseUrl,apiKey,protocol,timeouts})).models.find(m=>m.id===input.model!.toString().trim());if(found){const{id,...available}=found;limits=available;}}catch(error){if(!(error instanceof StoreError)||!['invalid','unavailable'].includes(error.code))throw error;}
  return{apiKey,provider:{protocol,baseUrl,model:input.model.trim(),...limits},timeouts};
 }
 async probe(input:ConfigInput){const settings=await this.resolve(input);return probeProvider(evaluationProvider({provider:settings.provider},settings.apiKey,undefined,{timeouts:settings.timeouts}),this.dataDir,settings.timeouts);}
 async save(input:ConfigInput){
  if(this.saving)throw new StoreError('busy','模型配置正在保存，请稍后重试');
  this.saving=true;
  try{
   const resolved=await this.resolve(input);
   const probe=await probeProvider(evaluationProvider({provider:resolved.provider},resolved.apiKey,undefined,{timeouts:resolved.timeouts}),this.dataDir,resolved.timeouts);
   if(!probe.textStreaming||!probe.toolCalling)throw new StoreError('invalid',probe.message??'模型协议验证失败');
   const settings:Settings={version:3,...resolved,configuredAt:new Date().toISOString()};
   const previous=this.current;
   this.write('model-settings.json',settings);this.current=settings;
   try{this.writeApproval(settings);}catch(error){
    this.current=previous;
    if(previous)this.write('model-settings.json',previous);else unlinkSync(join(this.dataDir,'model-settings.json'));
    throw error;
   }
   return this.status();
  }finally{this.saving=false;}
 }
 private publicSettings(settings:Settings){return{provider:settings.provider,timeouts:settings.timeouts,configuredAt:settings.configuredAt,pricing:null};}
 private writeApproval(settings:Settings){this.write('approved.json',{version:1,approved:true,...this.publicSettings(settings),dataScope:'text-and-structured-cad-summary-only'});}
 private write(name:string,value:unknown){
  const path=join(this.dataDir,name),pending=path+'.pending';
  if(existsSync(path)&&lstatSync(path).isSymbolicLink()||existsSync(pending)&&lstatSync(pending).isSymbolicLink())throw new Error('Unsafe model configuration path');
  writeFileSync(pending,JSON.stringify(value,null,2)+'\n',{mode:0o600});chmodSync(pending,0o600);renameSync(pending,path);
 }
 provider(){
  if(!this.current)throw new StoreError('unavailable','请先配置模型服务');
  return evaluationProvider({provider:this.current.provider},this.current.apiKey,undefined,{timeouts:this.current.timeouts});
 }
}
