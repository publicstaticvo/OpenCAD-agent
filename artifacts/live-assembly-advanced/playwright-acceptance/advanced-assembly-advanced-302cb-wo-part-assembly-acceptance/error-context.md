# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: advanced-assembly.spec.ts >> advanced model M1/M2 real two-part assembly acceptance
- Location: tests/live/advanced-assembly.spec.ts:45:1

# Error details

```
Error: expect(received).toBeTruthy()

Received: false
```

# Page snapshot

```yaml
- generic [ref=f2e3]:
  - banner [ref=f2e4]:
    - generic [ref=f2e5]: ◈
    - heading "CAD 工作区" [level=1] [ref=f2e6]
    - generic [ref=f2e7]:
      - text: 项目
      - combobox "切换项目" [ref=f2e8]:
        - option "advanced-assembly-1793292508910" [selected]
        - option "advanced-assembly-1793291915818"
    - button "新建项目" [ref=f2e9] [cursor=pointer]
    - button "项目重命名" [ref=f2e10] [cursor=pointer]
    - generic [ref=f2e11]: 已连接
    - button "模型设置" [ref=f2e12] [cursor=pointer]
    - button "刷新状态" [ref=f2e13] [cursor=pointer]
    - button "退出" [ref=f2e14] [cursor=pointer]
  - generic [ref=f2e15]:
    - complementary [ref=f2e16]:
      - heading "模型历史" [level=2] [ref=f2e17]
      - paragraph [ref=f2e18]: 正式修订 1 · mm
      - navigation "特征树" [ref=f2e19]:
        - button "底板 主体" [ref=f2e20] [cursor=pointer]:
          - generic [ref=f2e21]: ◇
          - generic [ref=f2e22]: 底板
          - generic [ref=f2e23]: 主体
        - button "PlateOutline 草图" [ref=f2e24] [cursor=pointer]:
          - generic [ref=f2e25]: ▱
          - generic [ref=f2e26]: PlateOutline
          - generic [ref=f2e27]: 草图
        - button "PlatePad 拉伸" [ref=f2e28] [cursor=pointer]:
          - generic [ref=f2e29]: ◇
          - generic [ref=f2e30]: PlatePad
          - generic [ref=f2e31]: 拉伸
        - button "PlateHole 草图" [ref=f2e32] [cursor=pointer]:
          - generic [ref=f2e33]: ▱
          - generic [ref=f2e34]: PlateHole
          - generic [ref=f2e35]: 草图
        - button "PlatePocket 切除" [ref=f2e36] [cursor=pointer]:
          - generic [ref=f2e37]: ⊖
          - generic [ref=f2e38]: PlatePocket
          - generic [ref=f2e39]: 切除
        - button "圆柱销 主体" [ref=f2e40] [cursor=pointer]:
          - generic [ref=f2e41]: ◇
          - generic [ref=f2e42]: 圆柱销
          - generic [ref=f2e43]: 主体
        - button "PinOutline 草图" [ref=f2e44] [cursor=pointer]:
          - generic [ref=f2e45]: ▱
          - generic [ref=f2e46]: PinOutline
          - generic [ref=f2e47]: 草图
        - button "PinPad 拉伸" [ref=f2e48] [cursor=pointer]:
          - generic [ref=f2e49]: ◇
          - generic [ref=f2e50]: PinPad
          - generic [ref=f2e51]: 拉伸
        - button "固定关节装配 装配" [ref=f2e52] [cursor=pointer]:
          - generic [ref=f2e53]: ◇
          - generic [ref=f2e54]: 固定关节装配
          - generic [ref=f2e55]: 装配
        - button "底板组件 组件" [ref=f2e56] [cursor=pointer]:
          - generic [ref=f2e57]: ◇
          - generic [ref=f2e58]: 底板组件
          - generic [ref=f2e59]: 组件
        - button "圆柱销组件 组件" [ref=f2e60] [cursor=pointer]:
          - generic [ref=f2e61]: ◇
          - generic [ref=f2e62]: 圆柱销组件
          - generic [ref=f2e63]: 组件
      - generic [ref=f2e64]:
        - heading "特征属性" [level=2] [ref=f2e65]
        - paragraph [ref=f2e66]: 从左侧选择一个特征。
        - paragraph [ref=f2e67]: 属性修改作为建模任务提交，经候选验收后生效。历史版本、断线及加载期间禁止修改。
      - generic [ref=f2e68]:
        - button "下载 FCStd" [ref=f2e69] [cursor=pointer]
        - button "下载 STEP" [ref=f2e70] [cursor=pointer]
        - button "下载 GLB" [ref=f2e71] [cursor=pointer]
        - generic [ref=f2e72]: 下载所显示的完整版本 1
    - region "模型视口" [ref=f2e73]:
      - generic [ref=f2e74]:
        - strong [ref=f2e75]: 正式版本 1
        - generic [ref=f2e76]:
          - text: 修订
          - combobox "查看修订" [ref=f2e77]:
            - option "当前正式版本" [selected]
            - option "修订 1"
        - button "查看修改前" [disabled] [ref=f2e78]
      - generic [ref=f2e79]:
        - generic [ref=f2e80]:
          - button "立体" [pressed] [ref=f2e81] [cursor=pointer]
          - button "俯视" [ref=f2e82] [cursor=pointer]
        - generic "三维模型" [ref=f2e84]
        - generic "WebGL 2.0 (OpenGL ES 3.0 Chromium) · ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)": WebGL · 1252 三角面
        - generic:
          - text: X → Y ↗ Z ↑
          - generic: 模型尺寸以毫米显示
      - group [ref=f2e85]:
        - generic "正式修订 1 · 装配组件、BOM 与干涉报告" [ref=f2e86] [cursor=pointer]
      - generic [ref=f2e87]:
        - text: 选择特征查看参数
        - generic [ref=f2e88]: 正式模型与候选预览分别标识
    - complementary [ref=f2e89]:
      - generic [ref=f2e90]:
        - generic [ref=f2e91]:
          - heading "建模对话" [level=2] [ref=f2e92]
          - generic [ref=f2e93]: 模型服务已连接 · 每次任务需要批准
          - generic [ref=f2e94]:
            - text: 当前对话
            - combobox "切换对话" [ref=f2e95]:
              - option "选择对话" [disabled]
              - option "建模对话" [selected]
          - generic [ref=f2e96]:
            - button "新建对话" [ref=f2e97] [cursor=pointer]
            - button "对话重命名" [ref=f2e98] [cursor=pointer]
          - paragraph [ref=f2e99]: 本项目的所有对话共享当前模型和修订记录。
          - group [ref=f2e100]:
            - generic "显示设置与建模示例" [ref=f2e101] [cursor=pointer]
            - option "关键执行记录" [selected]
            - option "完整执行记录"
        - generic "对话历史" [ref=f2e102]:
          - generic [ref=f2e103]:
            - article [ref=f2e104]:
              - strong [ref=f2e105]: 请创建一个由矩形底板和圆柱销组成的简单装配。底板长度60 mm、宽度40 mm、厚度8 mm，底面位于XY平面，在正中心开直径8 mm贯穿孔，孔中心(30,20)，孔轴沿Z方向。圆柱销直径7 mm、长度20 mm，轴线沿Z方向，装配位置x=30、y=20、z=0，从底部穿过中心孔，顶部延伸至z=20 mm。请先生成BOM和建模计划，等待批准后再开始CAD写入。
              - generic [ref=f2e106]: 已提交
              - generic [ref=f2e107]: 基于版本 0 · 0b50ed6b
              - paragraph [ref=f2e108]: 我先检查当前 CAD 文档状态，确认项目是否为空以及是否存在需要保留的装配对象；随后给出 BOM 和待审批的建模参数。此阶段只做读取与计划，不执行 CAD 写入。
              - paragraph [ref=f2e109]: 当前文档为空（revision 0，树中无对象），满足新建该装配的前提。BOM 为 1 件矩形底板与 1 件圆柱销；我现在提交完整的装配建模计划供你审批，仍不会写入 CAD。
              - paragraph [ref=f2e110]: 已完成初始状态检查，并按批准方案写入底板及中心贯穿孔。接下来继续严格按批准顺序写入圆柱销和固定装配，然后进行几何检查与最终验收。
              - group [ref=f2e111]:
                - generic "CAD 执行记录 · 已提交" [ref=f2e112] [cursor=pointer]
              - generic [ref=f2e113]: 工具调用 6 次 · live
              - paragraph [ref=f2e114]: FreeCAD 验收通过，正式版本 1 已保存。
            - article [ref=f2e115]:
              - strong [ref=f2e116]: 请将当前装配中的圆柱销直径从7 mm修改为10 mm。保持底板60×40×8 mm、中心孔直径8 mm、底板位置、圆柱销长度20 mm、Z轴方向和位置(30,20,0)不变。请先生成新的结构化计划并等待批准。批准后执行真实CAD修改和装配检查；发现干涉时不得提交新的正式装配。
              - generic [ref=f2e117]: 失败
              - generic [ref=f2e118]: 基于版本 1 · 3eda9a68
              - paragraph [ref=f2e119]: 当前正式快照确认装配仍为 revision 1，销直径为 7 mm，其余指定尺寸和位置与要求一致。我会按“仅修改销直径”的规则提交结构化编辑计划；按给定尺寸，10 mm 销大于 8 mm 孔径，存在 1 mm 的径向重叠风险，计划获批后必须先检查干涉，若干涉则不提交为正式装配。
              - group [ref=f2e120]:
                - generic "CAD 执行记录 · 失败" [ref=f2e121] [cursor=pointer]
              - alert [ref=f2e122]: 候选建模或验收失败，请查看详情并调整请求。 正式模型未改变。
              - group [ref=f2e123]:
                - generic "技术详情" [ref=f2e124] [cursor=pointer]
              - generic [ref=f2e125]: 工具调用 2 次 · live
              - button "重试任务" [ref=f2e126] [cursor=pointer]
        - generic [ref=f2e127]:
          - textbox "建模指令" [ref=f2e128]:
            - /placeholder: 描述尺寸、孔位与建模要求…
          - generic [ref=f2e129]:
            - generic [ref=f2e130]: 候选通过验收后提交正式模型
            - button "发送任务" [disabled] [ref=f2e131]
```

# Test source

```ts
  1  | import {expect,test,type APIRequestContext,type Page} from '@playwright/test';
  2  | import {mkdirSync,writeFileSync} from 'node:fs';
  3  | import {execFileSync} from 'node:child_process';
  4  | import {resolve} from 'node:path';
  5  | import {createHash} from 'node:crypto';
  6  | import {parse} from 'yaml';
  7  | import {readFileSync} from 'node:fs';
  8  | 
  9  | const token='live-local-access-0123456789abcdef';
  10 | const headers={Authorization:`Bearer ${token}`};
  11 | const output=resolve('artifacts/live-assembly-advanced');
  12 | const m1Text='请创建一个由矩形底板和圆柱销组成的简单装配。底板长度60 mm、宽度40 mm、厚度8 mm，底面位于XY平面，在正中心开直径8 mm贯穿孔，孔中心(30,20)，孔轴沿Z方向。圆柱销直径7 mm、长度20 mm，轴线沿Z方向，装配位置x=30、y=20、z=0，从底部穿过中心孔，顶部延伸至z=20 mm。请先生成BOM和建模计划，等待批准后再开始CAD写入。';
  13 | const m2Text='请将当前装配中的圆柱销直径从7 mm修改为10 mm。保持底板60×40×8 mm、中心孔直径8 mm、底板位置、圆柱销长度20 mm、Z轴方向和位置(30,20,0)不变。请先生成新的结构化计划并等待批准。批准后执行真实CAD修改和装配检查；发现干涉时不得提交新的正式装配。';
  14 | 
  15 | async function json(request:APIRequestContext,path:string){const response=await request.get(path,{headers});expect(response.ok()).toBeTruthy();return response.json();}
  16 | async function job(request:APIRequestContext,id:string,operationId:string){return json(request,`/api/documents/${id}/jobs/${operationId}`);}
  17 | async function waitStatus(request:APIRequestContext,id:string,operationId:string,status:string,timeout=900000){await expect.poll(async()=>{return(await job(request,id,operationId)).status;},{timeout,intervals:[1000]}).toBe(status);return job(request,id,operationId);}
  18 | async function approve(request:APIRequestContext,id:string,operationId:string,planHash:string){const response=await request.post(`/api/documents/${id}/jobs/${operationId}/approve`,{headers,data:{planHash}});expect(response.ok()).toBeTruthy();}
  19 | async function saveArtifact(request:APIRequestContext,id:string,revision:number,name:string){const snapshot=await json(request,`/api/documents/${id}`);const response=await request.get(snapshot.artifacts[name],{headers});expect(response.ok()).toBeTruthy();const path=resolve(output,`m1-${name}`);writeFileSync(path,await response.body());return path;}
  20 | async function configure(page:Page){
  21 |  const parsed=parse(readFileSync(process.env.CAD_MODEL_CONFIG||'advanced-model.yaml','utf8')),yaml=parsed.test_llm??parsed;
  22 |  const status=await json(page.request,'/api/model-config');
  23 |  if(status.configured){
  24 |   expect(status.provider.model).toBe(yaml.model);
  25 |   expect(status.provider.protocol).toBe(yaml.protocol??'openai-completions');
  26 |  }else{
  27 |   const response=await page.request.post('/api/model-config',{headers,data:{baseUrl:yaml.base_url,apiKey:yaml.api_key,model:yaml.model,protocol:yaml.protocol??'openai-completions'}});
  28 |   const result=await response.json();
  29 |   writeFileSync(resolve(output,'configuration-check.json'),JSON.stringify({status:response.status(),configured:result.configured,error:result.error},null,2));
  30 |   expect(response.ok(),'真实模型配置及协议验证').toBeTruthy();
  31 |  }
  32 |  await page.goto('/');await page.getByLabel('访问密钥').fill(token);await page.getByRole('button',{name:'连接工作区'}).click();
  33 |  await expect(page.getByRole('heading',{name:'打开建模项目'})).toBeVisible();
  34 | }
  35 | async function events(request:APIRequestContext,id:string,operationId:string){return json(request,`/api/documents/${id}/jobs/${operationId}/events?afterSeq=0&limit=200`);}
  36 | async function artifactHashes(request:APIRequestContext,snapshot:any){
  37 |  const hashes:Record<string,string>={};
  38 |  for(const name of ['model.FCStd','model.step','preview.glb']){
  39 |   const response=await request.get(snapshot.artifacts[name],{headers});expect(response.ok()).toBeTruthy();
  40 |   hashes[name]=createHash('sha256').update(await response.body()).digest('hex');
  41 |  }
  42 |  return hashes;
  43 | }
  44 | 
  45 | test('advanced model M1/M2 real two-part assembly acceptance',async({page,request},info)=>{
  46 |  test.setTimeout(3600000);mkdirSync(output,{recursive:true});
  47 |  await configure(page);
  48 |  const created=await (await request.post('/api/documents',{headers,data:{id:`advanced-assembly-${Date.now()}`}})).json();const id=created.documentId;
  49 |  await page.goto(`/?document=${encodeURIComponent(id)}`);await expect(page.getByRole('heading',{name:'建模对话'})).toBeVisible();
  50 |  await page.getByLabel('建模指令').fill(m1Text);await page.getByRole('button',{name:'发送任务',exact:true}).click();
  51 |  const planLocator=page.getByTestId('approval-plan');await expect(planLocator).toContainText('双零件装配',{timeout:900000});
  52 |  const first=await json(request,`/api/documents/${id}`);const m1=first.jobs.at(-1);expect(m1.status).toBe('awaiting_approval');expect(m1.plan.kind).toBe('pin_plate_assembly');expect(m1.plan.assembly).toMatchObject({length:60,width:40,thickness:8,holeDiameter:8,pinDiameter:7,pinLength:20});
  53 |  writeFileSync(resolve(output,'m1-plan.json'),JSON.stringify({request:m1Text,plan:m1.plan},null,2));await page.screenshot({path:resolve(output,'m1-plan.png'),fullPage:true});
  54 |  await approve(request,id,m1.operationId,m1.plan.planHash);const committed=await waitStatus(request,id,m1.operationId,'committed');expect(committed.result.revision).toBe(1);
  55 |  const snapshot=await json(request,`/api/documents/${id}`),validation=snapshot.validation;expect(snapshot.revision).toBe(1);expect(validation.assembly.bom).toHaveLength(2);expect(validation.assembly.components).toHaveLength(2);expect(validation.assembly.interference.status).toBe('clear');expect(validation.assembly.interference.pairs[0].volume).toBeLessThan(1e-7);expect(validation.bbox).toEqual([60,40,20]);expect(validation.solids).toBe(2);expect(validation.step.solids).toBe(2);expect(validation.glb.meshes).toBe(2);expect(validation.assembly.components[0].position).toEqual([0,0,0]);expect(validation.assembly.components[1].position).toEqual([30,20,0]);
  56 |  writeFileSync(resolve(output,'m1-validation.json'),JSON.stringify({revision:snapshot.revision,validation,tree:snapshot.tree},null,2));writeFileSync(resolve(output,'m1-events.json'),JSON.stringify(await events(request,id,m1.operationId),null,2));
  57 |  const beforeHashes=await artifactHashes(request,snapshot);
  58 |  const fcstd=await saveArtifact(request,id,1,'model.FCStd'),step=await saveArtifact(request,id,1,'model.step'),glb=await saveArtifact(request,id,1,'preview.glb');const native=execFileSync('python',['scripts/verify-live-assembly-downloads.py',fcstd,step,glb],{cwd:resolve('.'),encoding:'utf8',timeout:60000});writeFileSync(resolve(output,'m1-native-download-check.json'),native);expect(native).toContain('advanced-assembly-downloads: passed');
  59 |  await page.reload();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');await page.screenshot({path:resolve(output,'m1-committed.png'),fullPage:true});
  60 |  await page.getByLabel('建模指令').fill(m2Text);await page.getByRole('button',{name:'发送任务',exact:true}).click();await expect(planLocator).toContainText('双零件装配',{timeout:900000});
  61 |  const secondPending=await json(request,`/api/documents/${id}`),m2=secondPending.jobs.at(-1);expect(m2.status).toBe('awaiting_approval');expect(m2.plan.assembly).toMatchObject({length:60,width:40,thickness:8,holeDiameter:8,pinDiameter:10,pinLength:20});writeFileSync(resolve(output,'m2-plan.json'),JSON.stringify({request:m2Text,plan:m2.plan},null,2));await approve(request,id,m2.operationId,m2.plan.planHash);const failed=await waitStatus(request,id,m2.operationId,'failed');expect(failed.error).toBeTruthy();
  62 |  const after=await json(request,`/api/documents/${id}`),m2Events=await events(request,id,m2.operationId),collision=m2Events.events.find((event:any)=>event.type==='cad_progress'&&event.data?.stage==='interference');expect(after.revision).toBe(1);expect(after.validation.assembly.components[1].partId).toBe('pin');expect(after.validation.assembly.bom.find((part:any)=>part.partId==='pin').parameters.PinOutline.diameter).toBe(7);expect(collision).toBeTruthy();expect(collision.data.report.status).toBe('collision');expect(collision.data.report.pairs[0].components).toEqual(['PlateComponent','PinComponent']);expect(collision.data.report.pairs[0].volume).toBeCloseTo(72*Math.PI,5);writeFileSync(resolve(output,'m2-validation.json'),JSON.stringify({revision:after.revision,job:failed,error:failed.error,collision:collision.data.report,formalValidation:after.validation},null,2));writeFileSync(resolve(output,'m2-events.json'),JSON.stringify(m2Events,null,2));
  63 |  const afterHashes=await artifactHashes(request,after);expect(afterHashes).toEqual(beforeHashes);
  64 |  expect(after.tree).toEqual(snapshot.tree);expect(after.artifacts).toEqual(snapshot.artifacts);
  65 |  expect(failed.candidateSnapshot.assembly.bom.find((part:any)=>part.partId==='pin').parameters.PinOutline.diameter).toBe(10);
> 66 |  const preview=await request.get(failed.candidateSnapshot.preview.url,{headers});expect(preview.ok()).toBeTruthy();
     |                                                                                                       ^ Error: expect(received).toBeTruthy()
  67 |  writeFileSync(resolve(output,'m2-candidate.glb'),await preview.body());
  68 |  writeFileSync(resolve(output,'m2-candidate.json'),JSON.stringify(failed.candidateSnapshot,null,2));
  69 |  writeFileSync(resolve(output,'formal-protection.json'),JSON.stringify({documentId:id,revisionBefore:snapshot.revision,revisionAfter:after.revision,beforeHashes,afterHashes,unchanged:true},null,2));
  70 |  await page.reload();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');await page.locator('.execution-activity').last().locator('summary').first().click();await expect(page.locator('.execution-activity').last()).toContainText('226.194');await expect(page.getByTestId('job-error')).toContainText('正式模型未改变');await page.screenshot({path:resolve(output,'m2-failed.png'),fullPage:true});
  71 | });
  72 | 
```