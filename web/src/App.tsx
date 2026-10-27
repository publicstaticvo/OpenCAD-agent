import {useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import {Api,ApiError} from './api.ts';
import {WorkspaceStore} from './store.ts';
import {Viewer} from './viewer.tsx';
import {ModelSettings} from './ModelSettings.tsx';
import {describeModelFailure} from '../../shared/model-errors.ts';
import type {Job} from '../../gateway/supervisor.ts';
import type {AppEvent} from '../../shared/cad-contracts.ts';
import './style.css';
const names:Record<string,string>={'PartDesign::Body':'主体','Sketcher::SketchObject':'草图','PartDesign::Pad':'拉伸','PartDesign::Pocket':'切除'};
const statuses:Record<string,string>={queued:'排队中',running:'建模中',validating:'验证文件与几何',committing:'提交版本中',committed:'已提交',answered:'已回复，模型未修改',failed:'失败',cancelled:'已取消',interrupted:'已中断'};
const terminal=new Set(['committed','answered','failed','cancelled','interrupted']);
function ExecutionRecord({events,job,full,saved}:{events:AppEvent[];job:Job;full:boolean;saved:any[]}){
 const own=events.filter(event=>event.jobId===job.operationId),messages=new Map<number,any>();
 for(const row of saved){const index=Number(row.id.split('/').at(-1)?.replace('agent-',''));if(Number.isSafeInteger(index))messages.set(index,row.payload);}
 for(const event of own){const data=event.data as any;if(data.message)messages.set(data.messageIndex,data.message);}
 const visible=terminal.has(job.status)&&job.agent?job.agent.messages:Array.from(messages).sort(([a],[b])=>a-b).map(([,message])=>message);
 const thinking=visible.flatMap((m:any)=>m.content??[]).filter((c:any)=>c.type==='thinking').map((c:any)=>c.thinking).join('\n');
 return <>{own.filter(event=>event.type==='cad_progress'||['tool_execution_start','tool_execution_end'].includes((event.data as any).type)).map(event=>{const data=event.data as any;return <div className="progress-entry" key={event.seq}>{event.type==='cad_progress'?`${({geometry:'几何验证',save:'保存 FCStd',reopen:'独立重开',export_step:'导出 STEP',export_glb:'导出 GLB'} as Record<string,string>)[data.stage]} ${data.status==='start'?'开始':'完成'}`:`${data.name} ${data.type==='tool_execution_start'?'开始':data.isError?'失败':'完成'}`}{full&&<pre>{JSON.stringify(data.args??data.result??'',null,2)}</pre>}</div>;})}
 {visible.filter((m:any)=>m.role==='assistant').map((m:any,index:number)=><p className="assistant-message" key={index}>{m.content?.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join(' ')}</p>)}
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
 useEffect(()=>{void store.start();return()=>store.close();},[store]);
 useEffect(()=>{let active=true;api.json('/api/documents').then(data=>{if(active)setProjects(data.documents);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[api,id]);
 const conversations=state.current?.snapshot.conversations??[];
 useEffect(()=>{if(!state.current)return;if(!conversation&&conversations.length){const next=conversations[0].id;setConversation(next);history.replaceState(null,'',`/?document=${encodeURIComponent(id)}&conversation=${encodeURIComponent(next)}`);}else if(conversation&&!conversations.some(c=>c.id===conversation))setError('当前项目中不存在此对话。');},[state.current,conversation,id]);
 const loaded=before&&state.previous?state.previous:state.current,revision=loaded?.snapshot.revision??0,tree=loaded?.snapshot.tree??[],feature=tree.find(f=>f.id===selected);
 const jobs=state.jobs as Job[],active=jobs.some(job=>!terminal.has(job.status));
 const disabled=before||!state.current||state.pendingRevision!==null||!state.connected||active||sending||api.providerMode==='none'||!!state.error||!conversations.some(c=>c.id===conversation);
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
 async function submit(intent:string){
  if(disabled||!state.current||!intent.trim())return;
  setSending(true);setError('');
  try{await api.json(root+'/jobs',{baseRevision:state.current.snapshot.revision,operationId:crypto.randomUUID(),conversationId:conversation,text:intent});setText('');await store.refresh();}
  catch(e){if(e instanceof ApiError&&e.status===409){setError(/revision conflict/i.test(e.message)?'版本已更新，请确认最新模型后重新提交。':e.message);await store.refresh();}else setError((e as Error).message);}
  finally{setSending(false);}
 }
 async function cancel(job:Job){try{await api.json(root+`/jobs/${job.operationId}/cancel`,{});await store.refresh();}catch(e){setError((e as Error).message);}}
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
   <aside className="feature-panel"><h2>模型历史</h2><p className="section-note">可编辑的参数化特征</p><nav aria-label="特征树">{tree.map(f=><button key={f.id} className={selected===f.id?'feature selected':'feature'} aria-pressed={selected===f.id} aria-label={`${f.label} ${names[f.type]??f.type}`} onClick={()=>setSelected(f.id)} style={{paddingLeft:f.parent?28:14}}><span className="feature-icon">{f.type==='Sketcher::SketchObject'?'▱':f.type==='PartDesign::Pocket'?'⊖':'◇'}</span><span>{f.label}</span><small>{names[f.type]}</small></button>)}</nav><div className="history-note">单主体 · 单实体<br/>长度单位：mm<br/>特征 ID 跨版本保持</div><div className="downloads">{[['FCStd','model.FCStd'],['STEP','model.step'],['GLB','preview.glb']].map(([label,name])=><button key={name} disabled={!revision||state.pendingRevision!==null||!!state.error} onClick={()=>void download(name)}>下载 {label}</button>)}<small>下载所显示的完整版本 {revision}</small></div></aside>
   <section className="model-panel" aria-label="模型视口"><div className="model-toolbar"><strong data-testid="display-revision">{before?`历史版本 ${revision}`:`正式版本 ${revision}`}</strong>{state.pendingRevision!==null&&state.pendingRevision!==revision&&<span>正在加载版本 {state.pendingRevision}</span>}<button disabled={!state.previous?.asset} onClick={()=>setBefore(!before)}>{before?'查看当前版本':'查看修改前'}</button></div>{state.error&&<div role="alert" className="error-banner">{state.error}。当前完整版本保留，可刷新重试。</div>}{loaded?.asset?<Viewer asset={loaded.asset} selected={!!feature} onSelect={()=>setSelected('Body')}/>:<div className="empty-model"><div className="empty-cube">◇</div><h2>{state.pendingRevision!==null?'正在载入模型':'尚无正式模型'}</h2><p>候选只有通过几何与文件验收后才会成为正式版本。</p></div>}<footer className="model-footer">{feature?`所选：${feature.label} · ${names[feature.type]}`:'选择特征查看参数'}<span>正式模型与预览作为同一版本切换</span></footer></section>
   <aside className="detail-panel">
    <section className="properties"><h2>特征属性</h2>{feature?<><div className="feature-title">{feature.label}<span>{names[feature.type]}</span></div><dl className="identity"><dt>稳定 ID</dt><dd>{feature.id}</dd><dt>所属主体</dt><dd>{feature.parent??feature.id}</dd></dl>{Object.entries(feature.parameters).map(([key,value])=><Parameter key={`${revision}/${feature.id}/${key}`} name={key} value={value} disabled={disabled} submit={v=>void submit(`修改 ${feature.id}.${key} 为 ${v} mm`)}/>)}{!Object.keys(feature.parameters).length&&<p className="section-note">选择草图或拉伸/切除特征查看命名参数。</p>}</>:<p className="section-note">从左侧选择一个特征。</p>}<p className="section-note">属性修改作为建模任务提交，经候选验收后生效。历史版本、断线及加载期间禁止修改。</p></section>
    <section className="task-panel"><h2>建模对话</h2><div className="provider-note">{api.providerMode==='fake'?'离线 fake：只验证 Pi 与 CAD 编排，不代表真实模型能力。支持明确尺寸的孔板、垫套和台阶块样例。':api.providerMode==='live'?'已连接模型服务 · 支持单主体草图、拉伸、切除和尺寸修改。':'尚未配置模型服务，建模入口已禁用。'}</div>
     <label>当前对话<select aria-label="切换对话" value={conversation} onChange={e=>switchConversation(e.target.value)}><option value="" disabled>选择对话</option>{conversations.map(c=><option key={c.id} value={c.id}>{c.title}{c.activeTasks?' · 任务进行中':''}</option>)}</select></label><div className="conversation-actions"><button onClick={()=>void createConversation()}>新建对话</button><button disabled={!conversation} onClick={()=>void renameConversation()}>对话重命名</button></div><p className="section-note">本项目的所有对话共享当前模型和修订记录。</p>
     <label>执行记录<select aria-label="执行记录" value={full?'full':'key'} onChange={e=>{const next=e.target.value==='full';setFull(next);localStorage.setItem('cad-progress-display',next?'full':'key');}}><option value="key">关键执行记录</option><option value="full">完整执行记录</option></select></label>
     {jobs.filter(job=>!terminal.has(job.status)&&job.conversationId!==conversation).map(job=><p className="section-note" key={job.operationId}>后台任务：{conversations.find(c=>c.id===job.conversationId)?.title} · {statuses[job.status]}。当前模型正在由该对话修改。</p>)}
     <details className="examples"><summary>建模示例</summary><p>创建 80×60×10 mm 孔板，孔径6 mm，孔中心20,15 mm</p><p>创建外径20、内径10、高20 mm 垫套</p><p>创建40×30×10 mm底座，上层20×30×10 mm台阶块</p></details>
     <form className="chat-form" onSubmit={e=>{e.preventDefault();void submit(text);}}><textarea aria-label="建模指令" placeholder="描述尺寸、孔位与建模要求…" value={text} maxLength={8000} disabled={disabled} onChange={e=>setText(e.target.value)}/><button className="primary" disabled={disabled||!text.trim()}>发送任务</button></form>
     {error&&<p role="alert" data-testid="submission-error" className="submission-error">{error}</p>}
     <div className="job-list">{[...jobs].filter(job=>job.conversationId===conversation).reverse().map(job=><article className="job" key={job.operationId} data-job-id={job.operationId} data-status={job.status}>
      <strong>{job.request.text??'结构化建模任务'}</strong><span>{statuses[job.status]??job.status}</span><small>基于版本 {job.baseRevision} · {job.operationId.slice(0,8)}</small>
      {!terminal.has(job.status)&&<button onClick={()=>void cancel(job)}>取消任务</button>}
      <ExecutionRecord events={recordEvents} job={job} full={full} saved={savedMessages.filter(message=>message.operation_id===job.operationId)}/>
      {job.error&&<><p role="alert" data-testid="job-error">{failure(job.error,job.agent)} 正式模型未改变。{job.status==='cancelled'||job.status==='interrupted'?'取消/中断后不会自动续跑。':''}</p><details><summary>技术详情</summary><pre>{job.error}</pre></details></>}
      {job.agent&&<small>工具调用 {job.agent.toolCalls} 次 · {job.agent.provider}</small>}
      {job.agent?.historyRoundsOmitted>0&&<small>较早的 {job.agent.historyRoundsOmitted} 轮历史未发送给模型，完整记录仍保存在本项目中。</small>}
      {job.status==='committed'&&job.result&&<p className="assistant-message">FreeCAD 验收通过，正式版本 {job.result.revision} 已保存。</p>}
      {job.status==='answered'&&<p className="assistant-message">这条回复没有修改模型，正式版本保持不变。</p>}
      {terminal.has(job.status)&&job.status!=='committed'&&job.status!=='answered'&&job.request.text&&<button disabled={disabled} onClick={()=>void submit(job.request.text)}>重试任务</button>}
     </article>)}</div>
     <p className="section-note">正式状态以持久化任务结果为准。取消后重新提交会创建新任务。</p>
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
