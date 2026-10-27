import {mkdtempSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {readModelYaml,ModelConfig} from '../gateway/model-config.ts';
import {evaluationProvider} from '../gateway/eval-provider.mjs';
import {probeProvider} from '../gateway/model-probe.ts';
import {_iterSSEMessages} from 'openai/core/streaming';
const input=readModelYaml(resolve(process.argv[2]??'advanced-model.yaml'));
const config=new ModelConfig(mkdtempSync(resolve('.work/protocol-probe-')));
for(const protocol of ['openai-completions','openai-responses'] as const){
 const traces:any[]=[],captures:Promise<void>[]=[];
 const transport=async(request:Request)=>{
  const entry:any={startedAt:new Date().toISOString(),request:await request.clone().json(),events:[]};traces.push(entry);
  let response:Response;try{response=await fetch(request,{redirect:'error'});}catch(error){entry.error=(error as Error).message;entry.finishedAt=new Date().toISOString();throw error;}entry.status=response.status;
  if(response.ok){const copy=response.clone();captures.push((async()=>{try{for await(const event of _iterSSEMessages(copy,new AbortController()))if(event.data&&event.data!=='[DONE]')entry.events.push(JSON.parse(event.data));}catch{entry.streamClosed=true;}})());}
  return response;
 };
 const provider=evaluationProvider({provider:{...input,protocol,contextWindow:262144,maxTokens:16384}},input.apiKey,undefined,{transport});
 const result=await probeProvider(provider,config.dataDir);await Promise.all(captures);
 writeFileSync(resolve(config.dataDir,protocol+'-trace.json'),JSON.stringify(traces).split(input.apiKey).join('[REDACTED]'),{mode:0o600});
 writeFileSync(resolve(config.dataDir,protocol+'.json'),JSON.stringify(result,null,2),{mode:0o600});
 console.log(JSON.stringify(result));
}
