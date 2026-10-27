import {DatabaseSync,backup} from 'node:sqlite';
import {cpSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {createGateway} from '../gateway/server.ts';

// Verify real historical failures on an isolated database copy, without model requests.
const sourceRoot=resolve(process.env.CAD_DIAGNOSTIC_DATA??'data');
mkdirSync('.work',{recursive:true,mode:0o700});
const output=mkdtempSync(resolve('.work/model-error-ui-'));
const source=new DatabaseSync(join(sourceRoot,'store.sqlite'),{readOnly:true});
try{await backup(source,join(output,'store.sqlite'));}finally{source.close();}
cpSync(join(sourceRoot,'revisions'),join(output,'revisions'),{recursive:true});
const accessToken='historical-model-errors-test-0123456789';
const gateway=await createGateway({dataDir:output,accessToken,port:0});
try{
 const failures=gateway.store.db.prepare("SELECT job FROM jobs WHERE status='failed'").all().map((row:any)=>JSON.parse(row.job)).filter((job:any)=>job.agent?.messages.some((message:any)=>message.role==='assistant'&&message.stopReason==='error'&&/^50[23]:/.test(message.errorMessage??'')));
 if(!failures.length)throw new Error('No real historical HTTP 502/503 jobs available to verify');
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE??'/opt/google/chrome/chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const checked=[];
 try{
  const page=await browser.newPage();
  await page.addInitScript(token=>sessionStorage.setItem('cad-access-token',token),accessToken);
  for(const job of failures){
   await page.goto(`${gateway.baseUrl}/?document=${encodeURIComponent(job.documentId)}`);
   await page.waitForLoadState('networkidle');
   const message=job.agent.messages.find((m:any)=>m.role==='assistant'&&m.stopReason==='error');
   const status=message.errorMessage.slice(0,3);
   const card=page.locator(`[data-job-id="${job.operationId}"]`);
   await expect(card.getByTestId('job-error')).toContainText(`HTTP ${status}`);
   await expect(card.getByTestId('job-error')).toContainText('服务或上游暂时不可用');
   checked.push({operationId:job.operationId,httpStatus:status});
  }
  await page.screenshot({path:join(output,'errors.png'),fullPage:true});
 }finally{await browser.close();}
 writeFileSync(join(output,'result.json'),JSON.stringify({checked},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({passed:checked.length,output}));
}finally{await gateway.close();}
