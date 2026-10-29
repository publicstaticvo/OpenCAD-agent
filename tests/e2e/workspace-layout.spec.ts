import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createDocument,login,programJob} from './helpers.ts';

test('workspace keeps chronological conversation, bottom composer and real model inspection',async({page,request})=>{
 test.setTimeout(60000);
 const phase=process.env.CAD_VISUAL_PHASE??'after';
 const directory=resolve('artifacts/workspace-visual-review',phase);mkdirSync(directory,{recursive:true});
 const id=`visual-${Date.now()}`;await createDocument(request,id);await login(page,id);
 const instructions=['创建 80×60×10 mm 孔板，孔径6 mm，孔中心20,15 mm','修改 hole.diameter 为 8 mm'];
 for(const [index,text] of instructions.entries()){
  await page.getByLabel('建模指令').fill(text);await page.getByRole('button',{name:'发送任务',exact:true}).click();
  await expect(page.getByTestId('approval-plan')).toBeVisible();await page.getByRole('button',{name:'批准并开始建模'}).click();
  await expect(page.getByTestId('display-revision')).toHaveText(`正式版本 ${index+1}`);
 }
 await page.getByRole('button',{name:'hole 草图',exact:true}).click();await expect(page.getByLabel('diameter (mm)')).toHaveValue('8');
 await expect(page.getByTestId('mesh-stats')).toContainText('WebGL');
 await page.screenshot({path:resolve(directory,'workspace.png'),fullPage:true});
 const metrics=await page.evaluate(()=>Object.fromEntries(['.workspace','.model-panel','.detail-panel','.properties','.chat-form','.job-list'].map(selector=>{
  const element=document.querySelector(selector)!;const {x,y,width,height}=element.getBoundingClientRect();return[selector,{x,y,width,height}];
 })));
 writeFileSync(resolve(directory,'layout.json'),JSON.stringify(metrics,null,2));
 if(phase==='before')return;
 await expect(page.locator('.job>strong')).toHaveText(instructions);
 expect(metrics['.properties'].x).toBeLessThan(metrics['.model-panel'].x);
 expect(metrics['.model-panel'].width).toBeGreaterThan(metrics['.detail-panel'].width);
 expect(metrics['.chat-form'].y).toBeGreaterThanOrEqual(metrics['.job-list'].y+metrics['.job-list'].height-1);
 expect(metrics['.chat-form'].y+metrics['.chat-form'].height).toBeLessThanOrEqual(960);
 const history=page.locator('.job-list');
 await expect(history).toHaveAttribute('aria-label','对话历史');
 await expect(page.locator('.execution-activity')).toHaveCount(2);
 await page.locator('.execution-activity').last().locator('summary').first().click();
 await expect(page.locator('.execution-activity').last().locator('.progress-entry').first()).toBeVisible();
 await page.screenshot({path:resolve(directory,'activity.png'),fullPage:true});
 await history.evaluate(element=>element.scrollTop=0);
 await expect(page.getByRole('button',{name:'查看最新消息',exact:true})).toBeVisible();
 await programJob(request,id,2,'external-edit',{operations:[{op:'set_parameter',feature:'hole',parameter:'diameter',value:10}],criteria:{bbox:[80,60,10],volume:48000-Math.PI*25*10}});
 await expect(page.getByTestId('display-revision')).toHaveText('正式版本 3');
 expect(await history.evaluate(element=>element.scrollTop)).toBeLessThan(4);
 await page.getByRole('button',{name:'查看最新消息',exact:true}).click();
 await expect.poll(()=>history.evaluate(element=>element.scrollHeight-element.scrollTop-element.clientHeight)).toBeLessThan(4);
 await page.reload();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 3');
 await expect(page.locator('.job>strong')).toHaveText([...instructions,'结构化建模任务']);
 await page.setViewportSize({width:1024,height:768});await page.screenshot({path:resolve(directory,'compact.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
