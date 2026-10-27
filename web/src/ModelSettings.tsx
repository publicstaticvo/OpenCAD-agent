import {useEffect,useState} from 'react';
import type {Api} from './api.ts';
type Limits={id:string;contextWindow:number;maxTokens:number;contextSource:string;outputSource:string};
const sources:Record<string,string>={service:'服务返回', 'pi-catalog':'Pi 模型目录','default-256k':'默认 256K','pi-custom-default':'Pi 自定义模型默认值'};
export function ModelSettings({api,onDone}:{api:Api;onDone:()=>void}){
 const [baseUrl,setBaseUrl]=useState(''),[apiKey,setApiKey]=useState(''),[model,setModel]=useState(''),[models,setModels]=useState<Limits[]>([]),[configured,setConfigured]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [protocol,setProtocol]=useState('openai-completions');
 const [timeouts,setTimeouts]=useState({taskSeconds:0,requestSeconds:0,cadSeconds:0});
 const [display,setDisplay]=useState(()=>localStorage.getItem('cad-progress-display')??'key');
 useEffect(()=>{let active=true;api.json('/api/model-config').then(data=>{if(!active)return;setConfigured(data.configured);setTimeouts(data.timeouts);if(data.configured){setProtocol(data.provider.protocol);setBaseUrl(data.provider.baseUrl);setModel(data.provider.model);setModels([{id:data.provider.model,...data.provider}]);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[api]);
 const selected=models.find(m=>m.id===model);
 async function discover(){setBusy(true);setError('');try{const data=await api.json('/api/model-config/discover',{baseUrl,apiKey,protocol,timeouts});setBaseUrl(data.baseUrl);setModels(data.models);setModel(data.models.some((m:Limits)=>m.id===model)?model:data.models[0].id);}catch(e){setError((e as Error).message+'；可以直接填写模型 ID 后验证保存。');}finally{setBusy(false);}}
 async function save(){setBusy(true);setError('');try{await api.json('/api/model-config',{baseUrl,apiKey,model,protocol,timeouts});setApiKey('');await api.session();onDone();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <main className="login model-settings"><div className="login-brand">◈ CAD 工作区</div><h1>配置模型服务</h1><p>连接兼容 OpenAI 的模型服务。密钥由本机服务保存，用于发送建模请求。</p>
 <form onSubmit={e=>{e.preventDefault();void save();}}>
 <label>执行记录<select aria-label="执行记录" value={display} onChange={e=>{setDisplay(e.target.value);localStorage.setItem('cad-progress-display',e.target.value);}}><option value="key">关键执行记录</option><option value="full">完整执行记录（服务返回的推理与工具参数）</option></select></label>
 <label>API 协议<select aria-label="API 协议" value={protocol} disabled={busy||loading} onChange={e=>setProtocol(e.target.value)}><option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option></select></label>
 <label>服务地址<input aria-label="服务地址" type="url" placeholder="https://服务地址/v1" value={baseUrl} disabled={busy||loading} onChange={e=>{setBaseUrl(e.target.value);setModels([]);setModel('');}} required/></label>
 <label>API key<input aria-label="API key" type="password" autoComplete="off" placeholder={configured?'已保存；留空继续使用当前服务的密钥':'输入模型服务密钥'} value={apiKey} disabled={busy||loading} onChange={e=>{setApiKey(e.target.value);setModels([]);setModel('');}}/></label>
 <button type="button" onClick={()=>void discover()} disabled={busy||loading||!baseUrl.trim()}>获取模型列表</button>
 <label>选择模型<select aria-label="选择模型" value={model} disabled={busy||!models.length} onChange={e=>setModel(e.target.value)}><option value="" disabled>请选择模型</option>{models.map(m=><option key={m.id} value={m.id}>{m.id}</option>)}</select></label>
 <label>模型 ID<input aria-label="模型 ID" value={model} maxLength={256} disabled={busy||loading} onChange={e=>setModel(e.target.value)} placeholder="也可以直接填写服务提供的模型 ID" required/></label>
 {selected&&<dl className="model-limits"><dt>上下文长度</dt><dd>{selected.contextWindow.toLocaleString()} tokens · {sources[selected.contextSource]}</dd><dt>单次输出上限</dt><dd>{selected.maxTokens.toLocaleString()} tokens · {sources[selected.outputSource]}</dd><dt>费用</dt><dd>未配置</dd></dl>}
 <fieldset disabled={busy||loading}><legend>超时设置（秒）</legend>{([['taskSeconds','整个任务超时（秒）'],['requestSeconds','单次模型请求超时（秒）'],['cadSeconds','单次 CAD 操作超时（秒）']] as const).map(([key,label])=><label key={key}>{label}<input aria-label={label} type="number" min="0" max="2147483" step="1" required value={timeouts[key]} onChange={e=>setTimeouts({...timeouts,[key]:Number(e.target.value)})}/></label>)}<small>0 表示不设超时。保存后用于后续任务；模型请求设置同时用于获取模型列表和连接验证。仍可手动取消任务。</small></fieldset>
 <small>保存将发送文本和只读 CAD 工具测试请求；验证通过后生效。单次输出上限用于每次响应，智能体可以继续多轮调用。</small>
 <button className="primary" disabled={busy||loading||!model}>{busy?'正在连接…':'保存模型配置'}</button>
 {configured&&<button type="button" disabled={busy} onClick={onDone}>返回工作区</button>}
 </form>{error&&<p role="alert">{error}</p>}</main>;
}
