/** Public error descriptions exclude untrusted provider response bodies and credentials. */
export function describeModelFailure(message:{stopReason?:string;errorMessage?:string}):string{
 const status=message.errorMessage?.match(/^(?:\s*|openai-(?:completions|responses) model_request HTTP |模型服务返回 HTTP |cad-configured API error \()(\d{3})(?=\)|\s|:|，|；|$)/)?.[1];
 if(message.stopReason==='aborted')return '模型请求已终止；未提交正式模型。';
 const prefix=status?`模型服务返回 HTTP ${status}`:'模型请求或响应处理失败';
 const reason=status&&['502','503','504'].includes(status)?'，服务或上游暂时不可用':status&&['401','403'].includes(status)?'，请检查模型服务的密钥与访问权限':'';
 return `${prefix}${reason}；未提交正式模型。`;
}
export function publicModelMessage<T extends {role?:string;stopReason?:string;errorMessage?:string}>(message:T):T{
 const copy=structuredClone(message);
 if(copy.role==='assistant'&&copy.errorMessage)copy.errorMessage=describeModelFailure(copy);
 return copy;
}
