import {useEffect,useState} from 'react';
import type {Api} from './api.ts';

export function ProjectChooser({api,onOpen}:{api:Api;onOpen:(id:string)=>void}){
 const [projects,setProjects]=useState<any[]>([]),[query,setQuery]=useState(''),[error,setError]=useState('');
 useEffect(()=>{void api.json('/api/documents').then(response=>setProjects(response.documents)).catch(reason=>setError(reason.message));},[api]);
 async function create(){const name=window.prompt('新项目名称');if(!name?.trim())return;try{const project=await api.json('/api/documents',{name});onOpen(project.documentId);}catch(reason){setError((reason as Error).message);}}
 return <main className="project-chooser"><header><h1>CAD 项目</h1><button className="primary" onClick={()=>void create()}>创建新项目</button></header><label>搜索项目<input aria-label="搜索项目" value={query} onChange={event=>setQuery(event.target.value)} placeholder="输入项目名称"/></label>{error&&<p role="alert">{error}</p>}<ul>{projects.filter(project=>project.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(project=><li key={project.id}><button onClick={()=>onOpen(project.id)}><strong>{project.name}</strong><span>{project.revision?`正式修订 ${project.revision}`:'尚无正式模型'}{project.activeTasks?' · 有进行中任务或待验收候选':''}</span><small>更新于 {new Date(project.updatedAt).toLocaleString()}</small></button><details><summary>项目技术信息</summary><code>{project.id}</code></details></li>)}</ul>{!projects.length&&<p>创建项目后，可以导入 Python 工程、运行源码或与 Agent 对话。</p>}</main>;
}
