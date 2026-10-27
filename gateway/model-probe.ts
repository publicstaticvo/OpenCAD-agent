import type {PiProvider} from './pi-adapter.mjs';
import {cadToolSchemas,normalizeProbeContext} from './pi-adapter.mjs';
import {WorkerClient} from './worker-client.ts';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {defaultTimeouts,type TimeoutSettings} from './timeouts.ts';

/** Sends only a text check and an isolated empty-document inspection. */
export async function probeProvider(provider:PiProvider,root:string,timeouts:TimeoutSettings=defaultTimeouts){
 const model=provider.model as any;
 let phase='text_stream';let textStreaming=false,toolCalling=false;
 let worker:WorkerClient|undefined,directory:string|undefined;
 const invoke=async(messages:any[],tools?:any[])=>{
  const stream=provider.streamFn(model,normalizeProbeContext({systemPrompt:'Follow the user instructions exactly. This is a protocol connectivity check.',messages,...(tools?{tools}:{})}),{});
  let deltas=0;for await(const event of stream){if(event.type==='text_delta')deltas++;}
  const message=await stream.result();
  if(message.stopReason==='error'||message.stopReason==='aborted')throw new Error(message.errorMessage??'模型流式响应失败');
  return{message,deltas};
 };
 try{
  const first=await invoke([{role:'user',content:'Reply with the single word OK.',timestamp:Date.now()}]);
  textStreaming=first.deltas>0&&first.message.content.some((c:any)=>c.type==='text'&&c.text.trim());
  if(!textStreaming)throw new Error('模型未提供可见文本增量');
  phase='cad_inspect';directory=mkdtempSync(join(root,'protocol-probe-'));
  worker=await WorkerClient.start({workspace:directory,operationMs:timeouts.cadSeconds*1000});
  const candidateId=randomUUID();mkdirSync(join(directory,candidateId));
  await worker.request('begin_candidate',{envelope:{documentId:'protocol-probe',operationId:randomUUID(),candidateId,baseRevision:0}});
  phase='tool_call';
  const messages:any[]=[{role:'user',content:'Call cad_inspect once to inspect the empty CAD document. Do not answer until the tool result arrives.',timestamp:Date.now()}];
  const tool={name:'cad_inspect',description:'Inspect the isolated empty CAD document.',parameters:cadToolSchemas.cad_inspect};
  const response=await invoke(messages,[tool]);
  const calls=response.message.content.filter((c:any)=>c.type==='toolCall');
  if(calls.length!==1||calls[0].name!=='cad_inspect'||!calls[0].arguments||Object.keys(calls[0].arguments).length)throw new Error('probe_invalid_tool_call');
  phase='tool_result';
  const inspected=await worker.request('inspect_document',{});
  const completed=await invoke([...messages,response.message,{role:'toolResult',toolCallId:calls[0].id,toolName:'cad_inspect',content:[{type:'text',text:JSON.stringify(inspected)}],isError:false,timestamp:Date.now()}],[tool]);
  if(completed.message.stopReason!=='stop'||!completed.message.content.some((c:any)=>c.type==='text'&&c.text.trim()))throw new Error('模型未完成工具结果往返');
  toolCalling=true;
  return{protocol:model.api,phase:'complete',textStreaming,toolCalling,errorCode:null,message:null};
 }catch(error){
  // Provider HTTP errors contain only protocol/status; never expose a server body.
  const detail=String((error as Error).message),http=detail.match(/HTTP \d{3}/)?.[0];
  const timeout=/abort|timeout|timed out/i.test(detail);
  const missingTool=detail==='probe_invalid_tool_call';
  return{protocol:model.api,phase,textStreaming,toolCalling,errorCode:http?'model_http_error':timeout?'model_timeout':missingTool?'invalid_tool_call':'protocol_probe_failed',message:http?`${model.api} ${phase} ${http}`:timeout?`${model.api} ${phase}：请求终止或超时（配置 ${timeouts.requestSeconds} 秒，0 表示无限制）`:missingTool?`${model.api} ${phase}：服务未返回有效的 cad_inspect 工具调用`:`${model.api} ${phase}：协议或工具能力验证失败`};
 }finally{await worker?.close();if(directory)rmSync(directory,{recursive:true,force:true});}
}
