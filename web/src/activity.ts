import type {AppEvent} from '../../shared/cad-contracts.ts';

export type ActivityRow={seq:number;jobId:string;kind:string;data:any;event?:AppEvent;started?:AppEvent;ended?:AppEvent};
const operationKinds=new Set(['tool','source','execution','execution_request','diagnostic','operation','candidate','cad_progress']);
export function groupActivityRows(rows:ActivityRow[]):ActivityRow[][]{
 const groups:ActivityRow[][]=[];
 for(const row of rows){const last=groups.at(-1);if(last&&operationKinds.has(row.kind)&&operationKinds.has(last[0].kind)&&last[0].jobId===row.jobId)last.push(row);else groups.push([row]);}return groups;
}

export function buildActivityRows(jobs:any[],events:AppEvent[]):ActivityRow[]{
 const byId=new Map(jobs.map(job=>[job.operationId,job]));const rows:ActivityRow[]=[];const tools=new Map<string,ActivityRow>();const executions=new Map<string,ActivityRow>();const operations=new Map<string,ActivityRow>();const messages=new Map<string,ActivityRow>();
 const ordered=[...new Map(events.map(event=>[event.seq,event])).values()].sort((a,b)=>a.seq-b.seq);
 for(const event of ordered){
  const jobId=event.jobId??'';const data=event.data as any;
  if(!event.jobId||!byId.has(jobId)){if(!event.jobId&&['source_saved','source_conflict_branch','source_workspace_saved'].includes(event.type))rows.push({seq:event.seq,jobId:'',kind:'source',data:{...data,eventType:event.type},event});continue;}
  if(event.type==='job_updated'&&rows.every(row=>row.jobId!==jobId)){const request=byId.get(jobId)?.request;rows.push({seq:event.seq,jobId,kind:'user',data:{text:request?.text??(request?.kind==='run'?'运行指定项目源码快照':'提交 Python 建模任务'),...(request?.ideContext?{ideContext:request.ideContext}:{})},event});}
  if(event.type==='job_updated'&&data.agent?.messages&&!ordered.some(item=>item.jobId===jobId&&item.type==='agent_progress'&&['text_delta','message_end'].includes((item.data as any).type))){
   for(const message of data.agent.messages){if(message.role!=='assistant')continue;const text=(message.content??[]).filter((part:any)=>part.type==='text').map((part:any)=>part.text).join('');if(text.trim()&&!rows.some(row=>row.jobId===jobId&&row.kind==='assistant'&&row.data.text===text))rows.push({seq:event.seq,jobId,kind:'assistant',data:{text,recovered:true},event});}
  }
  if(event.type==='job_updated'&&data.plan&&data.status==='awaiting_approval'&&!rows.some(row=>row.jobId===jobId&&row.kind==='plan'))rows.push({seq:event.seq,jobId,kind:'plan',data:data.plan,event:{...event,type:'plan_ready'}});
  if(event.type==='plan_ready'||event.type==='plan_approved'||event.type==='plan_rejected'){
   const existing=event.type==='plan_ready'?rows.find(row=>row.jobId===jobId&&row.kind==='plan'&&row.event?.type==='plan_ready'&&row.data.planHash===data.planHash):undefined;
   if(existing){existing.data=data;existing.event=event;}else rows.push({seq:event.seq,jobId,kind:'plan',data,event});continue;
  }
  if(event.type==='agent_progress'){
   if(data.type==='python_execution_requested'){rows.push({seq:event.seq,jobId,kind:'execution_request',data,event});continue;}
   if(data.type==='text_delta'||data.type==='message_end'&&data.message?.role==='assistant'){
    const key=`${jobId}/${data.messageId??event.seq}`,previous=messages.get(key);
    const text=data.type==='text_delta'?(previous?.data.text??'')+data.delta:(data.message.content??[]).filter((part:any)=>part.type==='text').map((part:any)=>part.text).join('');
    if(previous){previous.data={text};previous.event=event;}else if(text.trim()){const row={seq:event.seq,jobId,kind:'assistant',data:{text},event};messages.set(key,row);rows.push(row);}
   }else if(data.type==='tool_execution_start'||data.type==='tool_execution_end'){
    const key=`${jobId}/${data.toolCallId}`,row=tools.get(key);
    if(data.type==='tool_execution_start'){const created={seq:event.seq,jobId,kind:'tool',data:{toolCallId:data.toolCallId,name:data.name,args:data.args},started:event};tools.set(key,created);rows.push(created);}
    else if(row){row.ended=event;row.data={...row.data,isError:data.isError,result:data.result};}
   }
   continue;
  }
  if(event.type==='source_saved'||event.type==='source_conflict_branch'){rows.push({seq:event.seq,jobId,kind:'source',data:{...data,eventType:event.type},event});continue;}
  if(event.type==='python_execution'){
   const key=`${jobId}/${data.executionId}`,row=executions.get(key);
   if(row){row.data={...row.data,...data};row.event=event;}
   else{const created={seq:event.seq,jobId,kind:'execution',data,event};executions.set(key,created);rows.push(created);}continue;
  }
  if(event.type==='python_diagnostic'){rows.push({seq:event.seq,jobId,kind:'diagnostic',data,event});continue;}
  if(event.type==='cad_operation_start'||event.type==='cad_operation_complete'||event.type==='cad_operation_failed'||event.type==='cad_operation_rejected'){
   const key=`${jobId}/${data.stepId}`,row=operations.get(key);
   if(row){row.data={...row.data,...data,eventType:event.type};row.event=event;row.ended=event;}
   else{const created={seq:event.seq,jobId,kind:'operation',data:{...data,eventType:event.type},started:event,...(event.type==='cad_operation_start'?{}:{ended:event})};operations.set(key,created);rows.push(created);}continue;
  }
  if(event.type==='candidate_snapshot'){rows.push({seq:event.seq,jobId,kind:'candidate',data,event});continue;}
  if(event.type==='cad_progress'){rows.push({seq:event.seq,jobId,kind:'cad_progress',data,event});continue;}
  if(event.type==='committed'){rows.push({seq:event.seq,jobId,kind:'committed',data,event});continue;}
  if(event.type==='clarification_required'){rows.push({seq:event.seq,jobId,kind:'clarification',data,event});continue;}
  if(event.type==='job_updated'&&['failed','cancelled','interrupted','rejected'].includes(data.status))rows.push({seq:event.seq,jobId,kind:'terminal',data,event});
 }
 for(const job of jobs)if(!rows.some(row=>row.jobId===job.operationId&&row.kind==='user'))rows.push({seq:Number.MAX_SAFE_INTEGER,jobId:job.operationId,kind:'user',data:{text:job.request?.text??'结构化建模任务',...(job.request?.ideContext?{ideContext:job.request.ideContext}:{})}});
 return rows.sort((a,b)=>a.seq-b.seq||a.jobId.localeCompare(b.jobId));
}
