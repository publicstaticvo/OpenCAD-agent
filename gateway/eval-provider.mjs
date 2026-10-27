/** Pi transport shared by the workspace and explicit model evaluations. */
import {streamSimple as chatStream} from '../pi/packages/ai/src/api/openai-completions.ts';
import {streamSimple as responsesStream} from '../pi/packages/ai/src/api/openai-responses.ts';
import {modelFetch} from './model-http.mjs';
export function evaluationProvider(authorization,apiKey,budget,{transport=modelFetch,timeouts={requestSeconds:0}}={}){
 if(typeof apiKey!=='string'||!apiKey.trim())throw new Error('Model API key required');
 const p=authorization.provider,protocol=p.protocol??'openai-completions';
 if(!['openai-completions','openai-responses'].includes(protocol))throw new Error('Unsupported model protocol');
 const endpoint=p.baseUrl.replace(/\/$/,'')+(protocol==='openai-responses'?'/responses':'/chat/completions');
 // Pi requires numeric cost fields; these zero placeholders are never reported as a price.
 const model={id:p.model,name:p.model,provider:'cad-configured',api:protocol,baseUrl:p.baseUrl,reasoning:false,input:['text'],contextWindow:p.contextWindow,maxTokens:p.maxTokens,cost:{input:0,output:0,...p.ratesUsdPerMillion,cacheRead:0,cacheWrite:0},compat:{supportsDeveloperRole:false,supportsReasoningEffort:false,supportsStore:false,maxTokensField:'max_tokens'}};
 const boundedFetch=async(input,init)=>{
  const request=new Request(input,init);
  if(request.url!==endpoint||request.method!=='POST')throw new Error('Unapproved provider endpoint');
  const body=await request.clone().json();
  if(protocol==='openai-completions'&&(!Array.isArray(body.messages)||body.messages.some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type!=='text'))))throw new Error('Evaluation allows text and structured summaries only');
  if(protocol==='openai-responses'&&(!Array.isArray(body.input)||body.input.some(m=>Array.isArray(m.content)&&m.content.some(c=>!['input_text','output_text'].includes(c.type)))))throw new Error('Evaluation allows text and structured summaries only');
  const limit=body.max_output_tokens??body.max_tokens??body.max_completion_tokens;
  if(!Number.isSafeInteger(limit)||limit<1||limit>p.maxTokens)throw new Error('Missing bounded output tokens');
  if(budget)budget.sentRequests++;
  const response=await transport(request,{redirect:'error'});
  if(!response.ok){await response.body?.cancel();throw new Error(`${protocol} model_request HTTP ${response.status}`);}
  return response;
 };
 const streamSimple=protocol==='openai-responses'?responsesStream:chatStream;
 return{mode:'live',model,streamFn:(_model,context,options={})=>{
  const deadline=timeouts.requestSeconds>0?AbortSignal.timeout(timeouts.requestSeconds*1000):undefined;
  const signal=deadline?(options.signal?AbortSignal.any([options.signal,deadline]):deadline):options.signal;
  return streamSimple(model,context,{...options,signal,timeoutMs:0,apiKey,maxTokens:p.maxTokens,maxRetries:0,cacheRetention:'none',onPayload:()=>{budget?.reserve();},fetch:boundedFetch});
 }};
}
