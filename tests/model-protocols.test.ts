import {test,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {ModelConfig,modelProtocol,readModelYaml} from '../gateway/model-config.ts';
import {normalizeProbeContext,cadToolSchemas} from '../gateway/pi-adapter.mjs';

test('version 1 settings migrate preserving credentials and limits, and approval restores on restart',()=>{
 const root=mkdtempSync(resolve('.work/protocol-migration-'));
 const initial={version:1,apiKey:'persisted-private-credential',provider:{protocol:'openai-completions',baseUrl:'https://example.com/v1',model:'local',contextWindow:262144,maxTokens:16384,contextSource:'default-256k',outputSource:'pi-custom-default'},configuredAt:new Date().toISOString()};
 const path=join(root,'model-settings.json');writeFileSync(path,JSON.stringify(initial));
 const config=new ModelConfig(root);expect((config.status() as any).provider).toEqual(initial.provider);
 expect(JSON.parse(readFileSync(path,'utf8')).version).toBe(3);expect(statSync(path).mode&0o777).toBe(0o600);
 expect(JSON.stringify(config.status())).not.toContain(initial.apiKey);
 writeFileSync(join(root,'approved.json'),'{}');new ModelConfig(root);
 expect(JSON.parse(readFileSync(join(root,'approved.json'),'utf8')).provider.protocol).toBe('openai-completions');
});

test('protocol import validates values and Pi probe transcript carries the real CAD declaration',()=>{
 const root=mkdtempSync(resolve('.work/protocol-yaml-')),path=join(root,'model.yaml');
 writeFileSync(path,'base_url: https://example.com/v1\napi_key: private\nmodel: local\nprotocol: openai-responses\n');
 expect(readModelYaml(path).protocol).toBe('openai-responses');expect(modelProtocol(undefined)).toBe('openai-completions');expect(()=>modelProtocol('bad')).toThrow();
 const context=normalizeProbeContext({messages:[],tools:[{name:'cad_inspect',description:'Inspect',parameters:cadToolSchemas.cad_inspect}]});
 expect(context.messages[0].toolsAdded[0].parameters).toEqual(cadToolSchemas.cad_inspect);
});
