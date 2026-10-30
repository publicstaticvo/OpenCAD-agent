import {expect,test,type APIRequestContext,type Page} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from 'yaml';
import {readFileSync} from 'node:fs';

const token='live-local-access-0123456789abcdef';
const headers={Authorization:`Bearer ${token}`};
const output=resolve('artifacts/live-assembly-advanced');
const m1Text='请创建一个由矩形底板和圆柱销组成的简单装配。底板长度60 mm、宽度40 mm、厚度8 mm，底面位于XY平面，在正中心开直径8 mm贯穿孔，孔中心(30,20)，孔轴沿Z方向。圆柱销直径7 mm、长度20 mm，轴线沿Z方向，装配位置x=30、y=20、z=0，从底部穿过中心孔，顶部延伸至z=20 mm。请先生成BOM和建模计划，等待批准后再开始CAD写入。';
const m2Text='请将当前装配中的圆柱销直径从7 mm修改为10 mm。保持底板60×40×8 mm、中心孔直径8 mm、底板位置、圆柱销长度20 mm、Z轴方向和位置(30,20,0)不变。请先生成新的结构化计划并等待批准。批准后执行真实CAD修改和装配检查；发现干涉时不得提交新的正式装配。';

async function json(request:APIRequestContext,path:string){const response=await request.get(path,{headers});expect(response.ok()).toBeTruthy();return response.json();}
async function job(request:APIRequestContext,id:string,operationId:string){return json(request,`/api/documents/${id}/jobs/${operationId}`);}
async function waitStatus(request:APIRequestContext,id:string,operationId:string,status:string,timeout=900000){await expect.poll(async()=>{return(await job(request,id,operationId)).status;},{timeout,intervals:[1000]}).toBe(status);return job(request,id,operationId);}
async function approve(request:APIRequestContext,id:string,operationId:string,planHash:string){const response=await request.post(`/api/documents/${id}/jobs/${operationId}/approve`,{headers,data:{planHash}});expect(response.ok()).toBeTruthy();}
async function saveArtifact(request:APIRequestContext,id:string,revision:number,name:string){const snapshot=await json(request,`/api/documents/${id}`);const response=await request.get(snapshot.artifacts[name],{headers});expect(response.ok()).toBeTruthy();const path=resolve(output,`m1-${name}`);writeFileSync(path,await response.body());return path;}
async function configure(page:Page){
 const parsed=parse(readFileSync(process.env.CAD_MODEL_CONFIG||'advanced-model.yaml','utf8')),yaml=parsed.test_llm??parsed;
 const status=await json(page.request,'/api/model-config');
 if(status.configured){
  expect(status.provider.model).toBe(yaml.model);
  expect(status.provider.protocol).toBe(yaml.protocol??'openai-completions');
 }else{
  const response=await page.request.post('/api/model-config',{headers,data:{baseUrl:yaml.base_url,apiKey:yaml.api_key,model:yaml.model,protocol:yaml.protocol??'openai-completions'}});
  const result=await response.json();
  writeFileSync(resolve(output,'configuration-check.json'),JSON.stringify({status:response.status(),configured:result.configured,error:result.error},null,2));
  expect(response.ok(),'真实模型配置及协议验证').toBeTruthy();
 }
 await page.goto('/');await page.getByLabel('访问密钥').fill(token);await page.getByRole('button',{name:'连接工作区'}).click();
 await expect(page.getByRole('heading',{name:'打开建模项目'})).toBeVisible();
}
async function events(request:APIRequestContext,id:string,operationId:string){return json(request,`/api/documents/${id}/jobs/${operationId}/events?afterSeq=0&limit=200`);}
async function artifactHashes(request:APIRequestContext,snapshot:any){
 const hashes:Record<string,string>={};
 for(const name of ['model.FCStd','model.step','preview.glb']){
  const response=await request.get(snapshot.artifacts[name],{headers});expect(response.ok()).toBeTruthy();
  hashes[name]=createHash('sha256').update(await response.body()).digest('hex');
 }
 return hashes;
}

test('advanced model M1/M2 real two-part assembly acceptance',async({page,request},info)=>{
 test.setTimeout(3600000);mkdirSync(output,{recursive:true});
 await configure(page);
 const created=await (await request.post('/api/documents',{headers,data:{id:`advanced-assembly-${Date.now()}`}})).json();const id=created.documentId;
 await page.goto(`/?document=${encodeURIComponent(id)}`);await expect(page.getByRole('heading',{name:'建模对话'})).toBeVisible();
 await page.getByLabel('建模指令').fill(m1Text);await page.getByRole('button',{name:'发送任务',exact:true}).click();
 const planLocator=page.getByTestId('approval-plan');await expect(planLocator).toContainText('双零件装配',{timeout:900000});
 const first=await json(request,`/api/documents/${id}`);const m1=first.jobs.at(-1);expect(m1.status).toBe('awaiting_approval');expect(m1.plan.kind).toBe('pin_plate_assembly');expect(m1.plan.assembly).toMatchObject({length:60,width:40,thickness:8,holeDiameter:8,pinDiameter:7,pinLength:20});
 writeFileSync(resolve(output,'m1-plan.json'),JSON.stringify({request:m1Text,plan:m1.plan},null,2));await page.screenshot({path:resolve(output,'m1-plan.png'),fullPage:true});
 await approve(request,id,m1.operationId,m1.plan.planHash);const committed=await waitStatus(request,id,m1.operationId,'committed');expect(committed.result.revision).toBe(1);
 const snapshot=await json(request,`/api/documents/${id}`),validation=snapshot.validation;expect(snapshot.revision).toBe(1);expect(validation.assembly.bom).toHaveLength(2);expect(validation.assembly.components).toHaveLength(2);expect(validation.assembly.interference.status).toBe('clear');expect(validation.assembly.interference.pairs[0].volume).toBeLessThan(1e-7);expect(validation.bbox).toEqual([60,40,20]);expect(validation.solids).toBe(2);expect(validation.step.solids).toBe(2);expect(validation.glb.meshes).toBe(2);expect(validation.assembly.components[0].position).toEqual([0,0,0]);expect(validation.assembly.components[1].position).toEqual([30,20,0]);
 writeFileSync(resolve(output,'m1-validation.json'),JSON.stringify({revision:snapshot.revision,validation,tree:snapshot.tree},null,2));writeFileSync(resolve(output,'m1-events.json'),JSON.stringify(await events(request,id,m1.operationId),null,2));
 const beforeHashes=await artifactHashes(request,snapshot);
 const fcstd=await saveArtifact(request,id,1,'model.FCStd'),step=await saveArtifact(request,id,1,'model.step'),glb=await saveArtifact(request,id,1,'preview.glb');const native=execFileSync('python',['scripts/verify-live-assembly-downloads.py',fcstd,step,glb],{cwd:resolve('.'),encoding:'utf8',timeout:60000});writeFileSync(resolve(output,'m1-native-download-check.txt'),native);expect(native).toContain('advanced-assembly-downloads: passed');
 await page.reload();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');await page.screenshot({path:resolve(output,'m1-committed.png'),fullPage:true});
 await page.getByLabel('建模指令').fill(m2Text);await page.getByRole('button',{name:'发送任务',exact:true}).click();await expect(planLocator).toContainText('双零件装配',{timeout:900000});
 const secondPending=await json(request,`/api/documents/${id}`),m2=secondPending.jobs.at(-1);expect(m2.status).toBe('awaiting_approval');expect(m2.plan.assembly).toMatchObject({length:60,width:40,thickness:8,holeDiameter:8,pinDiameter:10,pinLength:20});writeFileSync(resolve(output,'m2-plan.json'),JSON.stringify({request:m2Text,plan:m2.plan},null,2));await approve(request,id,m2.operationId,m2.plan.planHash);const failed=await waitStatus(request,id,m2.operationId,'failed');expect(failed.error).toBeTruthy();
 const after=await json(request,`/api/documents/${id}`),m2Events=await events(request,id,m2.operationId),collision=m2Events.events.find((event:any)=>event.type==='cad_progress'&&event.data?.stage==='interference');expect(after.revision).toBe(1);expect(after.validation.assembly.components[1].partId).toBe('pin');expect(after.validation.assembly.bom.find((part:any)=>part.partId==='pin').parameters.PinOutline.diameter).toBe(7);expect(collision).toBeTruthy();expect(collision.data.report.status).toBe('collision');expect(collision.data.report.pairs[0].components).toEqual(['PlateComponent','PinComponent']);expect(collision.data.report.pairs[0].volume).toBeCloseTo(72*Math.PI,5);writeFileSync(resolve(output,'m2-validation.json'),JSON.stringify({revision:after.revision,job:failed,error:failed.error,collision:collision.data.report,formalValidation:after.validation},null,2));writeFileSync(resolve(output,'m2-events.json'),JSON.stringify(m2Events,null,2));
 const afterHashes=await artifactHashes(request,after);expect(afterHashes).toEqual(beforeHashes);
 expect(after.tree).toEqual(snapshot.tree);expect(after.artifacts).toEqual(snapshot.artifacts);
 expect(failed.candidateSnapshot.assembly.bom.find((part:any)=>part.partId==='pin').parameters.PinOutline.diameter).toBe(10);
 const preview=readFileSync(resolve(process.env.CAD_LIVE_DATA_DIR!,'staging',failed.candidateId,failed.candidateSnapshot.preview.file));
 expect(createHash('sha256').update(preview).digest('hex')).toBe(failed.candidateSnapshot.preview.sha256);
 writeFileSync(resolve(output,'m2-candidate.glb'),preview);
 writeFileSync(resolve(output,'m2-candidate.json'),JSON.stringify(failed.candidateSnapshot,null,2));
 writeFileSync(resolve(output,'formal-protection.json'),JSON.stringify({documentId:id,revisionBefore:snapshot.revision,revisionAfter:after.revision,beforeHashes,afterHashes,unchanged:true},null,2));
 await page.reload();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');await page.locator('.execution-activity').last().locator('summary').first().click();await expect(page.locator('.execution-activity').last()).toContainText('226.194');await expect(page.getByTestId('job-error')).toContainText('正式模型未改变');await page.screenshot({path:resolve(output,'m2-failed.png'),fullPage:true});
});
