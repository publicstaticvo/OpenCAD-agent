# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: advanced-assembly.spec.ts >> advanced model M1/M2 real two-part assembly acceptance
- Location: tests/live/advanced-assembly.spec.ts:22:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: '打开建模项目' })
Expected: visible
Timeout: 420000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('heading', { name: '打开建模项目' }) with timeout 420000ms
  - waiting for getByRole('heading', { name: '打开建模项目' })

```

```yaml
- main:
  - text: ◈ CAD 工作区
  - heading "配置模型服务" [level=1]
  - paragraph: 连接兼容 OpenAI 的模型服务。密钥由本机服务保存，用于发送建模请求。
  - text: 执行记录
  - combobox "执行记录":
    - option "关键执行记录" [selected]
    - option "完整执行记录（服务返回的推理与工具参数）"
  - text: API 协议
  - combobox "API 协议":
    - option "OpenAI Chat Completions" [selected]
    - option "OpenAI Responses"
  - text: 服务地址
  - textbox "服务地址":
    - /placeholder: https://服务地址/v1
    - text: https://zapi.deuo.top/v1
  - text: API key
  - textbox "API key":
    - /placeholder: 输入模型服务密钥
    - text: [REDACTED]
  - button "获取模型列表"
  - text: 选择模型
  - combobox "选择模型":
    - option "请选择模型" [disabled]
    - option "codex-auto-review"
    - option "gpt-5.6-sol" [selected]
    - option "gpt-6-astra"
    - option "gpt-6-sol"
    - option "gpt-6.1-sol"
    - option "gpt-image-2"
  - text: 模型 ID
  - textbox "模型 ID":
    - /placeholder: 也可以直接填写服务提供的模型 ID
    - text: gpt-5.6-sol
  - term: 上下文长度
  - definition: 262,144 tokens · 默认 256K
  - term: 单次输出上限
  - definition: 16,384 tokens · Pi 自定义模型默认值
  - term: 费用
  - definition: 未配置
  - group "超时设置（秒）":
    - text: 超时设置（秒） 获批执行超时（秒）
    - spinbutton "获批执行超时（秒）": "0"
    - text: 单次模型请求超时（秒）
    - spinbutton "单次模型请求超时（秒）": "0"
    - text: 单次 CAD 操作超时（秒）
    - spinbutton "单次 CAD 操作超时（秒）": "0"
    - text: 0 表示不设超时。获批执行计时覆盖执行开始至正式提交，规划、排队和等待批准不计入。保存后用于后续任务；模型请求设置同时用于获取模型列表和连接验证。仍可手动取消任务。
  - text: 保存将发送文本和只读 CAD 工具测试请求；验证通过后生效。单次输出上限用于每次响应，智能体可以继续多轮调用。
  - button "保存模型配置"
  - alert: openai-completions tool_result：协议或工具能力验证失败
```

# Test source

```ts
  1  | import {expect,test,type APIRequestContext,type Page} from '@playwright/test';
  2  | import {mkdirSync,writeFileSync} from 'node:fs';
  3  | import {execFileSync} from 'node:child_process';
  4  | import {resolve} from 'node:path';
  5  | import {parse} from 'yaml';
  6  | import {readFileSync} from 'node:fs';
  7  | 
  8  | const token='live-local-access-0123456789abcdef';
  9  | const headers={Authorization:`Bearer ${token}`};
  10 | const output=resolve('artifacts/live-assembly-advanced');
  11 | const m1Text='请创建一个由矩形底板和圆柱销组成的简单装配。底板长度60 mm、宽度40 mm、厚度8 mm，底面位于XY平面，在正中心开直径8 mm贯穿孔，孔中心(30,20)，孔轴沿Z方向。圆柱销直径7 mm、长度20 mm，轴线沿Z方向，装配位置x=30、y=20、z=0，从底部穿过中心孔，顶部延伸至z=20 mm。请先生成BOM和建模计划，等待批准后再开始CAD写入。';
  12 | const m2Text='请将当前装配中的圆柱销直径从7 mm修改为10 mm。保持底板60×40×8 mm、中心孔直径8 mm、底板位置、圆柱销长度20 mm、Z轴方向和位置(30,20,0)不变。请先生成新的结构化计划并等待批准。批准后执行真实CAD修改和装配检查；发现干涉时不得提交新的正式装配。';
  13 | 
  14 | async function json(request:APIRequestContext,path:string){const response=await request.get(path,{headers});expect(response.ok()).toBeTruthy();return response.json();}
  15 | async function job(request:APIRequestContext,id:string,operationId:string){return json(request,`/api/documents/${id}/jobs/${operationId}`);}
  16 | async function waitStatus(request:APIRequestContext,id:string,operationId:string,status:string,timeout=900000){await expect.poll(async()=>{return(await job(request,id,operationId)).status;},{timeout,intervals:[1000]}).toBe(status);return job(request,id,operationId);}
  17 | async function approve(request:APIRequestContext,id:string,operationId:string,planHash:string){const response=await request.post(`/api/documents/${id}/jobs/${operationId}/approve`,{headers,data:{planHash}});expect(response.ok()).toBeTruthy();}
  18 | async function saveArtifact(request:APIRequestContext,id:string,revision:number,name:string){const snapshot=await json(request,`/api/documents/${id}`);const response=await request.get(snapshot.artifacts[name],{headers});expect(response.ok()).toBeTruthy();const path=resolve(output,`m1-${name}`);writeFileSync(path,await response.body());return path;}
> 19 | async function configure(page:Page){const parsed=parse(readFileSync(process.env.CAD_MODEL_CONFIG||'advanced-model.yaml','utf8')),yaml=parsed.test_llm??parsed;await page.goto('/');await page.getByLabel('访问密钥').fill(token);await page.getByRole('button',{name:'连接工作区'}).click();await expect(page.getByRole('heading',{name:'配置模型服务'})).toBeVisible();await page.getByLabel('API 协议',{exact:true}).selectOption(yaml.protocol??'openai-completions');await page.getByLabel('服务地址').fill(yaml.base_url);await page.getByLabel('API key',{exact:true}).fill(yaml.api_key);await page.getByRole('button',{name:'获取模型列表'}).click();await page.getByLabel('选择模型').selectOption(yaml.model);await page.getByRole('button',{name:'保存模型配置'}).click();await expect(page.getByRole('heading',{name:'打开建模项目'})).toBeVisible({timeout:420000});}
     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         ^ Error: expect(locator).toBeVisible() failed
  20 | async function events(request:APIRequestContext,id:string,operationId:string){return json(request,`/api/documents/${id}/jobs/${operationId}/events?afterSeq=0&limit=200`);}
  21 | 
  22 | test('advanced model M1/M2 real two-part assembly acceptance',async({page,request},info)=>{
  23 |  test.setTimeout(3600000);mkdirSync(output,{recursive:true});
  24 |  await configure(page);
  25 |  const created=await (await request.post('/api/documents',{headers,data:{id:`advanced-assembly-${Date.now()}`}})).json();const id=created.documentId;
  26 |  await page.goto(`/?document=${encodeURIComponent(id)}`);await expect(page.getByRole('heading',{name:'建模对话'})).toBeVisible();
  27 |  await page.getByLabel('建模指令').fill(m1Text);await page.getByRole('button',{name:'发送任务',exact:true}).click();
  28 |  const planLocator=page.getByTestId('approval-plan');await expect(planLocator).toContainText('双零件装配',{timeout:900000});
  29 |  const first=await json(request,`/api/documents/${id}`);const m1=first.jobs.at(-1);expect(m1.status).toBe('awaiting_approval');expect(m1.plan.kind).toBe('pin_plate_assembly');expect(m1.plan.assembly).toMatchObject({length:60,width:40,thickness:8,holeDiameter:8,pinDiameter:7,pinLength:20});
  30 |  writeFileSync(resolve(output,'m1-plan.json'),JSON.stringify({request:m1Text,plan:m1.plan},null,2));await page.screenshot({path:resolve(output,'m1-plan.png'),fullPage:true});
  31 |  await approve(request,id,m1.operationId,m1.plan.planHash);const committed=await waitStatus(request,id,m1.operationId,'committed');expect(committed.result.revision).toBe(1);
  32 |  const snapshot=await json(request,`/api/documents/${id}`),validation=snapshot.validation;expect(snapshot.revision).toBe(1);expect(validation.assembly.bom).toHaveLength(2);expect(validation.assembly.components).toHaveLength(2);expect(validation.assembly.interference.status).toBe('clear');expect(validation.assembly.interference.pairs[0].volume).toBeLessThan(1e-7);expect(validation.bbox).toEqual([60,40,20]);expect(validation.solids).toBe(2);expect(validation.step.solids).toBe(2);expect(validation.glb.meshes).toBe(2);expect(validation.assembly.components[0].position).toEqual([0,0,0]);expect(validation.assembly.components[1].position).toEqual([30,20,0]);
  33 |  writeFileSync(resolve(output,'m1-validation.json'),JSON.stringify({revision:snapshot.revision,validation,tree:snapshot.tree},null,2));writeFileSync(resolve(output,'m1-events.json'),JSON.stringify(await events(request,id,m1.operationId),null,2));
  34 |  const fcstd=await saveArtifact(request,id,1,'model.FCStd'),step=await saveArtifact(request,id,1,'model.step'),glb=await saveArtifact(request,id,1,'preview.glb');const native=execFileSync('python',['scripts/verify-live-assembly-downloads.py',fcstd,step,glb],{cwd:resolve('.'),encoding:'utf8',timeout:60000});writeFileSync(resolve(output,'m1-native-download-check.json'),native);expect(native).toContain('advanced-assembly-downloads: passed');
  35 |  await page.reload();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');await page.screenshot({path:resolve(output,'m1-committed.png'),fullPage:true});
  36 |  await page.getByLabel('建模指令').fill(m2Text);await page.getByRole('button',{name:'发送任务',exact:true}).click();await expect(planLocator).toContainText('双零件装配',{timeout:900000});
  37 |  const secondPending=await json(request,`/api/documents/${id}`),m2=secondPending.jobs.at(-1);expect(m2.status).toBe('awaiting_approval');expect(m2.plan.assembly).toMatchObject({length:60,width:40,thickness:8,holeDiameter:8,pinDiameter:10,pinLength:20});writeFileSync(resolve(output,'m2-plan.json'),JSON.stringify({request:m2Text,plan:m2.plan},null,2));await approve(request,id,m2.operationId,m2.plan.planHash);const failed=await waitStatus(request,id,m2.operationId,'failed');expect(failed.error).toBeTruthy();
  38 |  const after=await json(request,`/api/documents/${id}`),m2Events=await events(request,id,m2.operationId),collision=m2Events.events.find((event:any)=>event.type==='cad_progress'&&event.data?.stage==='interference');expect(after.revision).toBe(1);expect(after.validation.assembly.components[1].partId).toBe('pin');expect(after.validation.assembly.bom.find((part:any)=>part.partId==='pin').parameters.PinOutline.diameter).toBe(7);expect(collision).toBeTruthy();expect(collision.data.report.status).toBe('collision');expect(collision.data.report.pairs[0].components).toEqual(['PlateComponent','PinComponent']);expect(collision.data.report.pairs[0].volume).toBeCloseTo(72*Math.PI,5);writeFileSync(resolve(output,'m2-validation.json'),JSON.stringify({revision:after.revision,job:failed,error:failed.error,collision:collision.data.report,formalValidation:after.validation},null,2));writeFileSync(resolve(output,'m2-events.json'),JSON.stringify(m2Events,null,2));
  39 |  await page.reload();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');await page.locator('.execution-activity').last().locator('summary').first().click();await expect(page.locator('.execution-activity').last()).toContainText('226.194');await expect(page.getByTestId('job-error')).toContainText('正式模型未改变');await page.screenshot({path:resolve(output,'m2-failed.png'),fullPage:true});
  40 | });
  41 | 
```