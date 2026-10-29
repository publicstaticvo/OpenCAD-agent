import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {Api,ApiError} from './api.ts';
import {WorkspaceStore} from './store.ts';
import {Viewer} from './viewer.tsx';
import {ModelSettings} from './ModelSettings.tsx';
import {SketchPreview} from './SketchPreview.tsx';
import type {LoadedRevision} from './store.ts';
import {describeModelFailure} from '../../shared/model-errors.ts';
import type {Job} from '../../gateway/supervisor.ts';
import type {AppEvent} from '../../shared/cad-contracts.ts';
import './style.css';
const names:Record<string,string>={'PartDesign::Body':'主体','Sketcher::SketchObject':'草图','PartDesign::Pad':'拉伸','PartDesign::Pocket':'切除'};
const statuses:Record<string,string>={planning:'生成计划',clarifying:'等待补充信息',awaiting_approval:'等待批准',approved:'已批准',queued:'排队中',running:'建模中',validating:'验证文件与几何',committing:'提交版本中',committed:'已提交',answered:'已回复，模型未修改',rejected:'计划已拒绝',failed:'失败',cancelled:'已取消',interrupted:'已中断'};
const terminal=new Set(['committed','answered','rejected','failed','cancelled','interrupted']);
function CadProgress({data}:{data:any}){
 const stages:Record<string,string>={geometry:'几何验证',save:'保存 FCStd',reopen:'独立重开',export_step:'导出 STEP',export_glb:'导出 GLB'};
 const operations:Record<string,string>={create_body:'创建主体',create_sketch:'创建草图',add_geometry:'添加几何',add_constraint:'添加约束',pad:'Pad 拉伸',pocket:'Pocket 切除',set_parameter:'修改参数'};
 const statuses:Record<string,string>={start:'开始',returned:'操作返回，等待批次完成',batch_complete:'批次事务完成',batch_aborted:'批次事务已中止，修改未保留',complete:'完成'};
 return <span>{data.stage==='operation'?(operations[data.operation?.op]??'CAD 批次'):stages[data.stage]} · {statuses[data.status]??data.status}</span>;
}
function PlanCard({job,decide}:{job:Job;decide:(decision:'approve'|'reject')=>void}){
 const p=job.plan!;const steps=p.kind==='create_box'?['创建一个主体','创建矩形草图和完全约束','Pad 拉伸实体']:p.kind==='add_hole'?['在顶面建立中心圆草图和完全约束','Pocket 贯穿切除']:p.kind==='edit_hole'?['修改已有草图的直径约束']:['执行列出的结构化 CAD 操作'];
 return <section className="plan-card" data-testid="approval-plan"><h3>建模计划</h3><p>基于正式版本 {p.baseRevision} · 单零件 · mm</p><p>外形：{p.dimensions.length} × {p.dimensions.width} × {p.dimensions.height} mm</p>{p.diameter!==undefined&&<p>中心：[{p.center?.join(', ')}] mm；孔径：{p.previousDiameter===undefined?'':`${p.previousDiameter} → `}{p.diameter} mm；贯穿</p>}<ol>{steps.map(step=><li key={step}>{step}</li>)}<li>验证、保存、独立重开、导出，全部通过后提交</li></ol><p>验收：包围盒 [{p.criteria.bbox.join(', ')}] mm；体积 {Number(p.criteria.volume.toFixed(6))} mm³；一个有效实体</p><small>批准范围：本任务列出的结构与尺寸。改变设计需要重新批准。</small>{p.program&&<details><summary>批准的全部操作和验收条件</summary><pre>{JSON.stringify(p.program,null,2)}</pre></details>}<button onClick={()=>decide('approve')}>批准并开始建模</button><button onClick={()=>decide('reject')}>拒绝计划</button></section>;
}
function RecordedCandidate({api,snapshot}:{api:Api;snapshot:any}){
 const [asset,setAsset]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;let loaded:any=null;const controller=new AbortController();
  void api.candidateAsset(snapshot.preview.url,snapshot.candidateId,snapshot.baseRevision,snapshot.sequence,snapshot.preview.sha256,controller.signal).then(value=>{loaded=value;if(active)setAsset(value);else value.dispose();}).catch(reason=>{if(active&&!controller.signal.aborted)setError((reason as Error).message);});
  return()=>{active=false;controller.abort();loaded?.dispose();};
 },[api,snapshot.candidateId,snapshot.sequence]);
 return <section data-testid="recorded-candidate"><p>历史候选实体 · 基于正式版本 {snapshot.baseRevision} · 检查点 {snapshot.sequence} · 只读执行记录</p>{error?<p role="alert">{error}</p>:asset?<Viewer asset={asset} selected={false} onSelect={()=>{}}/>:<p>正在读取实际候选实体</p>}</section>;
}
function Checkpoint({api,snapshot,committed}:{api:Api;snapshot:any;committed:boolean}){
 const [show,setShow]=useState(false);
 return <details data-testid="recorded-checkpoint"><summary>查看实际草图检查点 {snapshot.sequence} · {snapshot.geometry?'实体已生成':'草图已完成'} · 历史执行记录</summary><SketchPreview snapshot={snapshot}/>{committed&&snapshot.preview&&<><button onClick={()=>setShow(!show)}>{show?'关闭历史候选实体':'查看实际候选实体'}</button>{show&&<RecordedCandidate api={api} snapshot={snapshot}/>}</>}</details>;
}
function ExecutionRecord({api,events,job,full,saved}:{api:Api;events:AppEvent[];job:Job;full:boolean;saved:any[]}){
 const own=events.filter(event=>event.jobId===job.operationId),messages=new Map<number,any>();
 for(const row of saved){const index=Number(row.id.split('/').at(-1)?.replace('agent-',''));if(Number.isSafeInteger(index))messages.set(index,row.payload);}
 for(const event of own){const data=event.data as any;if(data.message)messages.set(data.messageIndex,data.message);}
 const visible=terminal.has(job.status)&&job.agent?job.agent.messages:Array.from(messages).sort(([a],[b])=>a-b).map(([,message])=>message);
 const thinking=visible.flatMap((m:any)=>m.content??[]).filter((c:any)=>c.type==='thinking').map((c:any)=>c.thinking).join('\n');
 return <>
 {visible.filter((m:any)=>m.role==='assistant').map((m:any)=>m.content?.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join(' ')).filter((text:string)=>text?.trim()).map((text:string,index:number)=><p className="assistant-message" key={index}>{text}</p>)}
 <details className="execution-activity" open={!terminal.has(job.status)}><summary>CAD 执行记录 · {statuses[job.status]??job.status}</summary>{own.filter(event=>event.type==='cad_progress'||event.type.startsWith('cad_operation_')||event.type==='candidate_snapshot'||['tool_execution_start','tool_execution_end'].includes((event.data as any).type)).map(event=>{const data=event.data as any;const label=event.type==='candidate_snapshot'?`候选快照 ${data.sequence}${data.geometry?` · 体积 ${Number(data.geometry.volume).toFixed(3)} mm³`:''}`:event.type.startsWith('cad_operation_')?`${data.stage??data.stepId} ${({cad_operation_start:'开始真实 CAD 操作',cad_operation_complete:'CAD 批次完成',cad_operation_failed:'CAD 操作失败',cad_operation_rejected:'写入被批准范围拒绝'} as Record<string,string>)[event.type]}`:`${data.name} ${data.type==='tool_execution_start'?'开始':data.isError?'失败':'完成'}`;return <div className="progress-entry" key={event.seq}>{event.type==='cad_progress'?<CadProgress data={data}/>:label}{event.type==='candidate_snapshot'&&data.sketch&&<Checkpoint api={api} snapshot={data} committed={job.status==='committed'}/>} {full&&<pre>{JSON.stringify(data.operations??data.operation??data.args??data.result??data.error??'',null,2)}</pre>}</div>;})}</details>
 {full&&<details><summary>模型内部推理</summary><pre>{thinking||'模型未提供'}</pre></details>}</>;
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
function Workspace({api,id,onLogout,onSettings,onProject}:{api:Api;id:string;onLogout:()=>void;onSettings:()=>void;onProject:(id:string,conversation?:string)=>void}){
 const store=useMemo(()=>new WorkspaceStore(id,api.project(id)),[api,id]);
 const state=useSyncExternalStore(store.subscribe,store.getState);
 const [selected,setSelected]=useState('Body'),[before,setBefore]=useState(false),[text,setText]=useState(''),[sending,setSending]=useState(false),[error,setError]=useState('');
 const [projects,setProjects]=useState<any[]>([]),[conversation,setConversation]=useState(()=>new URLSearchParams(location.search).get('conversation')??''),[full,setFull]=useState(()=>localStorage.getItem('cad-progress-display')==='full');
 const [savedMessages,setSavedMessages]=useState<any[]>([]),[savedEvents,setSavedEvents]=useState<AppEvent[]>([]);
 const [candidateAsset,setCandidateAsset]=useState<any>(null);
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
 const disabled=before||!!historicNumber||!state.current||state.pendingRevision!==null||!state.connected||active||sending||api.providerMode==='none'||!!state.error||!conversations.some(c=>c.id===conversation);
 const root=`/api/documents/${encodeURIComponent(id)}`;
 const historyKey=jobs.filter(job=>job.conversationId===conversation).map(job=>`${job.operationId}:${job.status}`).join(',');
 useEffect(()=>{
  const controller=new AbortController();setSavedMessages([]);setSavedEvents([]);
  if(!conversation)return()=>controller.abort();
  const get=async(path:string)=>(await api.fetch(path,{signal:controller.signal})).json();
  void(async()=>{
   const messages:any[]=[];let after=0;
   for(;;){const page=await get(`${root}/conversations/${encodeURIComponent(conversation)}/messages?afterOrdinal=${after}&limit=200`);messages.push(...page.messages);if(!page.hasMore)break;after=page.messages.at(-1).ordinal;}
   const events:AppEvent[]=[];
   for(const job of jobs.filter(job=>job.conversationId===conversation)){let seq=0;for(;;){const page=await get(`${root}/jobs/${encodeURIComponent(job.operationId)}/events?afterSeq=${seq}&limit=200`);events.push(...page.events);if(!page.hasMore)break;seq=page.lastSeq;}}
   if(!controller.signal.aborted){setSavedMessages(messages);setSavedEvents(events);}
  })().catch(e=>{if(!controller.signal.aborted)setError(e.message);});
  return()=>controller.abort();
 },[api,root,conversation,historyKey]);
 const recordEvents=Array.from(new Map([...savedEvents,...state.progress].map(event=>[event.seq,event])).values()).sort((a,b)=>a.seq-b.seq);
 const candidateJob=jobs.find(job=>['running','validating','committing'].includes(job.status)&&job.candidateSnapshot);
 const latestCandidate=candidateJob?.candidateSnapshot;
 const candidateVisible=showCandidate&&!!latestCandidate&&!before&&!historicNumber;
 useEffect(()=>{let active=true;let asset:any=null;const controller=new AbortController();setCandidateAsset(null);if(!latestCandidate?.preview)return()=>controller.abort();void api.candidateAsset(latestCandidate.preview.url,latestCandidate.candidateId,latestCandidate.baseRevision,latestCandidate.sequence,latestCandidate.preview.sha256,controller.signal).then(value=>{asset=value;if(active)setCandidateAsset(value);else value.dispose();}).catch(e=>{if(active&&!controller.signal.aborted){if(e instanceof ApiError&&e.status===404)void store.refresh();else setError((e as Error).message);}});return()=>{active=false;controller.abort();asset?.dispose();};},[api,store,latestCandidate?.candidateId,latestCandidate?.sequence]);
 useEffect(()=>{let active=true;let asset:any=null;const controller=new AbortController();setHistorical(null);if(!historicNumber)return()=>controller.abort();void(async()=>{const snapshot=await(await api.fetch(`${root}/revisions/${historicNumber}`,{signal:controller.signal})).json();asset=await api.project(id).asset(snapshot.artifacts['preview.glb'],snapshot.revision,controller.signal);if(active)setHistorical({snapshot,asset});else asset.dispose();})().catch(e=>{if(active&&!controller.signal.aborted)setError((e as Error).message);});return()=>{active=false;controller.abort();asset?.dispose();};},[api,root,id,historicNumber]);
 async function submit(intent:string){
  if(disabled||!state.current||!intent.trim())return;
  setSending(true);setError('');followHistory.current=true;setFollowing(true);
  try{await api.json(root+'/jobs',{baseRevision:state.current.snapshot.revision,operationId:crypto.randomUUID(),conversationId:conversation,text:intent});setText('');await store.refresh();}
  catch(e){if(e instanceof ApiError&&e.status===409){setError(/revision conflict/i.test(e.message)?'版本已更新，请确认最新模型后重新提交。':e.message);await store.refresh();}else setError((e as Error).message);}
  finally{setSending(false);}
 }
 async function cancel(job:Job){try{await api.json(root+`/jobs/${job.operationId}/cancel`,{});await store.refresh();}catch(e){setError((e as Error).message);}}
 async function decide(job:Job,decision:'approve'|'reject'){try{await api.json(root+`/jobs/${job.operationId}/${decision}`,{planHash:job.plan?.planHash});await store.refresh();}catch(e){setError((e as Error).message);}}
 async function download(name:string){
  try{const path=loaded?.snapshot.artifacts[name];if(!path)throw new Error('此版本缺少下载文件');const response=await api.fetch(path);if(response.headers.get('x-cad-revision')!==String(revision))throw new Error('下载版本不一致');const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download=`${id}-r${revision}.${name.split('.').at(-1)}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError((e as Error).message);}
 }
 async function createProject(){const name=window.prompt('新项目名称');if(!name?.trim())return;try{const created=await api.json('/api/documents',{name});onProject(created.documentId,created.conversations[0].id);}catch(e){setError((e as Error).message);}}
 async function renameProject(){const name=window.prompt('项目名称',state.current?.snapshot.name??id);if(!name?.trim())return;try{await api.patch(root,{name});await store.refresh();const data=await api.json('/api/documents');setProjects(data.documents);}catch(e){setError((e as Error).message);}}
 async function createConversation(){try{const created=await api.json(root+'/conversations',{});setConversation(created.id);setText('');history.replaceState(null,'',`/?document=${encodeURIComponent(id)}&conversation=${encodeURIComponent(created.id)}`);await store.refresh();setError('');}catch(e){setError((e as Error).message);}}
 async function renameConversation(){const current=conversations.find(c=>c.id===conversation);const title=window.prompt('对话名称',current?.title??'');if(!title?.trim())return;try{await api.patch(root+'/conversations/'+encodeURIComponent(conversation),{title});await store.refresh();}catch(e){setError((e as Error).message);}}
 function switchConversation(next:string){setConversation(next);setText('');setError('');history.replaceState(null,'',`/?document=${encodeURIComponent(id)}&conversation=${encodeURIComponent(next)}`);}
 return <div className="app">
  <header className="topbar"><div className="brand-mark">◈</div><h1>CAD 工作区</h1><label>项目<select aria-label="切换项目" value={id} onChange={e=>onProject(e.target.value)}>{projects.some(p=>p.id===id)?null:<option value={id}>{state.current?.snapshot.name??id}</option>}{projects.map(p=><option key={p.id} value={p.id}>{p.name}{p.activeTasks?' · 任务进行中':''}</option>)}</select></label><button onClick={()=>void createProject()}>新建项目</button><button onClick={()=>void renameProject()}>项目重命名</button><span className={state.connected?'connection connected':'connection'}>{state.connected?'已连接':'连接恢复中'}</span>{api.modelConfigurationEnabled&&<button onClick={onSettings}>模型设置</button>}<button onClick={()=>void store.refresh()}>刷新状态</button><button onClick={onLogout}>退出</button></header>
  <div className="workspace">
   <aside className="feature-panel"><h2>模型历史</h2><p className="section-note">正式修订 {revision} · mm</p><nav aria-label="特征树">{tree.map(f=><button key={f.id} className={selected===f.id?'feature selected':'feature'} aria-pressed={selected===f.id} aria-label={`${f.label} ${names[f.type]??f.type}`} onClick={()=>setSelected(f.id)} style={{paddingLeft:f.parent?28:14}}><span className="feature-icon">{f.type==='Sketcher::SketchObject'?'▱':f.type==='PartDesign::Pocket'?'⊖':'◇'}</span><span>{f.label}</span><small>{names[f.type]}</small></button>)}</nav>
    <section className="properties"><h2>特征属性</h2>{feature?<><div className="feature-title">{feature.label}<span>{names[feature.type]}</span></div><dl className="identity"><dt>稳定 ID</dt><dd>{feature.id}</dd><dt>所属主体</dt><dd>{feature.parent??feature.id}</dd></dl>{Object.entries(feature.parameters).map(([key,value])=><Parameter key={`${revision}/${feature.id}/${key}`} name={key} value={value} disabled={disabled} submit={v=>void submit(`修改 ${feature.id}.${key} 为 ${v} mm`)}/>)}{!Object.keys(feature.parameters).length&&<p className="section-note">选择草图或拉伸/切除特征查看命名参数。</p>}</>:<p className="section-note">从左侧选择一个特征。</p>}<p className="section-note">属性修改作为建模任务提交，经候选验收后生效。历史版本、断线及加载期间禁止修改。</p></section>
    <div className="history-note">单主体 · 单实体<br/>特征 ID 跨版本保持</div><div className="downloads">{[['FCStd','model.FCStd'],['STEP','model.step'],['GLB','preview.glb']].map(([label,name])=><button key={name} disabled={!revision||state.pendingRevision!==null||!!state.error} onClick={()=>void download(name)}>下载 {label}</button>)}<small>下载所显示的完整版本 {revision}</small></div></aside>
   <section className="model-panel" aria-label="模型视口">
    <div className="model-toolbar"><strong data-testid="display-revision">{before||historical?`历史版本 ${revision}`:`正式版本 ${revision}`}</strong>
     <label>修订<select aria-label="查看修订" value={historicNumber} onChange={e=>{setBefore(false);setHistoricNumber(e.target.value);}}><option value="">当前正式版本</option>{Array.from({length:state.current?.snapshot.revision??0},(_,i)=>i+1).map(r=><option key={r} value={r}>修订 {r}</option>)}</select></label>
     {state.pendingRevision!==null&&<span>正在载入版本 {state.pendingRevision}</span>}
     {historicNumber&&!historical&&<span>正在载入历史版本 {historicNumber}</span>}
     <button disabled={!state.previous?.asset||!!historicNumber} onClick={()=>setBefore(!before)}>{before?'查看当前版本':'查看修改前'}</button>
     {latestCandidate&&<button aria-pressed={showCandidate} onClick={()=>setShowCandidate(!showCandidate)}>{showCandidate?'查看正式模型':'查看候选模型'}</button>}
    </div>
    {state.error&&<div role="alert" className="error-banner">{state.error}。当前完整版本保留，可刷新重试。</div>}
    {candidateVisible?<section className="candidate-panel" data-testid="candidate-panel" data-candidate={latestCandidate.candidateId} data-sequence={latestCandidate.sequence}>
     <h3>候选模型 · 基于正式版本 {latestCandidate.baseRevision} · 尚未提交</h3>
     {candidateAsset&&<div className="candidate-viewer"><Viewer asset={candidateAsset} selected={false} onSelect={()=>{}}/></div>}
     {latestCandidate.geometry&&!candidateAsset&&<p>正在读取实际候选模型…</p>}
     <details className="candidate-data" open={!latestCandidate.geometry}><summary>实际草图、约束与候选特征</summary>
     <SketchPreview snapshot={latestCandidate}/>
     <details open><summary>候选特征与参数</summary><ul>{latestCandidate.tree.map((f:any)=><li key={f.id}>{f.id} · {names[f.type]} · {Object.entries(f.parameters).map(([name,value])=>`${name}=${value} mm`).join('，')}</li>)}</ul></details>
     </details>{latestCandidate.geometry&&<p>候选几何：[{latestCandidate.geometry.bbox.join(', ')}] mm · {Number(latestCandidate.geometry.volume.toFixed(6))} mm³</p>}
    </section>:loaded?.asset?<Viewer asset={loaded.asset} selected={!!feature} onSelect={()=>setSelected('Body')}/>:<div className="empty-model"><div className="empty-cube">◇</div><h2>{state.pendingRevision!==null?'正在载入模型':'尚无正式模型'}</h2><p>候选只有通过几何与文件验收后才会成为正式版本。</p></div>}
    <footer className="model-footer">{candidateVisible?'左侧特征树及下载仍对应正式版本':feature?`所选：${feature.label} · ${names[feature.type]}`:'选择特征查看参数'}<span>正式模型与候选预览分别标识</span></footer>
   </section>
   <aside className="detail-panel">
    <section className="task-panel"><div className="conversation-header"><h2>建模对话</h2><div className="provider-note">{api.providerMode==='fake'?'离线样例 · 真实 FreeCAD · 未调用模型':api.providerMode==='live'?'模型服务已连接 · 每次任务需要批准':'尚未配置模型服务，建模入口已禁用。'}</div>
     <label>当前对话<select aria-label="切换对话" value={conversation} onChange={e=>switchConversation(e.target.value)}><option value="" disabled>选择对话</option>{conversations.map(c=><option key={c.id} value={c.id}>{c.title}{c.activeTasks?' · 任务进行中':''}</option>)}</select></label><div className="conversation-actions"><button onClick={()=>void createConversation()}>新建对话</button><button disabled={!conversation} onClick={()=>void renameConversation()}>对话重命名</button></div><p className="section-note">本项目的所有对话共享当前模型和修订记录。</p>
     <details className="conversation-options"><summary>显示设置与建模示例</summary><label>执行记录<select aria-label="执行记录" value={full?'full':'key'} onChange={e=>{const next=e.target.value==='full';setFull(next);localStorage.setItem('cad-progress-display',next?'full':'key');}}><option value="key">关键执行记录</option><option value="full">完整执行记录</option></select></label>
     {jobs.filter(job=>!terminal.has(job.status)&&job.conversationId!==conversation).map(job=><p className="section-note" key={job.operationId}>后台任务：{conversations.find(c=>c.id===job.conversationId)?.title} · {statuses[job.status]}。{['approved','queued','running','validating','committing'].includes(job.status)?'该任务已获批，占用项目写入资格。':'该任务尚未获批，不会修改模型。'}</p>)}
     <details className="examples"><summary>建模示例</summary>{api.providerMode==='fake'?<><p>创建 80×60×10 mm 孔板，孔径6 mm，孔中心20,15 mm</p><p>创建外径20、内径10、高20 mm 垫套</p><p>创建40×30×10 mm底座，上层20×30×10 mm台阶块</p></>:<><p>创建一个长 40 mm、宽 30 mm、高 10 mm 的长方体。</p><p>在已有长方体上增加一个直径 6 mm 的中心贯穿孔。</p><p>把已有孔径从 6 mm 修改为 8 mm。</p></>}</details>
     </details></div>
     <div className="job-list" aria-label="对话历史" ref={historyRef} onClickCapture={e=>{if((e.target as Element).closest('summary')){followHistory.current=false;setFollowing(false);}}} onScroll={e=>{const node=e.currentTarget;const next=node.scrollHeight-node.scrollTop-node.clientHeight<48;followHistory.current=next;setFollowing(next);}}><div className="history-content">{!jobs.some(job=>job.conversationId===conversation)&&<p className="conversation-empty">描述零件的形状与尺寸。建模计划经过批准后，执行过程会显示在这里。</p>}{jobs.filter(job=>job.conversationId===conversation).map(job=><article className="job" key={job.operationId} data-job-id={job.operationId} data-status={job.status}>
      <strong>{job.request.text??'结构化建模任务'}</strong><span>{statuses[job.status]??job.status}</span><small>基于版本 {job.baseRevision} · {job.operationId.slice(0,8)}</small>
      {!terminal.has(job.status)&&<button onClick={()=>void cancel(job)}>取消任务</button>}
      {job.status==='awaiting_approval'&&job.plan&&<PlanCard job={job} decide={decision=>void decide(job,decision)}/>}
      <ExecutionRecord api={api} events={recordEvents} job={job} full={full} saved={savedMessages.filter(message=>message.operation_id===job.operationId)}/>
      {job.error&&<><p role="alert" data-testid="job-error">{failure(job.error,job.agent)} 正式模型未改变。{job.status==='cancelled'||job.status==='interrupted'?'取消/中断后不会自动续跑。':''}</p><details><summary>技术详情</summary><pre>{job.error}</pre></details></>}
      {job.agent&&<small>工具调用 {job.agent.toolCalls} 次 · {job.agent.provider}</small>}
      {job.agent?.historyRoundsOmitted>0&&<small>较早的 {job.agent.historyRoundsOmitted} 轮历史未发送给模型，完整记录仍保存在本项目中。</small>}
      {job.status==='committed'&&job.result&&<p className="assistant-message">FreeCAD 验收通过，正式版本 {job.result.revision} 已保存。</p>}
      {job.status==='answered'&&<p className="assistant-message">这条回复没有修改模型，正式版本保持不变。</p>}
      {terminal.has(job.status)&&job.status!=='committed'&&job.status!=='answered'&&job.request.text&&<button disabled={disabled} onClick={()=>void submit(job.request.text)}>重试任务</button>}
     </article>)}</div></div>
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
 if(!id)return <main className="login"><h1>打开建模项目</h1><form onSubmit={async e=>{e.preventDefault();const input=new FormData(e.currentTarget).get('document') as string;try{await api.json(`/api/documents/${encodeURIComponent(input)}`);history.replaceState(null,'',`/?document=${encodeURIComponent(input)}`);setId(input);}catch(e){setError((e as Error).message);}}}><label>项目 ID<input name="document" required/></label><button>打开项目</button></form><button className="primary" onClick={async()=>{try{const created=await api.json('/api/documents',{});history.replaceState(null,'',`/?document=${created.documentId}`);setId(created.documentId);}catch(e){setError((e as Error).message);}}}>创建空白项目</button>{error&&<p role="alert">{error}</p>}</main>;
 const openProject=(next:string,conversation?:string)=>{history.replaceState(null,'',`/?document=${encodeURIComponent(next)}${conversation?`&conversation=${encodeURIComponent(conversation)}`:''}`);setId(next);};
 return <Workspace key={id} api={api} id={id} onProject={openProject} onLogout={logout} onSettings={()=>setSettings(true)}/>;
}
