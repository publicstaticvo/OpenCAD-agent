import type {ActivityRow} from './activity.ts';
import type {Job} from '../../gateway/supervisor.ts';
import {useEffect,useState} from 'react';
import type {Api} from './api.ts';
export function RunPanel({api,jobs,rows,selected,onSelect,onSource,cancel,accept,reject}:{api:Api;jobs:Job[];rows:ActivityRow[];selected:string;onSelect:(id:string)=>void;onSource:(version:string)=>void;cancel:(job:Job)=>void;accept:(job:Job)=>void;reject:(job:Job)=>void}){
 const executions=rows.filter(row=>row.kind==='execution'),latest=executions.at(-1),selectedJob=jobs.find(job=>job.operationId===selected),row=executions.find(row=>row.data.executionId===selected)??executions.filter(row=>row.jobId===selected).at(-1)??(selected?undefined:latest);
 const job=selectedJob??jobs.find(job=>job.operationId===row?.jobId);
 const data=row?.data,progress=rows.filter(item=>item.jobId===job?.operationId&&item.kind==='cad_progress'&&(!data||!item.data.executionId||item.data.executionId===data.executionId));
 const [record,setRecord]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{let current=true;setRecord(null);setError('');if(job&&data?.executionId)void api.json(`/api/documents/${encodeURIComponent(job.documentId)}/executions/${encodeURIComponent(data.executionId)}`).then(value=>{if(current)setRecord(value);}).catch(reason=>{if(current)setError(reason.message);});return()=>{current=false;};},[api,job?.documentId,data?.executionId,data?.status]);
 const currentExecution=executions.filter(item=>item.jobId===job?.operationId).at(-1)===row;
 const status=currentExecution?job?.status:data?.status;
 const states:Record<string,string>={queued:'排队中',running:'执行中',validating:'独立验证中',valid:'候选有效',diagnostic:'诊断完成',awaiting_acceptance:'等待候选验收',committed:'正式修订已提交',failed:'执行失败',cancelled:'已取消',rejected:'已拒绝',answered:'已回复',interrupted:'已中断'};
 return <section className="run-panel" aria-label="运行面板"><header><label>执行记录<select aria-label="选择执行记录" value={data?.executionId??''} onChange={event=>onSelect(event.target.value)}>{executions.map((item,index)=><option key={item.data.executionId} value={item.data.executionId}>#{index+1} · {jobs.find(job=>job.operationId===item.jobId)?.request.kind==='run'?'用户':'Agent'} · {item.data.status} · {item.data.executionId.slice(0,8)}</option>)}</select></label>{job&&!['failed','cancelled','interrupted','rejected','committed','answered','awaiting_acceptance'].includes(job.status)&&<button onClick={()=>cancel(job)}>停止执行</button>}</header>
 {!job?<p>尚无执行记录。选择 Python 文件后点击运行。</p>:<div className="run-details" data-run-id={job.operationId} data-execution-id={data?.executionId}><div className="run-summary"><strong>{states[status??'']??status}</strong><span>发起者：{job.request.kind==='run'?'用户':'Agent'}</span><span>正式基线：{job.baseRevision}</span><span>项目：{job.documentId}</span>{record?.createdAt&&<time dateTime={new Date(record.createdAt).toISOString()}>开始：{new Date(record.createdAt).toLocaleString()}</time>}</div>
 {error&&<p role="alert">无法读取执行诊断：{error}</p>}
 {data&&<><p>执行 {data.executionId} · 源码快照 {data.sourceVersionId}</p><button onClick={()=>onSource(data.sourceVersionId)}>查看执行源码</button></>}
 <ol className="run-progress">{progress.map(item=><li key={item.seq} data-stage={item.data.stage}>{({python_execute:'FreeCAD Python 执行',python_verify:'FCStd 独立重开、几何检查与 STEP / GLB 交付验证',geometry:'几何检查',save:'保存 FCStd',reopen:'重开 FCStd',export_step:'STEP 导出与重导入',export_glb:'GLB 检查'} as Record<string,string>)[item.data.stage]??item.data.stage} · {item.data.status==='start'?'开始':item.data.status==='complete'?'完成':item.data.status}<details><summary>实际事件</summary><pre>{JSON.stringify(item.data,null,2)}</pre></details></li>)}</ol>
 {data?.validation&&<p>几何尺寸 [{data.validation.bbox?.join(', ')}] mm · 体积 {data.validation.volume} mm³ · 健康检查 {data.healthStatus} · 任务条件 {data.acceptanceStatus} · 文件交付 {data.deliveryStatus}</p>}
 {(data?.error||currentExecution&&job.error)&&<p role="alert">{data?.error?`${data.error.stage} · ${data.error.type} · ${data.error.message}${data.error.line?` · 第 ${data.error.line} 行`:''}`:job.error}</p>}
 {job.status==='awaiting_acceptance'&&currentExecution&&<div><span>候选有效，等待用户验收。正式模型保持当前修订。</span><button onClick={()=>accept(job)}>验收此运行候选并提交</button><button onClick={()=>reject(job)}>拒绝此运行候选</button></div>}
 {data&&<details><summary>验证结果与诊断日志</summary><pre>{JSON.stringify(data,null,2)}</pre></details>}
 </div>}</section>;
}
