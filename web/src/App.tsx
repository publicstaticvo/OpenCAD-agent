import {useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import {Api,ApiError} from './api.ts';
import {WorkspaceStore} from './store.ts';
import {Viewer} from './viewer.tsx';
import type {Job} from '../../gateway/supervisor.ts';
import './style.css';
const names:Record<string,string>={'PartDesign::Body':'主体','Sketcher::SketchObject':'草图','PartDesign::Pad':'拉伸','PartDesign::Pocket':'切除'};
const statuses:Record<string,string>={queued:'排队中',running:'建模中',validating:'验证文件与几何',committing:'提交版本中',committed:'已提交',failed:'失败',cancelled:'已取消',interrupted:'已中断'};
const terminal=new Set(['committed','failed','cancelled','interrupted']);
function failure(reason:string){
 if(/Volume acceptance mismatch/.test(reason))return '体积不符合请求的尺寸，可能存在超出边界的切除。';
 if(/Bounding box/.test(reason))return '模型外形尺寸与请求不一致。';
 if(/fully constrained|solve|Recompute/.test(reason))return '草图约束或模型重算失败，请检查尺寸是否冲突。';
 if(/solid|geometry/.test(reason))return '修改无法形成有效的单一实体，请检查尺寸。';
 if(/unsupported|did not request successful/.test(reason))return '请求缺少必要尺寸或超出当前离线样例支持范围。';
 if(/conflict/i.test(reason))return '正式版本已改变，请刷新后重新提交。';
 if(/timeout/i.test(reason))return '建模或验收超时，请缩小任务后重试。';
 return '候选建模或验收失败，请查看详情并调整请求。';
}
function Parameter({name,value,disabled,submit}:{name:string;value:number;disabled:boolean;submit:(value:number)=>void}){
 const [draft,setDraft]=useState(String(value));
 return <div className="parameter-edit"><label className="parameter"><span>{name}<small>mm</small></span><input aria-label={`${name} (mm)`} type="number" value={draft} disabled={disabled} onChange={e=>setDraft(e.target.value)}/></label><button aria-label={`提交 ${name} 修改`} disabled={disabled||draft.trim()===''||!Number.isFinite(Number(draft))||Number(draft)===value} onClick={()=>submit(Number(draft))}>提交修改</button></div>;
}
function Workspace({api,id,onLogout}:{api:Api;id:string;onLogout:()=>void}){
 const store=useMemo(()=>new WorkspaceStore(id,api.project(id)),[api,id]);
 const state=useSyncExternalStore(store.subscribe,store.getState);
 const [selected,setSelected]=useState('Body'),[before,setBefore]=useState(false),[text,setText]=useState(''),[sending,setSending]=useState(false),[error,setError]=useState('');
 useEffect(()=>{void store.start();return()=>store.close();},[store]);
 const loaded=before&&state.previous?state.previous:state.current,revision=loaded?.snapshot.revision??0,tree=loaded?.snapshot.tree??[],feature=tree.find(f=>f.id===selected);
 const jobs=state.jobs as Job[],active=jobs.some(job=>!terminal.has(job.status));
 const disabled=before||state.pendingRevision!==null||!state.connected||active||sending||api.providerMode==='none'||!!state.error;
 const root=`/api/documents/${encodeURIComponent(id)}`;
 async function submit(intent:string){
  if(disabled||!state.current||!intent.trim())return;
  setSending(true);setError('');
  try{await api.json(root+'/jobs',{baseRevision:state.current.snapshot.revision,operationId:crypto.randomUUID(),text:intent});setText('');await store.refresh();}
  catch(e){if(e instanceof ApiError&&e.status===409){setError('版本已更新，请检查最新模型后重新提交。');await store.refresh();}else setError((e as Error).message);}
  finally{setSending(false);}
 }
 async function cancel(job:Job){try{await api.json(root+`/jobs/${job.operationId}/cancel`,{});await store.refresh();}catch(e){setError((e as Error).message);}}
 async function download(name:string){
  try{const path=loaded?.snapshot.artifacts[name];if(!path)throw new Error('此版本缺少下载文件');const response=await api.fetch(path);if(response.headers.get('x-cad-revision')!==String(revision))throw new Error('下载版本不一致');const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download=`${id}-r${revision}.${name.split('.').at(-1)}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError((e as Error).message);}
 }
 return <div className="app">
  <header className="topbar"><div className="brand-mark">◈</div><h1>CAD 工作区</h1><span className="project-name" title={id}>{id.slice(0,16)}</span><span className={state.connected?'connection connected':'connection'}>{state.connected?'已连接':'连接恢复中'}</span><button onClick={()=>void store.refresh()}>刷新状态</button><button onClick={onLogout}>退出</button></header>
  <div className="workspace">
   <aside className="feature-panel"><h2>模型历史</h2><p className="section-note">可编辑的参数化特征</p><nav aria-label="特征树">{tree.map(f=><button key={f.id} className={selected===f.id?'feature selected':'feature'} aria-pressed={selected===f.id} aria-label={`${f.label} ${names[f.type]??f.type}`} onClick={()=>setSelected(f.id)} style={{paddingLeft:f.parent?28:14}}><span className="feature-icon">{f.type==='Sketcher::SketchObject'?'▱':f.type==='PartDesign::Pocket'?'⊖':'◇'}</span><span>{f.label}</span><small>{names[f.type]}</small></button>)}</nav><div className="history-note">单主体 · 单实体<br/>长度单位：mm<br/>特征 ID 跨版本保持</div><div className="downloads">{[['FCStd','model.FCStd'],['STEP','model.step'],['GLB','preview.glb']].map(([label,name])=><button key={name} disabled={!revision} onClick={()=>void download(name)}>下载 {label}</button>)}<small>下载所显示的完整版本 {revision}</small></div></aside>
   <section className="model-panel" aria-label="模型视口"><div className="model-toolbar"><strong data-testid="display-revision">{before?`历史版本 ${revision}`:`正式版本 ${revision}`}</strong>{state.pendingRevision!==null&&state.pendingRevision!==revision&&<span>正在加载版本 {state.pendingRevision}</span>}<button disabled={!state.previous?.asset} onClick={()=>setBefore(!before)}>{before?'查看当前版本':'查看修改前'}</button></div>{state.error&&<div role="alert" className="error-banner">{state.error}。当前完整版本保留，可刷新重试。</div>}{loaded?.asset?<Viewer asset={loaded.asset} selected={!!feature} onSelect={()=>setSelected('Body')}/>:<div className="empty-model"><div className="empty-cube">◇</div><h2>{state.pendingRevision!==null?'正在载入模型':'尚无正式模型'}</h2><p>候选只有通过几何与文件验收后才会成为正式版本。</p></div>}<footer className="model-footer">{feature?`所选：${feature.label} · ${names[feature.type]}`:'选择特征查看参数'}<span>正式模型与预览作为同一版本切换</span></footer></section>
   <aside className="detail-panel">
    <section className="properties"><h2>特征属性</h2>{feature?<><div className="feature-title">{feature.label}<span>{names[feature.type]}</span></div><dl className="identity"><dt>稳定 ID</dt><dd>{feature.id}</dd><dt>所属主体</dt><dd>{feature.parent??feature.id}</dd></dl>{Object.entries(feature.parameters).map(([key,value])=><Parameter key={`${revision}/${feature.id}/${key}`} name={key} value={value} disabled={disabled} submit={v=>void submit(`修改 ${feature.id}.${key} 为 ${v} mm`)}/>)}{!Object.keys(feature.parameters).length&&<p className="section-note">选择草图或拉伸/切除特征查看命名参数。</p>}</>:<p className="section-note">从左侧选择一个特征。</p>}<p className="section-note">属性修改作为建模任务提交，经候选验收后生效。历史版本、断线及加载期间禁止修改。</p></section>
    <section className="task-panel"><h2>建模对话</h2><div className="provider-note">{api.providerMode==='fake'?'离线 fake：只验证 Pi 与 CAD 编排，不代表真实模型能力。支持明确尺寸的孔板、垫套和台阶块样例。':'尚未配置模型服务，建模入口已禁用。'}</div>
     <details className="examples"><summary>离线样例指令</summary><p>创建 80×60×10 mm 孔板，孔径6 mm，孔中心20,15 mm</p><p>创建外径20、内径10、高20 mm 垫套</p><p>创建40×30×10 mm底座，上层20×30×10 mm台阶块</p></details>
     <form className="chat-form" onSubmit={e=>{e.preventDefault();void submit(text);}}><textarea aria-label="建模指令" placeholder="描述尺寸、孔位与建模要求…" value={text} maxLength={8000} disabled={disabled} onChange={e=>setText(e.target.value)}/><button className="primary" disabled={disabled||!text.trim()}>发送任务</button></form>
     {error&&<p role="alert" data-testid="submission-error" className="submission-error">{error}</p>}
     <div className="job-list">{[...jobs].reverse().map(job=><article className="job" key={job.operationId} data-job-id={job.operationId} data-status={job.status}><strong>{job.request.text??'结构化建模任务'}</strong><span>{statuses[job.status]??job.status}</span><small>基于版本 {job.baseRevision} · {job.operationId.slice(0,8)}</small>{!terminal.has(job.status)&&<button onClick={()=>void cancel(job)}>取消任务</button>}{job.error&&<><p role="alert" data-testid="job-error">{failure(job.error)} 正式模型未改变。{job.status==='cancelled'||job.status==='interrupted'?'取消/中断后不会自动续跑。':''}</p><details><summary>技术详情</summary><pre>{job.error}</pre></details></>}{job.agent&&<><small>工具调用 {job.agent.toolCalls} 次 · {job.agent.provider}</small>{job.agent.messages.filter((m:any)=>m.role==='assistant').map((m:any,i:number)=><p className="assistant-message" key={i}>{m.content?.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join(' ')}</p>)}</>}{terminal.has(job.status)&&job.status!=='committed'&&job.request.text&&<button disabled={disabled} onClick={()=>void submit(job.request.text)}>重试任务</button>}</article>)}</div>
     <p className="section-note">正式状态以持久化任务结果为准。取消后重新提交会创建新任务。</p>
    </section>
   </aside>
  </div>
 </div>;
}
export default function App(){
 const [key,setKey]=useState(()=>sessionStorage.getItem('cad-access-token')??''),[api,setApi]=useState<Api|null>(null),[error,setError]=useState(''),[id,setId]=useState(()=>new URLSearchParams(location.search).get('document')??'');
 const connect=async()=>{try{const candidate=new Api(key);await candidate.session();sessionStorage.setItem('cad-access-token',key);setApi(candidate);setError('');}catch(e){setError((e as Error).message);}};
 useEffect(()=>{if(key)void connect();},[]);
 const logout=()=>{sessionStorage.removeItem('cad-access-token');setApi(null);setKey('');};
 if(!api)return <main className="login"><div className="login-brand">◈ CAD 工作区</div><h1>连接本机建模工作区</h1><p>输入服务启动时生成的本地访问密钥。模型服务凭据留在服务端。</p><form onSubmit={e=>{e.preventDefault();void connect();}}><label>访问密钥<input aria-label="访问密钥" type="password" value={key} onChange={e=>setKey(e.target.value)} autoComplete="off" required/></label><button className="primary" type="submit">连接工作区</button></form>{error&&<p role="alert">{error}</p>}<small>访问密钥保存在当前浏览器标签页；请仅连接可信本机或受保护的服务。</small></main>;
 if(!id)return <main className="login"><h1>打开建模项目</h1><form onSubmit={async e=>{e.preventDefault();const input=new FormData(e.currentTarget).get('document') as string;try{await api.json(`/api/documents/${encodeURIComponent(input)}`);history.replaceState(null,'',`/?document=${encodeURIComponent(input)}`);setId(input);}catch(e){setError((e as Error).message);}}}><label>项目 ID<input name="document" required/></label><button>打开项目</button></form><button className="primary" onClick={async()=>{try{const created=await api.json('/api/documents',{});history.replaceState(null,'',`/?document=${created.documentId}`);setId(created.documentId);}catch(e){setError((e as Error).message);}}}>创建空白项目</button>{error&&<p role="alert">{error}</p>}</main>;
 return <Workspace api={api} id={id} onLogout={logout}/>;
}
