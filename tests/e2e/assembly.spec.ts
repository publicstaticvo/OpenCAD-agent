import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createDocument,login} from './helpers.ts';
test('two real parametric components, approval, BOM, native interference and exports',async({page,request},info)=>{
 const id=`assembly-browser-${Date.now()}`;await createDocument(request,id);await login(page,id);
 await page.getByLabel('建模指令').fill('装配：80×60×10 mm 底板，中心孔8 mm，圆柱销直径7 mm，长20 mm');
 await page.getByRole('button',{name:'发送任务',exact:true}).click();await expect(page.getByTestId('approval-plan')).toContainText('双零件装配计划');
 await expect(page.locator('.job-list')).toContainText('已生成离线装配计划；未调用真实模型。');
 await expect(page.getByTestId('display-revision')).toHaveText('正式版本 0');
 await page.getByRole('button',{name:'批准并开始建模'}).click();
 await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');
 await expect(page.getByTestId('mesh-stats')).toContainText('WebGL');
 await page.locator('.model-assembly>summary').click();
 const panel=page.locator('.model-assembly').getByTestId('assembly-panel');
 await expect(panel).toContainText('无实体材料重叠');await expect(panel.locator('tbody tr')).toHaveCount(2);
 await expect(panel).toContainText('PinComponent · [40, 30, 0]');
 await page.locator('.execution-activity>summary').click();
 await expect(page.locator('.execution-activity')).toContainText('底板 · 开始真实建模');
 await expect(page.locator('.execution-activity')).toContainText('圆柱销 · 单体几何验证完成');
 for(const name of ['FCStd','STEP','GLB']){const event=page.waitForEvent('download');await page.getByRole('button',{name:`下载 ${name}`,exact:true}).click();const file=await event;expect(file.suggestedFilename()).toContain('-r1.');await file.saveAs(info.outputPath(file.suggestedFilename()));}
 mkdirSync(resolve('artifacts/assembly-demo'),{recursive:true});
 await page.screenshot({path:'artifacts/assembly-demo/workspace.png',fullPage:true});
 await page.reload();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');await page.locator('.model-assembly>summary').click();await expect(panel).toContainText('无实体材料重叠');
});

test('collision assembly reports actual overlap and preserves the formal revision',async({page,request})=>{
 const id=`assembly-collision-${Date.now()}`;await createDocument(request,id);await login(page,id);
 await page.getByLabel('建模指令').fill('装配：80×60×10 mm 底板，中心孔8 mm，圆柱销直径9 mm，长20 mm');
 await page.getByRole('button',{name:'发送任务',exact:true}).click();await page.getByRole('button',{name:'批准并开始建模'}).click();
 await expect(page.getByTestId('display-revision')).toHaveText('正式版本 0');
 await expect(page.getByTestId('job-error')).toContainText('正式模型未改变');
 await page.locator('.execution-activity>summary').click();
 await expect(page.locator('.execution-activity')).toContainText('133.517687');
 await expect(page.getByTestId('display-revision')).toHaveText('正式版本 0');
});
