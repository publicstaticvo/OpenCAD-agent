import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {createPatch} from 'diff';
import {headers,createDocument,login,exportModel,showActivity} from './helpers.ts';

test('Python task approval, actual native preview, exact patch, downloads and failure protection',async({page,request},info)=>{
 const id=`python-${Date.now()}`;await createDocument(request,id);await login(page,id);
 const source="import FreeCAD as App\ndoc=App.newDocument('Model')\nbody=doc.addObject('PartDesign::Body','Body')\nbox=body.newObject('PartDesign::AdditiveBox','Box')\nbox.Length=40;box.Width=30;box.Height=10\ndoc.recompute()\n";
 let parentHash='',formalHash='';
 async function submit(operationId:string,baseRevision:number,submission:any,expected:string){
  const response=await request.post(`/api/documents/${id}/jobs`,{headers,data:{operationId,baseRevision,python:submission}});expect(response.status()).toBe(202);
  await expect(page.getByTestId('approval-plan')).toHaveCount(0);
  expect((await response.json()).candidateId).toBeTruthy();
  if(expected==='committed'){await expect(page.getByRole('button',{name:'验收候选并提交'})).toBeVisible({timeout:20000});await page.getByRole('button',{name:'验收候选并提交'}).click();}
  await expect.poll(async()=>{const job=await(await request.get(`/api/documents/${id}/jobs/${operationId}`,{headers})).json();if(expected==='committed'&&job.status==='failed')throw new Error(job.error);return job.status;},{timeout:20000}).toBe(expected);
  return(await(await request.get(`/api/documents/${id}`,{headers})).json());
 }
 const first=await submit('initial',0,{source,criteria:{bbox:[40,30,10],volume:12000}},'committed');
 expect(first.validation.reopened).toBe(true);expect(first.validation.step.volume).toBeCloseTo(12000);
 parentHash=first.validation.sourceHash;
 await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');
 await expect(page.getByTestId('mesh-stats')).toContainText('WebGL');
 const snapshot=first.progress.find((event:any)=>event.type==='candidate_snapshot').data;
 const preview=await request.get(snapshot.preview.url,{headers});expect(preview.status()).toBe(200);
 expect(createHash('sha256').update(await preview.body()).digest('hex')).toBe(snapshot.preview.sha256);
 const changed=source.replace('Height=10','Height=12');
 const second=await submit('modify',1,{parentHash,patch:createPatch('script.py',source,changed),criteria:{bbox:[40,30,12],volume:14400}},'committed');
 expect(second.validation.executionId).not.toBe(first.validation.executionId);
 await expect(page.getByTestId('display-revision')).toHaveText('正式版本 2');
 const sourceDownload=await request.get(second.artifacts['script.py'],{headers});expect(await sourceDownload.text()).toBe(changed);
 const formal=await request.get(second.artifacts['model.FCStd'],{headers});formalHash=createHash('sha256').update(await formal.body()).digest('hex');
 for(const format of ['FCStd','STEP','GLB']){const download=await exportModel(page,format);await download.saveAs(info.outputPath(download.suggestedFilename()));}
 const failure=await submit('bad',2,{source:'def broken(:',parentHash:second.validation.sourceHash,criteria:{bbox:[40,30,12],volume:14400}},'failed');
 expect(failure.revision).toBe(2);expect(failure.progress.some((e:any)=>e.type==='python_execution'&&e.data.error?.type==='SyntaxError')).toBe(true);
 const preserved=await request.get(second.artifacts['model.FCStd'],{headers});expect(createHash('sha256').update(await preserved.body()).digest('hex')).toBe(formalHash);
 await page.reload();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 2');
 await showActivity(page);await expect(page.getByTestId('python-execution').filter({hasText:'SyntaxError'})).toBeVisible();
 await page.screenshot({path:info.outputPath('python-formal-and-error.png'),fullPage:true});
});
