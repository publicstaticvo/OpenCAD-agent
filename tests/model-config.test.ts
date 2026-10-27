import {expect,test} from 'vitest';
import {mkdtempSync,existsSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {ModelConfig,normalizeBaseUrl,resolveModelLimits} from '../gateway/model-config.ts';

test('normalizes OpenAI compatible roots and rejects credential-bearing URLs',()=>{
 expect(normalizeBaseUrl('https://uni-api.cstcloud.cn')).toBe('https://uni-api.cstcloud.cn/v1');
 expect(normalizeBaseUrl('http://127.0.0.1:8000/v1/')).toBe('http://127.0.0.1:8000/v1');
 expect(()=>normalizeBaseUrl('https://user:secret@example.com')).toThrow();
 expect(()=>normalizeBaseUrl('https://example.com/?key=secret')).toThrow();
});
test('uses service metadata and bounds per-response output to the context',()=>{
 expect(resolveModelLimits({id:'local',context_length:32000,max_output_tokens:4000})).toMatchObject({contextWindow:32000,maxTokens:4000,contextSource:'service',outputSource:'service'});
 expect(resolveModelLimits({id:'local'})).toMatchObject({contextWindow:262144,maxTokens:16384,contextSource:'default-256k',outputSource:'pi-custom-default'});
 expect(resolveModelLimits({id:'small',context_length:8000})).toMatchObject({contextWindow:8000,maxTokens:3904});
 expect(()=>resolveModelLimits({id:'local',context_length:-1})).toThrow();
});
test('unconfigured service fails before running and never exposes credentials through its status',()=>{
 const dir=mkdtempSync(resolve('.work/config-'));
 const config=new ModelConfig(dir);
 expect(config.status()).toEqual({configured:false,timeouts:{taskSeconds:0,requestSeconds:0,cadSeconds:0}});
 expect(()=>config.provider()).toThrow(/配置/);
});
test('rejects corrupted persisted settings at startup',()=>{
 const dir=mkdtempSync(resolve('.work/config-'));
 writeFileSync(join(dir,'model-settings.json'),JSON.stringify({version:1,apiKey:'private',provider:{baseUrl:'bad'}}));
 expect(()=>new ModelConfig(dir)).toThrow();
});
test('removes an approval record left without authoritative settings',()=>{
 const dir=mkdtempSync(resolve('.work/config-'));
 writeFileSync(join(dir,'approved.json'),JSON.stringify({version:1,approved:true}));
 expect(new ModelConfig(dir).status()).toEqual({configured:false,timeouts:{taskSeconds:0,requestSeconds:0,cadSeconds:0}});
 expect(existsSync(join(dir,'approved.json'))).toBe(false);
});
