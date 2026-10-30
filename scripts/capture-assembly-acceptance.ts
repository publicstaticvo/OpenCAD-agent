/** Recheck persisted live-run evidence and capture it without issuing model requests. */
import {chromium,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createGateway} from '../gateway/server.ts';
import {ModelConfig} from '../gateway/model-config.ts';

const dataDir=process.env.CAD_LIVE_DATA_DIR;
if(!dataDir)throw new Error('CAD_LIVE_DATA_DIR must identify the saved live acceptance run');
const output=resolve('artifacts/live-assembly-advanced');
const evidence=JSON.parse(readFileSync(resolve(output,'formal-protection.json'),'utf8'));
assert.deepEqual(evidence.beforeHashes,evidence.afterHashes);
for(const [name,hash] of Object.entries(evidence.beforeHashes))assert.equal(createHash('sha256').update(readFileSync(resolve(output,`m1-${name}`))).digest('hex'),hash);
for(const scenario of ['m1','m2']){
 const log=JSON.parse(readFileSync(resolve(output,`${scenario}-events.json`),'utf8'));
 assert.equal(log.hasMore,false,'All execution events must be retained');
 const approved=log.events.find((event:any)=>event.type==='plan_approved');assert.ok(approved);
 const operations=log.events.filter((event:any)=>event.type==='cad_operation_start');
 assert.equal(operations.length,scenario==='m1'?4:2);
 assert.ok(operations.every((event:any)=>event.seq>approved.seq));
 const stages=operations.flatMap((event:any)=>event.data.operations.map((operation:any)=>operation.stage??operation.op));
 assert.deepEqual(stages,scenario==='m1'?['plate','pin','assemble','assembly_check']:['pin_edit','assembly_check']);
 const interference=log.events.find((event:any)=>event.type==='cad_progress'&&event.data.stage==='interference');
 assert.equal(interference.data.report.status,scenario==='m1'?'clear':'collision');
}
const token='saved-assembly-review-0123456789abcdef';
const modelConfig=new ModelConfig(dataDir);
const app=await createGateway({dataDir,accessToken:token,port:0,modelConfig,textRunner:modelConfig.runner});
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE??(existsSync('/opt/google/chrome/chrome')?'/opt/google/chrome/chrome':undefined);
const browser=await chromium.launch({executablePath,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:960}});
 await page.goto(`${app.baseUrl}/?document=${evidence.documentId}`);
 await page.getByLabel('访问密钥').fill(token);await page.getByRole('button',{name:'连接工作区'}).click();
 await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');
 await expect(page.getByTestId('mesh-stats')).toContainText('WebGL');
 await page.locator('.model-assembly>summary').click();
 await expect(page.locator('.model-assembly tbody tr')).toHaveCount(2);
 await expect(page.locator('.model-assembly')).toContainText('无实体材料重叠');
 await page.screenshot({path:resolve(output,'formal-bom-after-m2.png'),fullPage:true});
 await page.locator('.execution-activity').last().locator('summary').first().click();
 const collision=page.locator('.execution-activity').last().locator('.progress-entry').filter({hasText:'存在真实材料干涉'});
 await collision.scrollIntoViewIfNeeded();
 await expect(collision).toBeVisible();
 await expect(collision).toContainText('226.194671');
 await expect(collision).toContainText('PlateComponent ↔ PinComponent');
 await page.screenshot({path:resolve(output,'m2-collision-evidence.png'),fullPage:true});
 console.log('Saved live assembly browser evidence: passed');
}finally{await browser.close();await app.close();}
