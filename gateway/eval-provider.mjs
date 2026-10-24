/** Explicit evaluation-only transport; never wired into the product's automatic startup. */
import {streamSimple} from '../pi/packages/ai/src/api/openai-completions.ts';
export function evaluationProvider(authorization,apiKey,budget,{transport=globalThis.fetch}={}){
 if(typeof apiKey!=='string'||!apiKey.trim())throw new Error('Explicit CAD_EVAL_API_KEY required; personal Pi auth is never read');
 const p=authorization.provider,endpoint=p.baseUrl.replace(/\/$/,'')+'/chat/completions';
 const model={id:p.model,name:p.model,provider:'cad-evaluation',api:'openai-completions',baseUrl:p.baseUrl,reasoning:false,input:['text'],contextWindow:p.contextWindow,maxTokens:p.maxTokens,cost:{...p.ratesUsdPerMillion,cacheRead:0,cacheWrite:0},compat:{supportsDeveloperRole:false,supportsReasoningEffort:false,supportsStore:false}};
 const boundedFetch=async(input,init)=>{
  const request=new Request(input,init);
  if(request.url!==endpoint||request.method!=='POST')throw new Error('Unapproved provider endpoint');
  const body=await request.clone().json();
  if(!Array.isArray(body.messages)||body.messages.some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type!=='text')))throw new Error('Evaluation allows text and structured summaries only');
  if(body.max_tokens!==p.maxTokens&&body.max_completion_tokens!==p.maxTokens)throw new Error('Missing bounded output tokens');
  budget.sentRequests++;
  return transport(request,{redirect:'error'});
 };
 return{mode:'live',model,streamFn:(_model,context,options)=>streamSimple(model,context,{...options,apiKey,maxTokens:p.maxTokens,maxRetries:0,cacheRetention:'none',onPayload:()=>{budget.reserve();},fetch:boundedFetch})};
}
