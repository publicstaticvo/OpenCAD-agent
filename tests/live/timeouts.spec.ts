import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {execFileSync} from 'node:child_process';

const token='live-local-access-0123456789abcdef',headers={Authorization:`Bearer ${token}`};
for(const protocol of ['openai-completions','openai-responses'] as const){
 test(`timeout settings persist and real ${protocol} requests complete, expire and cancel`,async({page,request})=>{
  page.on('pageerror',error=>console.log('timeout-settings browser error:',error.message));
  page.on('response',response=>{if(['/api/model-config','/api/session'].includes(new URL(response.url()).pathname))console.log('timeout-settings HTTP',new URL(response.url()).pathname,response.status());});
  const parsed=parse(readFileSync(process.env.CAD_MODEL_CONFIG||'advanced-model.yaml','utf8')),yaml=parsed.test_llm??parsed;
  const input={baseUrl:yaml.base_url,apiKey:yaml.api_key,model:yaml.model};
  await page.goto('/');await page.getByLabel('访问密钥').fill(token);await page.getByRole('button',{name:'连接工作区'}).click();
  const configured=await(await request.get('/api/model-config',{headers})).json();
  if(configured.configured){await page.getByRole('button',{name:'创建空白项目'}).click();await page.getByRole('button',{name:'模型设置',exact:true}).click();}
  await expect(page.getByRole('heading',{name:'配置模型服务'})).toBeVisible();
  const fields=['整个任务超时（秒）','单次模型请求超时（秒）','单次 CAD 操作超时（秒）'];
  if(!configured.configured)for(const label of fields)await expect(page.getByLabel(label,{exact:true})).toHaveValue('0');
  await page.getByLabel('API 协议',{exact:true}).selectOption(protocol);
  await page.getByLabel('服务地址').fill(input.baseUrl);await page.getByLabel('API key',{exact:true}).fill(input.apiKey);await page.getByLabel('模型 ID',{exact:true}).fill(input.model);
  const values=protocol==='openai-completions'?[0,0,0]:[600,60,60];
  for(let i=0;i<fields.length;i++)await page.getByLabel(fields[i],{exact:true}).fill(String(values[i]));
  await page.getByRole('button',{name:'保存模型配置'}).click();
  console.log(`timeout-settings: ${protocol} save requested`);
  await expect.poll(async()=>await page.getByRole('alert').count()?'error':await page.getByRole('heading',{name:'配置模型服务'}).count()?'pending':'saved',{timeout:90000}).not.toBe('pending');
  await expect(page.getByRole('alert')).toHaveCount(0);
  console.log(`timeout-settings: ${protocol} saved`);
  const saved=await(await request.get('/api/model-config',{headers})).json();expect(saved.timeouts).toEqual({taskSeconds:values[0],requestSeconds:values[1],cadSeconds:values[2]});
  if(!configured.configured)await page.getByRole('button',{name:'创建空白项目'}).click();
  await expect(page.getByRole('button',{name:'模型设置',exact:true})).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'模型设置',exact:true}).click();
  for(let i=0;i<fields.length;i++)await expect(page.getByLabel(fields[i],{exact:true})).toHaveValue(String(values[i]));
  console.log(`timeout-settings: ${protocol} restored after refresh`);
  const invalid=await request.post('/api/model-config',{headers,data:{...input,protocol,timeouts:{requestSeconds:-1}}});expect(invalid.status()).toBe(400);
  expect((await(await request.get('/api/model-config',{headers})).json()).timeouts).toEqual(saved.timeouts);
  expect(execFileSync(process.execPath,['--import','tsx','scripts/verify-model-timeouts.ts',process.env.CAD_MODEL_CONFIG||'advanced-model.yaml',protocol],{encoding:'utf8',timeout:300000})).toContain('model-timeouts: passed');
 });
}
