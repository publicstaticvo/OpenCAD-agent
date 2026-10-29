import {test,expect} from '@playwright/test';
import {mkdtempSync,readdirSync,existsSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';

test('approved native candidate remains observable after commit and browser refresh',async({page})=>{
 const root=mkdtempSync(resolve('.work/browser-approved-')),token='approved-preview-local-token-012345';
 const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','tests/helpers/preview-gateway.ts'],{env:{...process.env,CAD_DATA_DIR:root,CAD_PREVIEW_PAUSE:'1'},stdio:['ignore','ignore','inherit','ipc']});
 const baseUrl=await new Promise<string>((done,reject)=>{child.once('message',(message:any)=>done(message.baseUrl));child.once('error',reject);child.once('exit',code=>reject(new Error(`Preview Gateway exited: ${code}`)));});
 const stages=[1,2].map(stage=>new Promise<void>(done=>{const listener=(message:any)=>{if(message.stage===stage){child.off('message',listener);done();}};child.on('message',listener);}));
 const screenshots=resolve('artifacts/workspace-visual-review/after');mkdirSync(screenshots,{recursive:true});
 try{
  await page.goto(baseUrl+'/?document=part');await page.getByLabel('访问密钥').fill(token);await page.getByRole('button',{name:'连接工作区'}).click();
  await page.getByLabel('建模指令').fill('42 × 24 × 8 mm');await page.getByRole('button',{name:'发送任务'}).click();
  await expect(page.getByTestId('approval-plan')).toContainText('42 × 24 × 8');
  await page.screenshot({path:resolve(screenshots,'approval.png'),fullPage:true});
  expect(readdirSync(resolve(root,'staging'))).toEqual([]);expect(existsSync(resolve(root,'worker-lease.json'))).toBe(false);await page.getByRole('button',{name:'批准并开始建模'}).click();
  await stages[0];await expect(page.getByTestId('candidate-panel')).toHaveAttribute('data-sequence','1');
  await expect(page.getByTestId('display-revision')).toHaveText('正式版本 0');
  await expect(page.getByTestId('candidate-panel')).toContainText('尚未提交');
  await page.screenshot({path:resolve(screenshots,'candidate-sketch.png'),fullPage:true});child.send({release:true});
  await stages[1];await expect(page.getByTestId('candidate-panel')).toHaveAttribute('data-sequence','2');
  await expect(page.getByTestId('candidate-panel').getByTestId('mesh-stats')).toContainText('WebGL');
  await expect(page.getByTestId('display-revision')).toHaveText('正式版本 0');
  await page.screenshot({path:resolve(screenshots,'candidate-solid.png'),fullPage:true});
  await page.getByRole('button',{name:'查看正式模型',exact:true}).click();await expect(page.getByTestId('candidate-panel')).toHaveCount(0);
  await page.getByRole('button',{name:'查看候选模型',exact:true}).click();await expect(page.getByTestId('candidate-panel')).toBeVisible();child.send({release:true});
  await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');await expect(page.getByTestId('candidate-panel')).toHaveCount(0);
  await page.reload();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');
  await page.locator('.execution-activity').last().locator('summary').first().click();
  const checkpoint=page.getByTestId('recorded-checkpoint').last();await checkpoint.locator('summary').click();
  await checkpoint.getByRole('button',{name:'查看实际候选实体',exact:true}).click();
  const recorded=checkpoint.getByTestId('recorded-candidate');await expect(recorded).toContainText('基于正式版本 0');
  await expect(recorded.getByTestId('mesh-stats')).toContainText('WebGL');expect(Number(await recorded.getByTestId('mesh-stats').getAttribute('data-triangles'))).toBe(12);
  await expect(recorded.locator('canvas')).toBeVisible();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');
  await checkpoint.getByRole('button',{name:'关闭历史候选实体',exact:true}).click();await expect(recorded).toHaveCount(0);
 }finally{const exited=new Promise<void>(done=>child.once('exit',()=>done()));if(child.exitCode===null){child.kill('SIGTERM');await exited;}}
});
