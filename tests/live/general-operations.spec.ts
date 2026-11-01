import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {parse} from 'yaml';
import {execFileSync} from 'node:child_process';
const headers={Authorization:'Bearer live-local-access-0123456789abcdef'};
test('advanced model plans and executes real nonrectangular parts and subsequent modifications',async({page,request},info)=>{
 const yaml=parse(readFileSync(process.env.CAD_MODEL_CONFIG||'advanced-model.yaml','utf8')),config=yaml.test_llm??yaml;
 await page.goto('/');await page.getByLabel('访问密钥').fill('live-local-access-0123456789abcdef');await page.getByRole('button',{name:'连接工作区'}).click();
 await page.getByLabel('API 协议',{exact:true}).selectOption(config.protocol??'openai-completions');
 await page.getByLabel('服务地址').fill(config.base_url);await page.getByLabel('API key',{exact:true}).fill(config.api_key);
 await page.getByRole('button',{name:'获取模型列表'}).click();await page.getByLabel('选择模型').selectOption(config.model);await page.getByRole('button',{name:'保存模型配置'}).click();
 await expect(page.getByRole('heading',{name:'打开建模项目'})).toBeVisible({timeout:180000});
 const groups=[{name:'triangle',tasks:[
  {name:'triangle',prompt:'创建一个直角三角棱柱。XY 平面三角形顶点为 (0,0)、(40,0)、(0,30) mm，沿 +Z 拉伸10 mm。需要真实完全约束的三角形草图、Pad 和一个参数化实体。先提交操作计划等待批准。',bbox:[40,30,10],volume:6000},
  {name:'triangle-edit',prompt:'将当前三角棱柱的 Pad 长度从10 mm改为12 mm。三角形顶点和其他约束不变。使用当前真实特征编号，生成操作计划等待批准。',bbox:[40,30,12],volume:7200}
 ]},{name:'bracket',tasks:[
  {name:'bracket',prompt:'创建 L 形平板支架。XY 轮廓按顺序为 (0,0)、(60,0)、(60,10)、(10,10)、(10,50)、(0,50) mm，闭合回原点。沿 +Z 拉伸8 mm。轮廓各边保持水平或垂直，必须完全约束并可编辑尺寸。仅一个实体。提交操作计划等待批准。',bbox:[60,50,8],volume:8000},
  {name:'bracket-hole',prompt:'在当前 L 形支架的底臂增加直径4 mm的 Z 方向贯穿孔，圆心位于 (30,5) mm。保持轮廓和8 mm厚度。使用实际特征编号，提交操作计划等待批准。',bbox:[60,50,8],volume:8000-Math.PI*4*8}
 ]}];
 for(const group of groups){
  const id=`live-general-${group.name}-${Date.now()}`;expect((await request.post('/api/documents',{headers,data:{id}})).status()).toBe(201);
  await page.goto(`/?document=${id}`);
  const state=async()=>{const r=await request.get(`/api/documents/${id}`,{headers});expect(r.status()).toBe(200);return r.json();};
  for(const [index,item] of group.tasks.entries()){
   await expect(page.getByLabel('建模指令')).toBeEnabled();await page.getByLabel('建模指令').fill(item.prompt);await page.getByRole('button',{name:'发送任务'}).click();
   try{
    await expect.poll(async()=>{const j=(await state()).jobs.at(-1);if(j&&['failed','answered','interrupted'].includes(j.status))throw new Error(j.error??`Planning: ${j.status}`);return j?.status;},{timeout:300000}).toBe('awaiting_approval');
    const before=await state(),job=before.jobs.at(-1);expect(before.revision).toBe(index);expect(job.candidateId).toBe('');expect(job.plan.kind).toBe('operations');
    expect(job.plan.criteria.bbox).toEqual(item.bbox);expect(job.plan.criteria.volume).toBeCloseTo(item.volume,6);
    await expect(page.getByTestId('approval-plan')).toContainText('操作建模计划');
    await page.screenshot({path:info.outputPath(`${item.name}-approval.png`),fullPage:true});
    await page.getByRole('button',{name:'批准并开始建模'}).click();
    await expect.poll(async()=>{const j=(await state()).jobs.at(-1);if(['failed','answered','interrupted','cancelled'].includes(j.status))throw new Error(j.error??j.status);return j.status;},{timeout:600000}).toBe('committed');
    await expect(page.getByTestId('display-revision')).toHaveText(`正式版本 ${index+1}`);await expect(page.getByTestId('mesh-stats')).toContainText('WebGL');
    const done=await state(),completed=done.jobs.at(-1);expect(done.validation.operationPlanHash).toBe(completed.plan.planHash);
    const paths:Record<string,string>={};
    for(const extension of ['FCStd','STEP','GLB']){const pending=page.waitForEvent('download');await page.getByRole('button',{name:`下载 ${extension}`,exact:true}).click();const download=await pending;paths[extension]=info.outputPath(`${item.name}-${download.suggestedFilename()}`);await download.saveAs(paths[extension]);}
    const planPath=info.outputPath(`${item.name}-plan.json`);writeFileSync(planPath,JSON.stringify(completed.plan,null,2));
    expect(execFileSync('python',['scripts/verify-operation-downloads.py',paths.FCStd,paths.STEP,paths.GLB,planPath,item.name],{encoding:'utf8'})).toContain('operation-downloads: passed');
    await page.screenshot({path:info.outputPath(`${item.name}-formal.png`),fullPage:true});
   }finally{
    writeFileSync(info.outputPath(`${item.name}-evidence.json`),JSON.stringify(await state(),null,2));
   }
  }
 }
});
