import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import type {CSSProperties,KeyboardEvent,PointerEvent} from 'react';
import {Api,ApiError} from './api.ts';
import {WorkspaceStore} from './store.ts';
import {Viewer} from './viewer.tsx';
import {ModelSettings} from './ModelSettings.tsx';
import {SketchPreview} from './SketchPreview.tsx';
import {AssemblyPanel} from './AssemblyPanel.tsx';
import {SourceWorkspace} from './SourceWorkspace.tsx';
import {ProjectChooser} from './ProjectChooser.tsx';
import {RunPanel} from './RunPanel.tsx';
import {buildActivityRows,groupActivityRows,type ActivityRow} from './activity.ts';
import type {LoadedRevision} from './store.ts';
import {describeModelFailure} from '../../shared/model-errors.ts';
import type {Job} from '../../gateway/supervisor.ts';
import type {AppEvent} from '../../shared/cad-contracts.ts';
import './style.css';
import './workspace.css';
import './ide.css';
const names:Record<string,string>={'PartDesign::Body':'主体','Sketcher::SketchObject':'草图','PartDesign::Pad':'拉伸','PartDesign::Pocket':'切除','Assembly::AssemblyObject':'装配','App::Link':'组件'};
const statuses:Record<string,string>={planning:'生成计划',clarifying:'等待补充信息',awaiting_approval:'等待批准',awaiting_acceptance:'等待候选验收',approved:'已批准',queued:'排队中',running:'建模中',validating:'验证文件与几何',committing:'提交版本中',committed:'已提交',answered:'已回复，模型未修改',rejected:'已拒绝',failed:'失败',cancelled:'已取消',interrupted:'已中断'};
const terminal=new Set(['committed','answered','rejected','failed','cancelled','interrupted','awaiting_acceptance']);
function CadProgress({data}:{data:any}){
 const stages:Record<string,string>={geometry:'几何验证',save:'保存 FCStd',reopen:'独立重开',export_step:'导出 STEP',export_glb:'导出 GLB',python_execute:'执行 Python 项目',python_verify:'独立几何、重开与导出检查'};
 if(data.stage==='assembly')return <span>{data.partId==='plate'?'底板':data.partId==='pin'?'圆柱销':'装配'} · {({part_start:'开始真实建模',sketch_complete:'实际草图与约束完成',feature_complete:`${data.feature} ${data.operation} 完成`,part_complete:'单体几何验证完成',assembly_complete:'原生固定关节装配完成'} as Record<string,string>)[data.status]??data.status}</span>;
 if(data.stage==='interference')return <span>实际装配几何检查 · {data.report?.status==='clear'?'装配有效，无实体材料重叠':data.report?.status==='invalid'?`装配无效：${data.report.reason}`:'存在真实材料干涉'} {data.report?.pairs?.map((pair:any)=>`${pair.components.join(' ↔ ')}：${pair.volume} mm³`).join('，')}</span>;
 const operations:Record<string,string>={create_body:'创建主体',create_sketch:'创建草图',add_geometry:'添加几何',add_constraint:'添加约束',pad:'Pad 拉伸',pocket:'Pocket 切除',set_parameter:'修改参数'};
 const statuses:Record<string,string>={start:'开始',returned:'操作返回，等待批次完成',batch_complete:'批次事务完成',batch_aborted:'批次事务已中止，修改未保留',complete:'完成'};
 return <span>{data.stage==='operation'?(operations[data.operation?.op]??'CAD 批次'):stages[data.stage]} · {statuses[data.status]??data.status}</span>;
}
function PlanCard({job,decide}:{job:Job;decide:(decision:'approve'|'reject')=>void}){
 if(job.plan?.kind==='python')return <section className="plan-card" data-testid="approval-plan"><h3>Python 建模任务</h3><p>{job.plan.goal}</p><p>基于正式版本 {job.baseRevision}。批准后，Agent 会保存源码并按用户的建模要求执行真实 FreeCAD 检查。保存源码本身不会运行代码；没有任务验收条件时，结果只作为诊断预览。正式模型仅在几何、任务验收和交付检查通过后更新。</p><p>批准对象为本次任务范围；源码版本、执行身份和验收依据分别保留。</p><button onClick={()=>decide('approve')}>批准并开始建模</button><button onClick={()=>decide('reject')}>拒绝计划</button></section>;
 if(job.plan?.kind==='pin_plate_assembly'||job.plan?.kind==='edit_pin_plate_assembly'){
  const p=job.plan,a=p.assembly!;const editing=p.kind==='edit_pin_plate_assembly';
  return <section className="plan-card" data-testid="approval-plan"><h3>{editing?'双零件装配修改计划':'双零件装配计划'}</h3><p>基于正式版本 {p.baseRevision} · mm</p><p>Plate / 底板 × 1：{a.length} × {a.width} × {a.thickness} mm，中心贯穿孔 Ø{a.holeDiameter} mm。</p><p>Pin / 圆柱销 × 1：Ø{a.pinDiameter} × {a.pinLength} mm。</p><p>底板接地；圆柱销固定于 [{a.length/2}, {a.width/2}, 0]，不旋转。</p><ol>{editing?<li>仅修改圆柱销直径并重新验证现有装配</li>:<><li>底板草图、约束、Pad、Pocket 和单体验证</li><li>圆柱销草图、约束、Pad 和单体验证</li><li>创建两个组件链接及原生固定关节</li></>}<li>真实几何交集检查，交叠时拒绝提交</li><li>保存、独立重开和 STEP / GLB 验证后提交</li></ol><button onClick={()=>decide('approve')}>批准并开始建模</button><button onClick={()=>decide('reject')}>拒绝计划</button></section>;
 }
 if(job.plan?.kind==='operations'){
  const p=job.plan;
  return <section className="plan-card" data-testid="approval-plan"><h3>操作建模计划</h3><p>{p.goal}</p><p>基于正式版本 {p.baseRevision} · 单零件 · mm</p><ol>{p.stages!.map((stage,index)=><li key={index}><strong>{stage.name}</strong> · {stage.operations.length} 项操作<details><summary>查看批准的操作和参数</summary><pre>{JSON.stringify(stage.operations,null,2)}</pre></details></li>)}<li>原生操作重放验证、保存、独立重开、几何导出与正式提交</li></ol><p>验收：包围盒 [{p.criteria.bbox.join(', ')}] mm；体积 {Number(p.criteria.volume.toFixed(6))} mm³；一个有效实体</p><details><summary>全部验收条件</summary><pre>{JSON.stringify(p.criteria,null,2)}</pre></details><small>执行顺序和参数绑定本次批准。修改方案需要重新批准。</small><button onClick={()=>decide('approve')}>批准并开始建模</button><button onClick={()=>decide('reject')}>拒绝计划</button></section>;
 }
 const p=job.plan!;const steps=p.kind==='create_box'?['创建一个主体','创建矩形草图和完全约束','Pad 拉伸实体']:p.kind==='add_hole'?['在顶面建立中心圆草图和完全约束','Pocket 贯穿切除']:p.kind==='edit_hole'?['修改已有草图的直径约束']:['执行列出的结构化 CAD 操作'];
 return <section className="plan-card" data-testid="approval-plan"><h3>建模计划</h3><p>基于正式版本 {p.baseRevision} · 单零件 · mm</p><p>外形：{p.dimensions.length} × {p.dimensions.width} × {p.dimensions.height} mm</p>{p.diameter!==undefined&&<p>中心：[{p.center?.join(', ')}] mm；孔径：{p.previousDiameter===undefined?'':`${p.previousDiameter} → `}{p.diameter} mm；贯穿</p>}<ol>{steps.map(step=><li key={step}>{step}</li>)}<li>验证、保存、独立重开、导出，全部通过后提交</li></ol><p>验收：包围盒 [{p.criteria.bbox.join(', ')}] mm；体积 {Number(p.criteria.volume.toFixed(6))} mm³；一个有效实体</p><small>批准范围：本任务列出的结构与尺寸。改变设计需要重新批准。</small>{p.program&&<details><summary>批准的全部操作和验收条件</summary><pre>{JSON.stringify(p.program,null,2)}</pre></details>}<button onClick={()=>decide('approve')}>批准并开始建模</button><button onClick={()=>decide('reject')}>拒绝计划</button></section>;
}
function RecordedCandidate({api,snapshot,diagnostic=false}:{api:Api;snapshot:any;diagnostic?:boolean}){
 const [asset,setAsset]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;let loaded:any=null;const controller=new AbortController();
  void api.candidateAsset(snapshot.preview.url,snapshot.candidateId,snapshot.baseRevision,snapshot.sequence,snapshot.preview.sha256,controller.signal).then(value=>{loaded=value;if(active)setAsset(value);else value.dispose();}).catch(reason=>{if(active&&!controller.signal.aborted)setError((reason as Error).message);});
  return()=>{active=false;controller.abort();loaded?.dispose();};
 },[api,snapshot.candidateId,snapshot.sequence]);
 return <section data-testid="recorded-candidate"><p>{diagnostic?'诊断预览，未通过任务验收':'历史候选实体'} · 基于正式版本 {snapshot.baseRevision} · 检查点 {snapshot.sequence} · 只读执行记录</p>{error?<p role="alert">{error}</p>:asset?<Viewer asset={asset} selected={false} onSelect={()=>{}}/>:<p>正在读取实际候选实体</p>}</section>;
}
function Checkpoint({api,snapshot,committed}:{api:Api;snapshot:any;committed:boolean}){
 const [show,setShow]=useState(false);
 return <details data-testid="recorded-checkpoint"><summary>查看实际草图检查点 {snapshot.sequence} · {snapshot.geometry?'实体已生成':'草图已完成'} · 历史执行记录</summary><SketchPreview snapshot={snapshot}/>{committed&&snapshot.preview&&<><button onClick={()=>setShow(!show)}>{show?'关闭历史候选实体':'查看实际候选实体'}</button>{show&&<RecordedCandidate api={api} snapshot={snapshot}/>}</>}</details>;
}
function ActivityTimeline({rows,jobs,api,full,onOpenSource,onRevision,decide,cancel,retry,disabled,onSelectExecution}:{rows:ActivityRow[];jobs:Job[];api:Api;full:boolean;onOpenSource:(versionId?:string,path?:string)=>void;onRevision:(revision:string)=>void;decide:(job:Job,decision:'approve'|'reject')=>void;cancel:(job:Job)=>void;retry:(job:Job)=>void;disabled:boolean;onSelectExecution?:(row:ActivityRow)=>void}){
 const byId=new Map(jobs.map(job=>[job.operationId,job]));
 const toolNames:Record<string,string>={read:'读取源码',write:'创建源码版本',edit:'修改源码',cad_run:'运行 Python 源码',cad_inspect:'检查模型',cad_finish:'提交正式修订'};
 function renderRow(row:ActivityRow,index:number){const job=byId.get(row.jobId),data=row.data??{};const key=`${row.jobId}/${row.seq}/${row.kind}/${index}`;
  if(row.kind==='user')return <li className="activity-user" key={key} data-activity="user" data-job-id={row.jobId} data-status={job?.status}><span className="activity-kind">用户请求</span>{job&&!['failed','cancelled','interrupted','rejected'].includes(job.status)&&<span className="activity-status">{statuses[job.status]??job.status}</span>}<p>{data.text}</p><small>{job?`基于正式版本 ${job.baseRevision}`:'项目源码操作'}</small>{job&&!terminal.has(job.status)&&<button onClick={()=>cancel(job)}>取消任务</button>}</li>;
  if(row.kind==='assistant')return <li className="activity-agent" key={key} data-activity="assistant"><span className="activity-kind">Agent 回复</span><p>{data.text}</p>{data.recovered&&<small>来自本次任务状态保存的回复</small>}{data.text.includes('script.py')&&<button onClick={()=>onOpenSource()}>打开项目 Python 源码</button>}</li>;
  if(row.kind==='plan')return <li className="activity-system" key={key} data-activity="plan">{row.event?.type==='plan_ready'&&job?.status==='awaiting_approval'&&job.plan?<PlanCard job={job} decide={decision=>decide(job,decision)}/>:<><span className="activity-kind">{row.event?.type==='plan_approved'?'计划已批准':row.event?.type==='plan_rejected'?'计划已拒绝':'建模计划已生成'}</span>{job?.plan&&<small>{job.plan.planHash.slice(0,12)}</small>}</>}</li>;
  if(row.kind==='tool')return <li className="activity-tool" key={key} data-activity="tool" data-tool-call={data.toolCallId??row.started?.seq}><span className="activity-kind">{toolNames[data.name]??data.name??'Agent 工具'}</span><span className="activity-status">{row.ended?(row.data.isError?'失败':'完成'):'执行中'}</span>{data.isError&&<p role="alert" className="activity-error">{JSON.stringify(data.result?.content??data.result??'工具调用失败')}</p>}{full&&<details><summary>查看输入与结果</summary><pre>{JSON.stringify({arguments:data.args,result:data.result},null,2)}</pre></details>}</li>;
  if(row.kind==='source')return <li className="activity-system" key={key} data-activity="source"><span className="activity-kind">{data.eventType==='source_workspace_saved'?'用户保存项目文件':data.eventType==='source_conflict_branch'?(data.actor==='agent'?'Agent 冲突源码':'用户冲突检查点'):data.actor==='agent'?'Agent 修改源码':data.sourceOrigin==='import'?'用户导入源码并创建检查点':data.action==='run'?'用户运行前冻结源码':data.action==='handoff'?'用户交给 Agent 的源码':'用户创建源码检查点'}</span>{data.versionId&&<small>版本 {data.versionId.slice(0,12)} · 父版本 {data.parentVersionId?.slice(0,12)??'无'}</small>}{data.versionId&&<button onClick={()=>onOpenSource(data.versionId)}>查看源码 Diff</button>}{data.changes?.map((change:any)=><details key={change.path}><summary>{change.path} · {change.kind} · 查看文件 Diff</summary><button onClick={()=>onOpenSource(data.versionId,change.path)}>定位文件 {change.path}</button><pre>{change.diff}</pre></details>)}</li>;
  if(row.kind==='execution_request')return <li className="activity-system" key={key}><span className="activity-kind">系统自动执行已批准建模任务的源码</span><small>源码版本 {data.sourceVersionId} · SHA-256 {data.sourceHash}</small><button onClick={()=>onOpenSource(data.sourceVersionId)}>查看执行源码</button></li>;
  if(row.kind==='execution')return <li className="activity-execution" key={key} data-activity="execution" data-testid="python-execution"><span className="activity-kind">Python 执行 · {data.status==='running'?'执行中':data.status==='valid'?'候选有效':data.status==='diagnostic'?(data.acceptanceStatus==='not-run'?'诊断完成，尚未验收':'任务验收失败'):data.status==='cancelled'?'已取消':data.status==='interrupted'?'已中断':'执行失败'}</span><small>执行 {data.executionId?.slice(0,12)} · 源码版本 {data.sourceVersionId} · SHA-256 {data.sourceHash}</small>{data.error&&<p role="alert" className="activity-error">{data.error.stage} · {data.error.type} · {data.error.message}{data.error.line?` · 第 ${data.error.line} 行`:''}</p>}{data.validation&&<p>健康检查 {data.healthStatus} · 任务验收 {data.acceptanceStatus} · 交付检查 {data.deliveryStatus} · [{data.validation.bbox?.join(', ')}] mm · {data.validation.volume} mm³</p>}<button onClick={()=>onOpenSource(data.sourceVersionId)}>查看执行源码</button>{onSelectExecution&&<button onClick={()=>onSelectExecution(row)}>查看运行详情</button>}{full&&<details><summary>检查结果</summary><pre>{JSON.stringify(data,null,2)}</pre></details>}</li>;
  if(row.kind==='diagnostic')return <li className="activity-system" key={key}><span className="activity-kind">诊断预览 · 未替换有效候选或正式模型</span><details><summary>查看实际诊断模型</summary><RecordedCandidate api={api} snapshot={data} diagnostic/></details></li>;
  if(row.kind==='operation')return <li className="activity-tool" key={key} data-activity="cad-operation"><span className="activity-kind">{data.stage??data.stepId} · {data.eventType==='cad_operation_start'?'真实 CAD 操作执行中':data.eventType==='cad_operation_complete'?'CAD 操作完成':data.eventType==='cad_operation_rejected'?'操作超出批准范围':'CAD 操作失败'}</span>{data.error&&<p role="alert" className="activity-error">{data.error}</p>}{full&&<details><summary>操作细节</summary><pre>{JSON.stringify(data.operations??data.result??data,null,2)}</pre></details>}</li>;
  if(row.kind==='cad_progress')return <li className="activity-tool" key={key}><span className="activity-kind"><CadProgress data={data}/></span>{full&&<details><summary>Worker 结果</summary><pre>{JSON.stringify(data,null,2)}</pre></details>}</li>;
  if(row.kind==='candidate')return <li className="activity-system" key={key}><span className="activity-kind">实际候选检查点 {data.sequence}{data.geometry?` · 体积 ${Number(data.geometry.volume).toFixed(3)} mm³`:''}</span>{data.sketch&&<Checkpoint api={api} snapshot={data} committed={job?.status==='committed'}/>}</li>;
  if(row.kind==='committed')return <li className="activity-commit" key={key} data-activity="commit"><span className="activity-kind">正式修订 {data.revision} 已提交</span><button onClick={()=>onRevision(String(data.revision))}>查看此修订</button></li>;
  if(row.kind==='terminal')return <li className="activity-error" key={key} data-activity="terminal"><span className="activity-kind">{({failed:'失败',cancelled:'已取消',interrupted:'已中断',rejected:'已拒绝'} as Record<string,string>)[data.status]}</span>{job?.error&&<><p role="alert" data-testid="job-error">{failure(job.error,job.agent)} 正式模型未改变。{data.status==='cancelled'||data.status==='interrupted'?'任务取消或中断后不会自动续跑。':''}</p><details><summary>技术详情</summary><pre>{job.error}</pre></details></>}{job?.request?.text&&<button disabled={disabled} onClick={()=>retry(job)}>重试</button>}</li>;
  if(row.kind==='clarification')return <li className="activity-system" key={key}><span className="activity-kind">等待需求补充</span><p>{data.question??data.message}</p></li>;
  return <li key={`${key}/${index}`}>{row.kind}</li>;
 }
 return <ol className="activity-timeline" aria-label="统一活动历史">{groupActivityRows(rows).map(group=>group.length===1?renderRow(group[0],0):<li className="activity-group" key={`${group[0].jobId}/${group[0].seq}`}><details className="execution-activity" open><summary>执行活动 · {group.length} 项真实操作与检查</summary><ol>{group.map(renderRow)}</ol></details></li>)}</ol>;
}
function failure(reason:string,report?:any){
 const last=report?.messages?.filter((message:any)=>message.role==='assistant').at(-1);
 if(/did not request successful cad_finish/.test(reason)&&last?.stopReason==='error')return describeModelFailure(last);
 if(/^模型/.test(reason))return reason;
 if(/Volume acceptance mismatch/.test(reason))return '体积不符合请求的尺寸，可能存在超出边界的切除。';
 if(/Bounding box/.test(reason))return '模型外形尺寸与请求不一致。';
 if(/fully constrained|solve|Recompute/.test(reason))return '草图约束或模型重算失败，请检查尺寸是否冲突。';
 if(/solid|geometry/.test(reason))return '修改无法形成有效的单一实体，请检查尺寸。';
 if(/unsupported/.test(reason))return '当前建模工具不支持该请求。';
 if(/did not request successful/.test(reason))return '模型未完成所需工具调用和几何验收。';
 if(/conflict/i.test(reason))return '正式版本已改变，请刷新后重新提交。';
 if(/timeout/i.test(reason))return '建模或验收超时，请缩小任务后重试。';
 return '候选建模或验收失败，请查看详情并调整请求。';
}
function Parameter({name,value,disabled,submit}:{name:string;value:number;disabled:boolean;submit:(value:number)=>void}){
 const [draft,setDraft]=useState(String(value));
 return <div className="parameter-edit"><label className="parameter"><span>{name}<small>mm</small></span><input aria-label={`${name} (mm)`} type="number" value={draft} disabled={disabled} onChange={e=>setDraft(e.target.value)}/></label><button aria-label={`提交 ${name} 修改`} disabled={disabled||draft.trim()===''||!Number.isFinite(Number(draft))||Number(draft)===value} onClick={()=>submit(Number(draft))}>提交修改</button></div>;
}
type LayoutMode='model'|'source'|'side'|'stack';
function LayoutGlyph({mode}:{mode:LayoutMode}){return <svg className="layout-icon" width="20" height="18" viewBox="0 0 20 18" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><rect x="1" y="1" width="18" height="16" rx="2"/>{mode==='model'?<path d="m10 4 5 3v5l-5 3-5-3V7l5-3Zm0 5v6M5 7l5 2 5-2"/>:mode==='source'?<path d="m8 5-4 4 4 4m4-8 4 4-4 4"/>:mode==='side'?<path d="M10 1v16"/>:<path d="M1 9h18"/>}</svg>;}
function LayoutButton({mode,current,onChoose}:{mode:LayoutMode;current:LayoutMode;onChoose:(mode:LayoutMode)=>void}){
 const labels:Record<LayoutMode,string>={model:'仅显示模型',source:'仅显示 Python 源码',side:'模型与源码左右并列',stack:'模型与源码上下并列'};
 return <button className="layout-button" type="button" aria-label={labels[mode]} title={labels[mode]} aria-pressed={current===mode} onClick={()=>onChoose(mode)}><LayoutGlyph mode={mode}/></button>;
}
function Workspace({api,id,onLogout,onSettings,onProject}:{api:Api;id:string;onLogout:()=>void;onSettings:()=>void;onProject:(id:string,conversation?:string)=>void}){
 const store=useMemo(()=>new WorkspaceStore(id,api.project(id)),[api,id]);
 const state=useSyncExternalStore(store.subscribe,store.getState);
 const [selected,setSelected]=useState('Body'),[before,setBefore]=useState(false),[text,setText]=useState(''),[sending,setSending]=useState(false),[error,setError]=useState('');
 const [projects,setProjects]=useState<any[]>([]),[conversation,setConversation]=useState(()=>new URLSearchParams(location.search).get('conversation')??''),[full,setFull]=useState(()=>localStorage.getItem('cad-progress-display')==='full');
 const [layout,setLayout]=useState<LayoutMode>(()=>{const value=localStorage.getItem('cad-workspace-layout');return value==='source'||value==='side'||value==='stack'?value:'model';}),[split,setSplit]=useState(()=>Number(localStorage.getItem('cad-workspace-split')??50)),[sourceDirty,setSourceDirty]=useState(false);
 const [savedEvents,setSavedEvents]=useState<AppEvent[]>([]),[sourceFocus,setSourceFocus]=useState<string|undefined>(),[sourceFileFocus,setSourceFileFocus]=useState<string|undefined>(),[sourceOpenKey,setSourceOpenKey]=useState(0);
 const [candidateAsset,setCandidateAsset]=useState<any>(null);
 const [bottomTab,setBottomTab]=useState<'run'|'activity'>('run'),[bottomHeight,setBottomHeight]=useState(()=>Number(localStorage.getItem('cad-workspace-bottom-height')??220)),[selectedExecution,setSelectedExecution]=useState('');
 const stageRef=useRef<HTMLDivElement>(null);
 const [showCandidate,setShowCandidate]=useState(true),[historicNumber,setHistoricNumber]=useState(''),[historical,setHistorical]=useState<LoadedRevision|null>(null);
 const historyRef=useRef<HTMLDivElement>(null),followHistory=useRef(true);
 const [following,setFollowing]=useState(true);
 useEffect(()=>{followHistory.current=true;setFollowing(true);},[conversation]);
 useEffect(()=>{
  const history=historyRef.current;if(!history)return;
  const follow=()=>{if(followHistory.current)history.scrollTop=history.scrollHeight;};
  const observer=new ResizeObserver(follow);observer.observe(history.firstElementChild!);follow();
  return()=>observer.disconnect();
 },[conversation]);
 useEffect(()=>{void store.start();return()=>store.close();},[store]);
 useEffect(()=>{let active=true;api.json('/api/documents').then(data=>{if(active)setProjects(data.documents);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[api,id]);
 const conversations=state.current?.snapshot.conversations??[];
 useEffect(()=>{if(!state.current)return;if(!conversation&&conversations.length){const next=conversations[0].id;setConversation(next);history.replaceState(null,'',`/?document=${encodeURIComponent(id)}&conversation=${encodeURIComponent(next)}`);}else if(conversation&&!conversations.some(c=>c.id===conversation))setError('当前项目中不存在此对话。');},[state.current,conversation,id]);
 const loaded=historical??(before&&state.previous?state.previous:state.current),revision=loaded?.snapshot.revision??0,tree=loaded?.snapshot.tree??[],feature=tree.find(f=>f.id===selected);
 const jobs=state.jobs as Job[],active=jobs.some(job=>job.conversationId===conversation&&!terminal.has(job.status)&&job.status!=='awaiting_approval');
 const disabled=!state.current||state.pendingRevision!==null||!state.connected||active||sending||api.providerMode==='none'||!!state.error||!conversations.some(c=>c.id===conversation);
 const root=`/api/documents/${encodeURIComponent(id)}`;
 const historyKey=jobs.filter(job=>job.conversationId===conversation).map(job=>`${job.operationId}:${job.status}`).join(',');
 useEffect(()=>{
  const controller=new AbortController();setSavedEvents([]);
  if(!conversation)return()=>controller.abort();
  const get=async(path:string)=>(await api.fetch(path,{signal:controller.signal})).json();
  void(async()=>{
   const events:AppEvent[]=(await get(`${root}/events?afterSeq=0`)).events;
   if(!controller.signal.aborted)setSavedEvents(events);
  })().catch(e=>{if(!controller.signal.aborted)setError(e.message);});
  return()=>controller.abort();
 },[api,root,jobs.map(job=>`${job.operationId}:${job.status}`).join(','),state.current?.snapshot.lastSeq]);
 const recordEvents=Array.from(new Map([...savedEvents,...state.progress].map(event=>[event.seq,event])).values()).sort((a,b)=>a.seq-b.seq);
 const chatJobs=jobs.filter(job=>job.conversationId===conversation&&job.request.kind!=='run'&&job.request.kind!=='python');
 const activityRows=buildActivityRows(chatJobs,recordEvents).filter(row=>['assistant','plan','terminal','clarification'].includes(row.kind)||row.kind==='user'&&chatJobs.some(job=>job.operationId===row.jobId&&job.request.kind==='text'));
 const projectActivityRows=buildActivityRows(jobs,recordEvents);
 const lastOpenedExecution=useRef('');
 const newestExecution=projectActivityRows.filter(row=>row.kind==='execution').at(-1);
 useEffect(()=>{const identity=newestExecution?.data.executionId;if(!identity||identity===lastOpenedExecution.current)return;lastOpenedExecution.current=identity;setSelectedExecution(identity);setBottomTab('run');setBottomHeight(height=>height||220);},[newestExecution?.data.executionId]);
 const sourceEventKey=recordEvents.filter(event=>event.type==='source_saved'||event.type==='source_conflict_branch').at(-1)?.seq??0;
 const candidateJob=jobs.find(job=>['running','validating','committing','answered','awaiting_acceptance'].includes(job.status)&&job.candidateSnapshot);
 const latestCandidate=candidateJob?.candidateSnapshot;
 useEffect(()=>{if(latestCandidate)setShowCandidate(true);},[latestCandidate?.candidateId]);
 const candidateVisible=showCandidate&&!!latestCandidate&&!before&&!historicNumber;
 useEffect(()=>{let active=true;let asset:any=null;const controller=new AbortController();setCandidateAsset(null);if(!latestCandidate?.preview)return()=>controller.abort();void api.candidateAsset(latestCandidate.preview.url,latestCandidate.candidateId,latestCandidate.baseRevision,latestCandidate.sequence,latestCandidate.preview.sha256,controller.signal).then(value=>{asset=value;if(active)setCandidateAsset(value);else value.dispose();}).catch(e=>{if(active&&!controller.signal.aborted){if(e instanceof ApiError&&e.status===404)void store.refresh();else setError((e as Error).message);}});return()=>{active=false;controller.abort();asset?.dispose();};},[api,store,latestCandidate?.candidateId,latestCandidate?.sequence]);
 useEffect(()=>{let active=true;let asset:any=null;const controller=new AbortController();setHistorical(null);if(!historicNumber)return()=>controller.abort();void(async()=>{const snapshot=await(await api.fetch(`${root}/revisions/${historicNumber}`,{signal:controller.signal})).json();asset=await api.project(id).asset(snapshot.artifacts['preview.glb'],snapshot.revision,controller.signal);if(active)setHistorical({snapshot,asset});else asset.dispose();})().catch(e=>{if(active&&!controller.signal.aborted)setError((e as Error).message);});return()=>{active=false;controller.abort();asset?.dispose();};},[api,root,id,historicNumber]);
 async function submit(intent:string){
  if(disabled||!state.current||!intent.trim())return;
  setSending(true);setError('');followHistory.current=true;setFollowing(true);
  try{
   const workspace=await api.json(root+'/source/workspace');const draft=workspace.workspace;
   const checkpoint=await api.json(root+'/source/checkpoint',{source:draft.source,project:draft.project,baseVersionId:draft.baseVersionId,expectedBaseVersionId:draft.baseVersionId,draftRevision:draft.draftRevision,action:'handoff'});
   if(checkpoint.conflict)throw new Error('源码工作副本与 Agent 新版本发生冲突。请先查看差异并决定采用哪份源码。');
   await api.json(root+'/jobs',{baseRevision:state.current.snapshot.revision,operationId:crypto.randomUUID(),conversationId:conversation,text:intent});setText('');await store.refresh();
  }
  catch(e){if(e instanceof ApiError&&e.status===409){setError(/revision conflict/i.test(e.message)?'版本已更新，请确认最新模型后重新提交。':e.message);await store.refresh();}else setError((e as Error).message);}
  finally{setSending(false);}
 }
 async function cancel(job:Job){try{await api.json(root+`/jobs/${job.operationId}/cancel`,{});await store.refresh();}catch(e){setError((e as Error).message);}}
 async function decideCandidate(job:Job,accept:boolean){try{await api.json(root+`/jobs/${job.operationId}/${accept?'accept':'reject-candidate'}`,{});setShowCandidate(false);await store.refresh();}catch(e){setError((e as Error).message);}}
 async function decide(job:Job,decision:'approve'|'reject'){try{await api.json(root+`/jobs/${job.operationId}/${decision}`,{planHash:job.plan?.planHash});await store.refresh();}catch(e){setError((e as Error).message);}}
 async function download(name:string){
  try{const path=loaded?.snapshot.artifacts[name];if(!path)throw new Error('此版本缺少下载文件');const response=await api.fetch(path);if(response.headers.get('x-cad-revision')!==String(revision))throw new Error('下载版本不一致');const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download=`${id}-r${revision}.${name.split('.').at(-1)}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError((e as Error).message);}
 }
 async function createProject(){if(sourceDirty&&!window.confirm('源码有未保存修改。切换到新项目会关闭当前编辑缓冲区，继续吗？'))return;const name=window.prompt('新项目名称');if(!name?.trim())return;try{const created=await api.json('/api/documents',{name});onProject(created.documentId,created.conversations[0].id);}catch(e){setError((e as Error).message);}}
 async function renameProject(){const name=window.prompt('项目名称',state.current?.snapshot.name??id);if(!name?.trim())return;try{await api.patch(root,{name});await store.refresh();const data=await api.json('/api/documents');setProjects(data.documents);}catch(e){setError((e as Error).message);}}
 async function createConversation(){try{const created=await api.json(root+'/conversations',{});setConversation(created.id);setText('');history.replaceState(null,'',`/?document=${encodeURIComponent(id)}&conversation=${encodeURIComponent(created.id)}`);await store.refresh();setError('');}catch(e){setError((e as Error).message);}}
 async function renameConversation(){const current=conversations.find(c=>c.id===conversation);const title=window.prompt('对话名称',current?.title??'');if(!title?.trim())return;try{await api.patch(root+'/conversations/'+encodeURIComponent(conversation),{title});await store.refresh();}catch(e){setError((e as Error).message);}}
 function switchConversation(next:string){setConversation(next);setText('');setError('');history.replaceState(null,'',`/?document=${encodeURIComponent(id)}&conversation=${encodeURIComponent(next)}`);}
 function changeLayout(next:LayoutMode){setLayout(next);localStorage.setItem('cad-workspace-layout',next);}
 function openSource(versionId?:string,path?:string){setSourceFocus(versionId);setSourceFileFocus(path);setSourceOpenKey(value=>value+1);changeLayout('source');}
 function updateSplit(event:PointerEvent<HTMLDivElement>){const rect=stageRef.current?.getBoundingClientRect();if(!rect)return;const value=layout==='side'?(event.clientX-rect.left)/rect.width*100:(event.clientY-rect.top)/rect.height*100;const bounded=Math.max(25,Math.min(75,value));setSplit(bounded);localStorage.setItem('cad-workspace-split',String(bounded));}
 function onSplitKey(event:KeyboardEvent<HTMLDivElement>){const increment=event.key==='ArrowRight'||event.key==='ArrowDown'?5:event.key==='ArrowLeft'||event.key==='ArrowUp'?-5:0;if(!increment)return;event.preventDefault();const value=Math.max(25,Math.min(75,split+increment));setSplit(value);localStorage.setItem('cad-workspace-split',String(value));}
 function resizeBottom(event:PointerEvent<HTMLDivElement>){const host=event.currentTarget.closest('.main-work-area');if(!host)return;const rect=host.getBoundingClientRect(),height=Math.max(110,Math.min(rect.height-300,rect.bottom-event.clientY));setBottomHeight(height);localStorage.setItem('cad-workspace-bottom-height',String(height));}
 function selectActivityExecution(row:ActivityRow){setSelectedExecution(row.kind==='execution'?row.data.executionId:row.jobId);setBottomTab('run');setBottomHeight(height=>height||220);}
 function switchProject(next:string){if(sourceDirty&&!window.confirm('源码有未保存修改。切换项目会关闭当前编辑缓冲区，继续吗？'))return;onProject(next);}
 return <div className="app">
  <header className="topbar"><div className="brand-mark">◈</div><h1>CAD 工作区</h1><label>项目<select aria-label="切换项目" value={id} onChange={e=>switchProject(e.target.value)}>{projects.some(p=>p.id===id)?null:<option value={id}>{state.current?.snapshot.name??id}</option>}{projects.map(p=><option key={p.id} value={p.id}>{p.name}{p.activeTasks?' · 任务进行中':''}</option>)}</select></label><button onClick={()=>void createProject()}>新建项目</button><button onClick={()=>void renameProject()}>项目重命名</button><div className="layout-controls" role="group" aria-label="工作区布局">{(['model','source','side','stack'] as LayoutMode[]).map(mode=><LayoutButton key={mode} mode={mode} current={layout} onChoose={changeLayout}/>)}</div><span className={state.connected?'connection connected':'connection'}>{state.connected?'已连接':'连接恢复中'}</span>{api.modelConfigurationEnabled&&<button onClick={onSettings}>模型设置</button>}<button onClick={()=>void store.refresh()}>刷新状态</button><button onClick={()=>{if(!sourceDirty||window.confirm('源码有未保存修改。退出会关闭当前编辑缓冲区，继续吗？'))onLogout();}}>退出</button></header>
  <div className="workspace">
   <aside className="feature-panel"><h2>模型结构</h2><p className="section-note">正式修订 {revision} · mm</p><nav aria-label="特征树">{tree.map(f=><button key={f.id} className={selected===f.id?'feature selected':'feature'} aria-pressed={selected===f.id} aria-label={`${f.label} ${names[f.type]??f.type}`} onClick={()=>setSelected(f.id)} style={{paddingLeft:f.parent?28:14}}><span className="feature-icon">{f.type==='Sketcher::SketchObject'?'▱':f.type==='PartDesign::Pocket'?'⊖':'◇'}</span><span>{f.label}</span><small>{names[f.type]}</small></button>)}</nav>
    <section className="properties"><h2>特征属性</h2>{feature?<><div className="feature-title">{feature.label}<span>{names[feature.type]}</span></div><dl className="identity"><dt>稳定 ID</dt><dd>{feature.id}</dd><dt>所属主体</dt><dd>{feature.parent??feature.id}</dd></dl>{Object.entries(feature.parameters).map(([key,value])=><Parameter key={`${revision}/${feature.id}/${key}`} name={key} value={value} disabled={disabled||before||!!historicNumber} submit={v=>void submit(`修改 ${feature.id}.${key} 为 ${v} mm`)}/>)}{!Object.keys(feature.parameters).length&&<p className="section-note">选择草图或拉伸/切除特征查看命名参数。</p>}</>:<p className="section-note">从左侧选择一个特征。</p>}<p className="section-note">属性修改作为建模任务提交，经候选验收后生效。历史版本、断线及加载期间禁止修改。</p></section>
   <div className="history-note">实际 FreeCAD 文档特征<br/>属性对应当前正式修订</div></aside>
   <main className="main-work-area">
   <div ref={stageRef} className={`stage-panel layout-${layout}`} style={{'--split':`${split}%`} as CSSProperties}>
   <section className="model-panel" aria-label="模型视口" aria-hidden={layout==='source'}>
    <div className="model-toolbar"><strong data-testid="display-revision">{before||historical?`历史版本 ${revision}`:`正式版本 ${revision}`}</strong>
     <label>修订<select aria-label="查看修订" value={historicNumber} onChange={e=>{setBefore(false);setHistoricNumber(e.target.value);}}><option value="">当前正式版本</option>{Array.from({length:state.current?.snapshot.revision??0},(_,i)=>i+1).map(r=><option key={r} value={r}>修订 {r}</option>)}</select></label>
     {state.pendingRevision!==null&&<span>正在载入版本 {state.pendingRevision}</span>}
     {historicNumber&&!historical&&<span>正在载入历史版本 {historicNumber}</span>}
     <button disabled={!state.previous?.asset||!!historicNumber} onClick={()=>setBefore(!before)}>{before?'查看当前版本':'查看修改前'}</button>
     {latestCandidate&&<button aria-pressed={showCandidate} onClick={()=>setShowCandidate(!showCandidate)}>{showCandidate?'查看正式模型':'查看候选模型'}</button>}
     <details className="export-menu"><summary aria-label="导出模型" aria-disabled={!revision}>导出</summary><div role="menu" aria-label="导出正式修订">{[['FreeCAD 文档','model.FCStd'],['STEP','model.step'],['GLB','preview.glb']].map(([label,name])=><button role="menuitem" key={name} disabled={!revision||state.pendingRevision!==null||!!state.error} onClick={()=>void download(name)}>导出 {label}（.{name.split('.').at(-1)}）</button>)}</div></details>{!revision&&<span className="export-unavailable">当前没有可导出的正式修订</span>}
    </div>
    {state.error&&<div role="alert" className="error-banner">{state.error}。当前完整版本保留，可刷新重试。</div>}
    {candidateVisible?<section className="candidate-panel" data-testid="candidate-panel" data-candidate={latestCandidate.candidateId} data-sequence={latestCandidate.sequence}>
     <h3>候选模型 · 基于正式版本 {latestCandidate.baseRevision} · 尚未提交</h3>
     {candidateJob?.status==='awaiting_acceptance'&&<div className="candidate-actions"><p>文件和几何检查已经完成。请检查当前候选，验收后生成正式修订。</p><button className="primary" onClick={()=>void decideCandidate(candidateJob,true)}>验收候选并提交</button><button onClick={()=>void decideCandidate(candidateJob,false)}>拒绝候选</button></div>}
     {candidateAsset&&<div className="candidate-viewer"><Viewer asset={candidateAsset} selected={false} onSelect={()=>{}}/></div>}
     {latestCandidate.geometry&&!candidateAsset&&<p>正在读取实际候选模型…</p>}
     <details className="candidate-data" open={!latestCandidate.geometry}><summary>实际草图、约束与候选特征</summary>
     {latestCandidate.sketch&&<SketchPreview snapshot={latestCandidate}/>}
     {latestCandidate.assembly&&<AssemblyPanel assembly={latestCandidate.assembly} revision={latestCandidate.baseRevision} candidate/>}
     <details open><summary>候选特征与参数</summary><ul>{latestCandidate.tree.map((f:any)=><li key={f.id}>{f.id} · {names[f.type]} · {Object.entries(f.parameters).map(([name,value])=>`${name}=${value} mm`).join('，')}</li>)}</ul></details>
     </details>{latestCandidate.geometry&&<p>候选几何：[{latestCandidate.geometry.bbox.join(', ')}] mm · {Number(latestCandidate.geometry.volume.toFixed(6))} mm³</p>}
    </section>:loaded?.asset?<Viewer asset={loaded.asset} selected={!!feature} onSelect={()=>setSelected('Body')}/>:<div className="empty-model"><div className="empty-cube">◇</div><h2>{state.pendingRevision!==null?'正在载入模型':'尚无正式模型'}</h2><p>候选只有通过几何与文件验收后才会成为正式版本。</p></div>}
    {loaded?.snapshot.validation?.assembly&&<details className="model-assembly"><summary>正式修订 {revision} · 装配组件、BOM 与干涉报告</summary><AssemblyPanel assembly={loaded.snapshot.validation.assembly} revision={revision} onSelect={setSelected}/></details>}
    <footer className="model-footer">{candidateVisible?'左侧特征树及下载仍对应正式版本':feature?`所选：${feature.label} · ${names[feature.type]}`:'选择特征查看参数'}<span>正式模型与候选预览分别标识</span></footer>
   </section>
   <div className={`layout-separator ${layout==='side'?'separator-vertical':'separator-horizontal'}`} role="separator" aria-label="调整模型与源码区域大小" aria-orientation={layout==='side'?'vertical':'horizontal'} aria-valuemin={25} aria-valuemax={75} aria-valuenow={Math.round(split)} tabIndex={layout==='side'||layout==='stack'?0:-1} onKeyDown={onSplitKey} onPointerDown={event=>event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={event=>{if(event.buttons===1&&(layout==='side'||layout==='stack'))updateSplit(event);}}/>
   <SourceWorkspace api={api} documentId={id} embedded initialVersionId={sourceFocus} initialPath={sourceFileFocus} openKey={sourceOpenKey} onClose={()=>changeLayout('model')} onSaved={()=>void store.refresh()} onDirtyChange={setSourceDirty} onRun={operationId=>{setSelectedExecution(operationId);setBottomTab('run');setBottomHeight(height=>height||220);}} onPanel={tab=>{if(tab==='toggle')setBottomHeight(height=>height?0:220);else {setBottomTab(tab);setBottomHeight(height=>height||220);}}} onLayout={changeLayout} onStop={jobs.some(job=>!terminal.has(job.status))?()=>{const job=jobs.find(job=>!terminal.has(job.status));if(job)void cancel(job);}:undefined} refreshKey={sourceEventKey}/>
   </div>
   <div className={`main-bottom-panel ${bottomHeight===0?'collapsed':''}`}>
    {bottomHeight>0&&<div role="separator" aria-label="调整底部面板高度" aria-orientation="horizontal" tabIndex={0} className="bottom-resize-handle" onPointerDown={event=>event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={event=>{if(event.buttons===1)resizeBottom(event);}} onKeyDown={event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();const next=Math.max(110,Math.min(700,bottomHeight+(event.key==='ArrowUp'?24:-24)));setBottomHeight(next);localStorage.setItem('cad-workspace-bottom-height',String(next));}}}/>}
    <div className="bottom-tabs" role="tablist" aria-label="Main Work Area 底部面板"><button role="tab" aria-selected={bottomTab==='run'} onClick={()=>{setBottomTab('run');setBottomHeight(height=>height||220);}}>运行</button><button role="tab" aria-selected={bottomTab==='activity'} onClick={()=>{setBottomTab('activity');setBottomHeight(height=>height||220);}}>活动历史</button><button aria-label={bottomHeight?'收起底部面板':'展开底部面板'} title={bottomHeight?'收起':'展开'} onClick={()=>setBottomHeight(height=>height?0:220)}>{bottomHeight?'⌄':'⌃'}</button></div>
    {bottomHeight>0&&<div className="bottom-panel-content" style={{height:bottomHeight}}>{bottomTab==='activity'?<div className="project-activity" aria-label="项目活动历史"><ActivityTimeline rows={projectActivityRows} jobs={jobs} api={api} full={full} onOpenSource={openSource} onRevision={value=>{setBefore(false);setHistoricNumber(value);}} decide={(job,decision)=>void decide(job,decision)} cancel={job=>void cancel(job)} retry={job=>void submit(job.request.text)} disabled={disabled} onSelectExecution={selectActivityExecution}/></div>:<RunPanel api={api} jobs={jobs} rows={projectActivityRows} selected={selectedExecution} onSelect={setSelectedExecution} onSource={openSource} cancel={job=>void cancel(job)} accept={job=>void decideCandidate(job,true)} reject={job=>void decideCandidate(job,false)}/>}</div>}
   </div>
   </main>
   <aside className="detail-panel">
    <section className="task-panel"><div className="conversation-header"><h2>建模对话</h2><div className="provider-note">{api.providerMode==='fake'?'离线样例 · 真实 FreeCAD · 未调用模型':api.providerMode==='live'?'模型服务已连接 · 候选模型由用户验收':'尚未配置模型服务，建模对话已禁用；源码仍可直接运行。'}</div>
     <label>当前对话<select aria-label="切换对话" value={conversation} onChange={e=>switchConversation(e.target.value)}><option value="" disabled>选择对话</option>{conversations.map(c=><option key={c.id} value={c.id}>{c.title}{c.activeTasks?' · 任务进行中':''}</option>)}</select></label><div className="conversation-actions"><button onClick={()=>void createConversation()}>新建对话</button><button disabled={!conversation} onClick={()=>void renameConversation()}>对话重命名</button></div><p className="section-note">本项目的所有对话共享当前模型和修订记录。</p>
     <details className="conversation-options"><summary>显示设置与建模示例</summary><label>执行记录<select aria-label="执行记录" value={full?'full':'key'} onChange={e=>{const next=e.target.value==='full';setFull(next);localStorage.setItem('cad-progress-display',next?'full':'key');}}><option value="key">关键执行记录</option><option value="full">完整执行记录</option></select></label>
     {jobs.filter(job=>!terminal.has(job.status)&&job.conversationId!==conversation).map(job=><p className="section-note" key={job.operationId}>后台任务：{conversations.find(c=>c.id===job.conversationId)?.title} · {statuses[job.status]}。{['approved','queued','running','validating','committing'].includes(job.status)?'该任务已获批，占用项目写入资格。':'该任务尚未获批，不会修改模型。'}</p>)}
     <details className="examples"><summary>建模示例</summary>{api.providerMode==='fake'?<><p>创建 80×60×10 mm 孔板，孔径6 mm，孔中心20,15 mm</p><p>创建外径20、内径10、高20 mm 垫套</p><p>创建40×30×10 mm底座，上层20×30×10 mm台阶块</p></>:<><p>创建一个长 40 mm、宽 30 mm、高 10 mm 的长方体。</p><p>在已有长方体上增加一个直径 6 mm 的中心贯穿孔。</p><p>把已有孔径从 6 mm 修改为 8 mm。</p></>}</details>
     </details></div>
     <div className="job-list" aria-label="对话历史" ref={historyRef} onClickCapture={e=>{if((e.target as Element).closest('summary')){followHistory.current=false;setFollowing(false);}}} onScroll={e=>{const node=e.currentTarget;const next=node.scrollHeight-node.scrollTop-node.clientHeight<48;followHistory.current=next;setFollowing(next);}}>{activityRows.length===0?<p className="conversation-empty">描述零件的形状与尺寸。执行详情保存在中间工作区的运行面板与活动历史；有效候选等待你的验收。</p>:<ActivityTimeline rows={activityRows} jobs={jobs.filter(job=>job.conversationId===conversation)} api={api} full={full} onOpenSource={versionId=>{setSourceFocus(versionId);changeLayout('source');}} onRevision={value=>{setBefore(false);setHistoricNumber(value);}} decide={(job,decision)=>void decide(job,decision)} cancel={job=>void cancel(job)} retry={job=>void submit(job.request.text)} disabled={disabled}/>}{jobs.filter(job=>job.conversationId===conversation&&job.request.kind==='text').map(job=><div className="chat-run-summary" key={job.operationId}>{statuses[job.status]??job.status}<button onClick={()=>{setSelectedExecution(job.operationId);setBottomTab('run');setBottomHeight(height=>height||220);}}>查看任务运行记录</button></div>)}</div>
     {!following&&<button className="latest-message" onClick={()=>{followHistory.current=true;setFollowing(true);const history=historyRef.current;if(history)history.scrollTop=history.scrollHeight;}}>查看最新消息</button>}
     {error&&<p role="alert" data-testid="submission-error" className="submission-error">{error}</p>}
     <form className="chat-form" onSubmit={e=>{e.preventDefault();void submit(text);}}><textarea aria-label="建模指令" placeholder="描述尺寸、孔位与建模要求…" value={text} maxLength={8000} disabled={disabled} onChange={e=>setText(e.target.value)}/><div className="composer-footer"><small>候选通过验收后提交正式模型</small><button className="primary" disabled={disabled||!text.trim()}>发送任务</button></div></form>
    </section>
   </aside>
  </div>
 </div>;
}
export default function App(){
 const [key,setKey]=useState(()=>sessionStorage.getItem('cad-access-token')??''),[api,setApi]=useState<Api|null>(null),[error,setError]=useState(''),[id,setId]=useState(()=>new URLSearchParams(location.search).get('document')??''),[settings,setSettings]=useState(false);
 const connect=async()=>{try{const candidate=new Api(key);await candidate.session();sessionStorage.setItem('cad-access-token',key);setSettings(candidate.modelConfigurationEnabled&&candidate.providerMode==='none');setApi(candidate);setError('');}catch(e){setError((e as Error).message);}};
 useEffect(()=>{if(key)void connect();},[]);
 const logout=()=>{sessionStorage.removeItem('cad-access-token');setApi(null);setKey('');};
 if(!api)return <main className="login"><div className="login-brand">◈ CAD 工作区</div><h1>连接本机建模工作区</h1><p>输入服务启动时生成的本地访问密钥。模型服务凭据留在服务端。</p><form onSubmit={e=>{e.preventDefault();void connect();}}><label>访问密钥<input aria-label="访问密钥" type="password" value={key} onChange={e=>setKey(e.target.value)} autoComplete="off" required/></label><button className="primary" type="submit">连接工作区</button></form>{error&&<p role="alert">{error}</p>}<small>访问密钥保存在当前浏览器标签页；请仅连接可信本机或受保护的服务。</small></main>;
 if(api.modelConfigurationEnabled&&(settings||api.providerMode==='none'))return <ModelSettings api={api} onDone={()=>setSettings(false)}/>;
 if(!id)return <ProjectChooser api={api} onOpen={next=>{history.replaceState(null,'',`/?document=${encodeURIComponent(next)}`);setId(next);}}/>;
 const openProject=(next:string,conversation?:string)=>{history.replaceState(null,'',`/?document=${encodeURIComponent(next)}${conversation?`&conversation=${encodeURIComponent(conversation)}`:''}`);setId(next);};
 return <Workspace key={id} api={api} id={id} onProject={openProject} onLogout={logout} onSettings={()=>setSettings(true)}/>;
}
