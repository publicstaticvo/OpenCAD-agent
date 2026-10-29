import {test,expect} from '@playwright/test';
import {parse} from 'yaml';
import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const token='live-local-access-0123456789abcdef',headers={Authorization:`Bearer ${token}`};
test('approved real model creates box, cuts through hole, edits diameter and restores native revisions',async({page,request},info)=>{
 const yaml=parse(readFileSync(process.env.CAD_MODEL_CONFIG||'advanced-model.yaml','utf8'));
 const config=yaml.test_llm??yaml,events:any[]=[],previewChecks:Promise<void>[]=[];
 const data=process.env.CAD_LIVE_DATA_DIR!;
 page.on('websocket',socket=>socket.on('framereceived',frame=>{
  const packet=JSON.parse(String(frame.payload));if(packet.type!=='event')return;
  const event=packet.event;events.push(event);
  if(event.type==='candidate_snapshot'&&event.data.preview){
   const snapshot=event.data;
   previewChecks.push((async()=>{
    const response=await request.get(snapshot.preview.url,{headers});expect(response.status()).toBe(200);
    expect(response.headers()['x-cad-candidate']).toBe(snapshot.candidateId);
    expect(response.headers()['x-cad-sequence']).toBe(String(snapshot.sequence));
    const bytes=await response.body();expect(createHash('sha256').update(bytes).digest('hex')).toBe(snapshot.preview.sha256);
    writeFileSync(info.outputPath(`${event.jobId}-candidate.glb`),bytes);
   })());
  }
 }));
 await page.goto('/');await page.getByLabel('访问密钥').fill(token);await page.getByRole('button',{name:'连接工作区'}).click();
 const settings=await(await request.get('/api/model-config',{headers})).json();
 if(!settings.configured){
  await page.getByLabel('API 协议',{exact:true}).selectOption(process.env.CAD_MODEL_PROTOCOL??config.protocol??'openai-completions');
  await page.getByLabel('服务地址').fill(config.base_url);await page.getByLabel('API key',{exact:true}).fill(config.api_key);
  await page.getByRole('button',{name:'获取模型列表'}).click();await page.getByLabel('选择模型').selectOption(config.model);
  await page.getByRole('button',{name:'保存模型配置'}).click();
 }
 await expect(page.getByRole('heading',{name:'打开建模项目'})).toBeVisible({timeout:180000});
 if(process.env.CAD_DEMO_PROJECT)await page.goto(`/?document=${encodeURIComponent(process.env.CAD_DEMO_PROJECT)}`);
 else await page.getByRole('button',{name:'创建空白项目'}).click();
 await expect.poll(()=>new URL(page.url()).searchParams.get('document')).toBeTruthy();
 const id=new URL(page.url()).searchParams.get('document')!;
 await page.addInitScript(()=>{
  (window as any).renderedCandidates=[];
  document.addEventListener('DOMContentLoaded',()=>new MutationObserver(()=>{const panel=document.querySelector('[data-testid="candidate-panel"]');if(panel)(window as any).renderedCandidates.push({id:panel.getAttribute('data-candidate'),sequence:panel.getAttribute('data-sequence'),lines:panel.querySelectorAll('svg line').length,circles:panel.querySelectorAll('svg circle').length,canvas:!!panel.querySelector('canvas')});}).observe(document.body,{subtree:true,childList:true,attributes:true}));
 });
 const snapshot=async()=>{const r=await request.get(`/api/documents/${id}`,{headers});expect(r.status()).toBe(200);return r.json();};
 const tasks=[
  {prompt:'创建一个长40 mm、宽30 mm、高10 mm的长方体。只需要一个实体，不添加其他特征。',kind:'create_box',diameter:0},
  {prompt:'在当前长方体上增加一个直径6 mm的中心贯穿孔，保留其他尺寸。',kind:'add_hole',diameter:6},
  {prompt:'把已有中心贯穿孔的孔径从6 mm修改为8 mm，保留其他尺寸和特征。',kind:'edit_hole',diameter:8},
 ];
 const results:any[]=[];
 for(let i=0;i<tasks.length;i++){
  const item=tasks[i],prior=await snapshot();
  if(!prior.jobs[i]){await expect(page.getByLabel('建模指令')).toBeEnabled();await page.getByLabel('建模指令').fill(item.prompt);await page.getByRole('button',{name:'发送任务'}).click();}
  await expect.poll(async()=>{const s=await snapshot(),j=s.jobs.at(-1);if(j&&['failed','interrupted','cancelled','answered'].includes(j.status))throw new Error(j.error??`Planning ended with ${j.status}`);return j?.status;},{timeout:180000}).toBe('awaiting_approval');
  await expect(page.getByTestId('approval-plan')).toBeVisible({timeout:180000});
  const before=await snapshot(),job=before.jobs.at(-1);
  expect(before.revision).toBe(i);expect(job.status).toBe('awaiting_approval');expect(job.candidateId).toBe('');expect(job.plan.kind).toBe(item.kind);expect(job.plan.baseRevision).toBe(i);
  expect(readdirSync(resolve(data,'staging'))).toHaveLength(0);expect(existsSync(resolve(data,'worker-lease.json'))).toBe(false);
  await expect(page.getByTestId('approval-plan')).toContainText('40 × 30 × 10');
  if(i===0){await page.reload();await expect(page.getByTestId('approval-plan')).toBeVisible();expect((await snapshot()).jobs.at(-1).plan.planHash).toBe(job.plan.planHash);}
  await page.getByRole('button',{name:'批准并开始建模'}).click();
  await expect.poll(async()=>{const s=await snapshot(),j=s.jobs.at(-1);if(['failed','interrupted','cancelled'].includes(j.status))throw new Error(j.error);return j.status;},{timeout:600000}).toBe('committed');
  await expect(page.getByTestId('display-revision')).toHaveText(`正式版本 ${i+1}`);
  await expect(page.getByTestId('candidate-panel')).toHaveCount(0);await expect(page.getByTestId('mesh-stats')).toContainText('WebGL');
  const after=await snapshot(),done=after.jobs.at(-1),own=events.filter(e=>e.jobId===done.operationId);
  const renderedCandidates=await page.evaluate(()=>(window as any).renderedCandidates);
  writeFileSync(info.outputPath(`r${i+1}-execution.json`),JSON.stringify({job:done,events:own,renderedCandidates},null,2));
  expect(done.approval.planHash).toBe(done.plan.planHash);expect(done.result.revision).toBe(i+1);
  const snapshots=own.filter(e=>e.type==='candidate_snapshot');expect(snapshots).toHaveLength(i===2?1:2);
  expect(snapshots.map(e=>e.data.sequence)).toEqual(i===2?[1]:[1,2]);
  for(const e of snapshots){expect(e.data.candidateId).toBe(done.candidateId);expect(e.data.planHash).toBe(done.plan.planHash);expect(e.data.sketch.fullyConstrained).toBe(true);expect(e.revision).toBe(i);}
  expect(snapshots[0].data.sketch.geometry).toHaveLength(i===0?4:1);
  expect(own.findIndex(e=>e.type==='plan_approved')).toBeLessThan(own.findIndex(e=>e.type==='cad_operation_start'));
  expect(own.findIndex(e=>e.type==='candidate_snapshot')).toBeLessThan(own.findIndex(e=>e.type==='committed'));
  const stages=own.filter(e=>e.type==='cad_progress'&&e.data.stage!=='operation').map(e=>`${e.data.stage}:${e.data.status}`);
  expect(stages).toEqual(['geometry:start','geometry:complete','save:start','save:complete','reopen:start','reopen:complete','export_step:start','export_step:complete','export_glb:start','export_glb:complete']);
  const validation=await(await request.get(after.artifacts['validation.json'],{headers})).json();
  expect(validation.bbox).toEqual([40,30,10]);expect(validation.solids).toBe(1);expect(validation.volume).toBeCloseTo(12000-Math.PI*(item.diameter/2)**2*10,6);
  if(item.diameter)expect(validation.throughHole).toEqual({center:[20,15],diameter:item.diameter,through:true});
  expect(await page.evaluate((candidate)=>(window as any).renderedCandidates.some((r:any)=>r.id===candidate&&(r.lines===4||r.circles===1)),done.candidateId)).toBe(true);
  expect(renderedCandidates.some((r:any)=>r.id===done.candidateId&&r.canvas)).toBe(true);
  await expect(page.locator(`[data-job-id="${done.operationId}"] [data-testid="recorded-checkpoint"]`)).toHaveCount(i===2?1:2);
  await Promise.all(previewChecks);
  results.push({revision:i+1,job:done,validation,events:own,renderedCandidates:await page.evaluate(()=>(window as any).renderedCandidates)});
  writeFileSync(info.outputPath('completed-revisions.json'),JSON.stringify(results,null,2));
 }
 await Promise.all(previewChecks);expect(previewChecks).toHaveLength(3);
 expect(results[2].job.plan.previousDiameter).toBe(6);expect(results[2].job.plan.diameter).toBe(8);
 await page.getByRole('button',{name:'hole 草图',exact:true}).click();await expect(page.getByLabel('diameter (mm)')).toHaveValue('8');
 const afterCanvas=await page.locator('.model-panel canvas').screenshot({path:info.outputPath('diameter-8.png')});
 await page.getByRole('button',{name:'查看修改前',exact:true}).click();await expect(page.getByTestId('display-revision')).toHaveText('历史版本 2');
 await expect(page.getByLabel('diameter (mm)')).toHaveValue('6');await expect(page.getByLabel('建模指令')).toBeDisabled();
 const beforeCanvas=await page.locator('.model-panel canvas').screenshot({path:info.outputPath('diameter-6.png')});
 expect(createHash('sha256').update(beforeCanvas).digest('hex')).not.toBe(createHash('sha256').update(afterCanvas).digest('hex'));
 await page.getByRole('button',{name:'查看当前版本',exact:true}).click();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 3');
 await expect(page.getByLabel('diameter (mm)')).toHaveValue('8');
 await page.screenshot({path:info.outputPath('formal-r3.png'),fullPage:true});
 for(const result of results){
  const revision=result.revision;
  const checkpoint=page.locator(`[data-job-id="${result.job.operationId}"] [data-testid="recorded-checkpoint"]`).last();
  await checkpoint.locator('summary').click();await checkpoint.getByRole('button',{name:'查看实际候选实体',exact:true}).click();
  await expect(checkpoint.getByTestId('recorded-candidate').getByTestId('mesh-stats')).toContainText('WebGL');
  expect(Number(await checkpoint.getByTestId('mesh-stats').getAttribute('data-triangles'))).toBeGreaterThan(0);
  await expect(checkpoint.getByTestId('recorded-candidate')).toContainText('只读执行记录');
  if(revision===1)await page.screenshot({path:info.outputPath('recorded-box-candidate.png'),fullPage:true});
  await checkpoint.getByRole('button',{name:'关闭历史候选实体',exact:true}).click();
  await page.getByLabel('查看修订').selectOption(String(revision));await expect(page.getByTestId('display-revision')).toHaveText(`历史版本 ${revision}`);
  await expect(page.getByLabel('建模指令')).toBeDisabled();
  await page.getByRole('button',{name:revision===1?'pad 拉伸':'hole 草图',exact:true}).click();
  await expect(page.getByLabel(revision===1?'Length (mm)':'diameter (mm)')).toHaveValue(String(revision===1?10:revision===2?6:8));
  const paths:Record<string,string>={};
  for(const name of ['FCStd','STEP','GLB']){const pending=page.waitForEvent('download');await page.getByRole('button',{name:`下载 ${name}`,exact:true}).click();const file=await pending;paths[name]=info.outputPath(file.suggestedFilename());await file.saveAs(paths[name]);}
  const manifest=JSON.parse(readFileSync(resolve(data,'revisions',result.job.candidateId,'manifest.json'),'utf8')).files;
  for(const [name,file] of Object.entries({'model.FCStd':paths.FCStd,'model.step':paths.STEP,'preview.glb':paths.GLB}))expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(manifest[name].sha256);
  expect(execFileSync('python',['scripts/verify-demo-downloads.py',paths.FCStd,paths.STEP,paths.GLB,String(revision===1?0:revision===2?6:8),'40','30','10'],{encoding:'utf8',timeout:30000})).toContain('demo-downloads: passed');
 }
 await page.getByLabel('查看修订').selectOption('');await page.reload();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 3');
 writeFileSync(info.outputPath('verified-demo.json'),JSON.stringify({model:config.model,protocol:process.env.CAD_MODEL_PROTOCOL??config.protocol??'openai-completions',results,renderedCandidates:await page.evaluate(()=>(window as any).renderedCandidates??[])},null,2));
});
