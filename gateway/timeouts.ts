import {StoreError} from './revision-store.ts';
export interface TimeoutSettings {taskSeconds:number;requestSeconds:number;cadSeconds:number}
export const defaultTimeouts:Readonly<TimeoutSettings>={taskSeconds:0,requestSeconds:0,cadSeconds:0};
export function timeoutSettings(value:unknown=defaultTimeouts):TimeoutSettings{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!Object.hasOwn(defaultTimeouts,key)))throw new StoreError('invalid','超时设置字段无效');
 const result={...defaultTimeouts,...value};
 for(const [key,seconds] of Object.entries(result))if(!Number.isSafeInteger(seconds)||seconds<0||seconds>2147483)throw new StoreError('invalid',`${key} 必须为 0–2147483 的整数秒，0 表示不设超时`);
 return result;
}
