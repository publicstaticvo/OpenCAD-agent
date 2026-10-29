import {test,expect} from '@playwright/test';
import {createDocument,login,headers} from './helpers.ts';
import {execFileSync} from 'node:child_process';import {resolve} from 'node:path';
const prompt='创建 80×60×10 mm 孔板，孔径6 mm，孔中心20,15 mm';
test('chat creates editable plate, property edit commits, failed candidate protects official model, downloads reopen',async({page,request},info)=>{
 const id='text-'+Date.now();await createDocument(request,id);await login(page,id);
 await page.getByLabel('建模指令').fill(prompt);await page.getByRole('button',{name:'发送任务'}).click();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 0');await page.getByRole('button',{name:'批准并开始建模'}).click();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');
 await expect(page.getByTestId('mesh-stats')).toContainText('WebGL');await expect(page.getByText('已提交',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'hole 草图'}).click();await page.getByLabel('diameter (mm)').fill('8');await page.getByRole('button',{name:'提交 diameter 修改'}).click();
 await page.getByRole('button',{name:'批准并开始建模'}).click();
 await expect(page.getByTestId('display-revision')).toHaveText('正式版本 2');await expect(page.getByLabel('diameter (mm)')).toHaveValue('8');
 const formal=await(await request.get(`/api/documents/${id}/revisions/2/artifacts/model.FCStd`,{headers})).body();
 await page.getByLabel('diameter (mm)').fill('60');await page.getByRole('button',{name:'提交 diameter 修改'}).click();await page.getByRole('button',{name:'批准并开始建模'}).click();await expect(page.getByText('失败',{exact:true})).toBeVisible();await expect(page.getByTestId('job-error').last()).toContainText('正式模型未改变');
 await expect(page.getByTestId('display-revision')).toHaveText('正式版本 2');expect(await(await request.get(`/api/documents/${id}/revisions/2/artifacts/model.FCStd`,{headers})).body()).toEqual(formal);
 await page.reload();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 2');await page.getByRole('button',{name:'hole 草图'}).click();await expect(page.getByLabel('diameter (mm)')).toHaveValue('8');
 const paths:Record<string,string>={};for(const name of ['FCStd','STEP','GLB']){const pending=page.waitForEvent('download');await page.getByRole('button',{name:`下载 ${name}`,exact:true}).click();const download=await pending;paths[name]=info.outputPath(download.suggestedFilename());await download.saveAs(paths[name]);}
 const result=execFileSync('python',['scripts/verify-downloads.py',paths.FCStd,paths.STEP,paths.GLB],{cwd:resolve('.'),encoding:'utf8',timeout:30000});expect(result).toContain('download-reopen-edit: passed');
 await page.screenshot({path:info.outputPath('workspace.png'),fullPage:true});
});
test('cancel uses persisted job state and stale/history views cannot edit',async({page,request})=>{
 const id='cancel-'+Date.now();await createDocument(request,id);await login(page,id);await page.getByLabel('建模指令').fill(prompt);await page.getByRole('button',{name:'发送任务'}).click();await page.getByRole('button',{name:'取消任务'}).first().click();
 await expect(page.getByText('已取消',{exact:true})).toBeVisible();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 0');
 await page.getByLabel('建模指令').fill(prompt);await page.getByRole('button',{name:'发送任务'}).click();await page.getByRole('button',{name:'批准并开始建模'}).click();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');
 await page.getByRole('button',{name:'hole 草图'}).click();await page.getByLabel('查看修订').selectOption('1');await expect(page.getByTestId('display-revision')).toHaveText('历史版本 1');await expect(page.getByLabel('diameter (mm)')).toBeDisabled();await expect(page.getByLabel('建模指令')).toBeDisabled();
});
test('a real stale submit returns 409 and refreshes without overwriting the newer revision',async({page,request})=>{
 await page.addInitScript(()=>{const Native=window.WebSocket;(window as any).blockCadEvents=false;window.WebSocket=class extends Native{constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);this.addEventListener('message',e=>{if((window as any).blockCadEvents)e.stopImmediatePropagation();});}};});
 const id='stale-'+Date.now();await createDocument(request,id);await login(page,id);await page.getByLabel('建模指令').fill(prompt);await page.getByRole('button',{name:'发送任务'}).click();await page.getByRole('button',{name:'批准并开始建模'}).click();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');await page.getByRole('button',{name:'hole 草图'}).click();
 await page.evaluate(()=>(window as any).blockCadEvents=true);
 const r=await request.post(`/api/documents/${id}/jobs`,{headers,data:{baseRevision:1,operationId:'external',text:'修改 hole.diameter 为 8 mm'}});expect(r.status()).toBe(202);
 await expect.poll(async()=>{const r=await request.get(`/api/documents/${id}/jobs/external`,{headers});return(await r.json()).status;}).toBe('awaiting_approval');
 const planned=await(await request.get(`/api/documents/${id}/jobs/external`,{headers})).json();expect((await request.post(`/api/documents/${id}/jobs/external/approve`,{headers,data:{planHash:planned.plan.planHash}})).status()).toBe(200);
 await expect.poll(async()=>{const r=await request.get(`/api/documents/${id}/jobs/external`,{headers});return(await r.json()).status;}).toBe('committed');
 await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');await page.getByLabel('diameter (mm)').fill('10');await page.getByRole('button',{name:'提交 diameter 修改'}).click();
 await expect(page.getByTestId('submission-error')).toContainText('版本已更新');await expect(page.getByTestId('display-revision')).toHaveText('正式版本 2');await expect(page.getByLabel('diameter (mm)')).toHaveValue('8');
});
