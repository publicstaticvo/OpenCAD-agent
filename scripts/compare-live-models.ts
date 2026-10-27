import {mkdirSync,writeFileSync} from 'node:fs';
import {basename,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createGateway} from '../gateway/server.ts';
import {ModelConfig,readModelYaml} from '../gateway/model-config.ts';
import {runTextJob} from '../gateway/agent.ts';
import {evaluationProvider} from '../gateway/eval-provider.mjs';
import {_iterSSEMessages} from 'openai/core/streaming';

const prompt=process.env.CAD_COMPARE_PROMPT??'创建一个长方体，长度为 40 mm，宽度为 30 mm，高度为 10 mm。只需要一个实体，不要添加倒角、圆角或其他特征。完成后确认模型有效，并检查三个尺寸是否准确。';
const accessToken='local-live-model-compare-token-0123456789';
const outputRoot=resolve(process.env.CAD_COMPARE_OUTPUT??'.work/model-compare');
const files=process.argv.slice(2);
if(!files.length)throw new Error('Usage: tsx scripts/compare-live-models.ts model.yaml advanced-model.yaml');

mkdirSync(outputRoot,{recursive:true,mode:0o700});
for(const file of files){
 const input=readModelYaml(resolve(file));
 const label=basename(file,'.yaml');
 const outputDir=resolve(outputRoot,label);
 mkdirSync(outputDir,{recursive:true,mode:0o700});
 const config=new ModelConfig(resolve(outputDir,'data'));
 const saved=await config.save(input);
 const providerInfo=saved.provider;
 const requests:any[]=[],responses:any[]=[],httpResponses:any[]=[];
 const captures:Promise<void>[]=[];
 const transport=async(request:Request)=>{
  const body=await request.clone().json();
  requests.push({url:new URL(request.url).origin+new URL(request.url).pathname,method:request.method,body});
  const response=await fetch(request,{redirect:'error'});
  httpResponses.push({requestIndex:requests.length-1,status:response.status,contentType:response.headers.get('content-type')});
  const copy=response.clone();
  captures.push((async()=>{
   if(!response.ok){responses.push({httpError:await copy.text()});return;}
   for await(const event of _iterSSEMessages(copy,new AbortController())){
    if(event.data&&event.data!=='[DONE]')responses.push(JSON.parse(event.data));
   }
  })());
  return response;
 };
 const provider=evaluationProvider({provider:providerInfo},input.apiKey,undefined,{transport});
 const runner=Object.assign((job:any,session:any,signal:AbortSignal)=>runTextJob(job,session,signal,provider),{mode:'live' as const});
 const gateway=await createGateway({textRunner:runner,dataDir:resolve(outputDir,'gateway-data'),accessToken,port:0,host:'127.0.0.1'});
 try{
  const documentId='compare';gateway.store.createDocument(documentId);
  const operationId=randomUUID();gateway.supervisor.submitText(documentId,0,operationId,prompt);
  const job=await gateway.supervisor.waitForJob(documentId,operationId);
  await Promise.all(captures);
  const events=gateway.store.events(documentId,0);
  const toolNames=(job.agent?.messages??[]).filter((m:any)=>m.role==='assistant').flatMap((m:any)=>m.content.filter((c:any)=>c.type==='toolCall').map((c:any)=>c.name));
  const finishIndex=toolNames.lastIndexOf('cad_finish'),postFinishTools=finishIndex<0?[]:toolNames.slice(finishIndex+1);
  await gateway.close();
  const reopened=await createGateway({textRunner:runner,dataDir:resolve(outputDir,'gateway-data'),accessToken,port:0,host:'127.0.0.1'});
  let restoredStatus:string,restoredRevision:number;
  try{restoredStatus=reopened.supervisor.job(documentId,operationId).status;restoredRevision=reopened.store.snapshot(documentId).revision;}finally{await reopened.close();}
  const revision=restoredRevision;
  const report={file:label,endpoint:new URL(providerInfo.baseUrl).origin+new URL(providerInfo.baseUrl).pathname,model:providerInfo.model,protocol:providerInfo.protocol,prompt,status:job.status,error:job.error,revision,restoredStatus,restoredRevision,toolNames,postFinishTools,agent:job.agent??null,events,requests,httpResponses,responses};
  const serialized=JSON.stringify(report,(key,value)=>typeof value==='string'&&input.apiKey?value.split(input.apiKey).join('[REDACTED]'):value,null,2)+'\n';
  writeFileSync(resolve(outputDir,'trace.json'),serialized,{flag:'w',mode:0o600});
  const expectedStatus=process.env.CAD_COMPARE_EXPECT_STATUS;
  const requireTerminalFinish=process.env.CAD_COMPARE_REQUIRE_TERMINAL_FINISH==='1';
  console.log(JSON.stringify({file:label,model:providerInfo.model,protocol:providerInfo.protocol,status:job.status,revision,restoredStatus,toolCalls:job.agent?.toolCalls??0,toolNames,postFinishTools,blockedCalls:job.agent?.blockedCalls??0,error:job.error,requestCount:requests.length,responseEventCount:responses.length,trace:resolve(outputDir,'trace.json')}));
  if(expectedStatus&&job.status!==expectedStatus||requireTerminalFinish&&postFinishTools.length||restoredStatus!==job.status)process.exitCode=1;
 }finally{await gateway.close();}
}
