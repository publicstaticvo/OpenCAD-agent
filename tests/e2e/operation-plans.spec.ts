import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {headers,createDocument,login,exportModel} from './helpers.ts';
import {bracket,bracketHole,triangle,triangleEdit} from '../fixtures/operation-plans.ts';

test('real general operation plans approve, cut, edit, download and restore nonrectangular parts',async({page,request},info)=>{
 for(const [name,plans] of [['bracket',[bracket,bracketHole]],['triangle',[triangle,triangleEdit]]] as const){
  const id=`operations-${name}-${Date.now()}`;await createDocument(request,id);
  if(name==='bracket')await login(page,id);else await page.goto(`/?document=${id}`);
  for(const [index,proposal] of plans.entries()){
   const r=await request.post(`/api/documents/${id}/jobs`,{headers,data:{baseRevision:index,operationId:`step-${index}`,plan:proposal}});expect(r.status()).toBe(202);
   const submitted=await r.json();
   await expect(page.getByTestId('approval-plan')).toContainText(proposal.goal);
   await expect(page.getByTestId('display-revision')).toHaveText(`正式版本 ${index}`);
   expect(submitted.candidateId).toBe('');
   await page.reload();await expect(page.getByTestId('approval-plan')).toBeVisible();
   await page.getByRole('button',{name:'批准并开始建模'}).click();
   await expect.poll(async()=>{const j=await(await request.get(`/api/documents/${id}/jobs/step-${index}`,{headers})).json();if(j.status==='failed')throw new Error(j.error);return j.status;}).toBe('committed');
   await expect(page.getByTestId('display-revision')).toHaveText(`正式版本 ${index+1}`);
   await expect(page.getByTestId('mesh-stats')).toContainText('WebGL');
   const state=await(await request.get(`/api/documents/${id}`,{headers})).json(),job=state.jobs.at(-1);
   expect(state.validation.operationPlanHash).toBe(job.plan.planHash);
   const events=state.progress.filter((e:any)=>e.jobId===job.operationId),snapshots=events.filter((e:any)=>e.type==='candidate_snapshot');
   expect(snapshots).toHaveLength(proposal.stages.length);
   expect(snapshots.map((e:any)=>e.data.completedStages)).toEqual(proposal.stages.map((_,i)=>i+1));
   for(const e of snapshots){expect(e.data.sketch.fullyConstrained).toBe(true);if(e.data.preview){const response=await request.get(e.data.preview.url,{headers});expect(response.status()).toBe(200);expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(e.data.preview.sha256);}}
   const paths:Record<string,string>={};
   for(const extension of ['FCStd','STEP','GLB']){const download=await exportModel(page,extension);paths[extension]=info.outputPath(`${name}-${index}-${download.suggestedFilename()}`);await download.saveAs(paths[extension]);}
   const planPath=info.outputPath(`${name}-${index}-approved-plan.json`);writeFileSync(planPath,JSON.stringify(job.plan,null,2));
   expect(execFileSync('python',['scripts/verify-operation-downloads.py',paths.FCStd,paths.STEP,paths.GLB,planPath,index===0?name:name==='triangle'?'triangle-edit':'bracket-hole'],{encoding:'utf8'})).toContain('operation-downloads: passed');
   writeFileSync(info.outputPath(`${name}-${index}-evidence.json`),JSON.stringify({job,validation:state.validation,events},null,2));
   await page.screenshot({path:info.outputPath(`${name}-${index}-formal.png`),fullPage:true});
  }
  await page.reload();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 2');
 }
});
