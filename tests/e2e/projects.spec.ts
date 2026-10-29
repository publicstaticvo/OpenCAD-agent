import {test,expect} from '@playwright/test';
import plate from '../fixtures/models/plate.json' with {type:'json'};
import ring from '../fixtures/models/ring.json' with {type:'json'};
import {createDocument,programJob,login,headers} from './helpers.ts';

test('project switch discards an actual delayed GLB and restores independent model and conversations',async({page,request})=>{
 const a=`switch-a-${Date.now()}`,b=`switch-b-${Date.now()}`;
 await createDocument(request,a);await createDocument(request,b);
 await programJob(request,a,0,'create',plate);await programJob(request,b,0,'create',ring);
 await login(page,a);await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');
 const firstConversation=new URL(page.url()).searchParams.get('conversation');
 let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);let requested=false;
 await page.route(`**/${a}/revisions/2/artifacts/preview.glb`,async route=>{const response=await route.fetch();requested=true;await held;await route.fulfill({response});});
 await programJob(request,a,1,'edit',{operations:[{op:'set_parameter',feature:'hole',parameter:'diameter',value:8}],criteria:{bbox:[80,60,10],volume:48000-Math.PI*16*10}});
 await expect.poll(()=>requested).toBe(true);
 await page.getByLabel('切换项目').selectOption(b);await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');
 const secondConversation=new URL(page.url()).searchParams.get('conversation');expect(secondConversation).not.toBe(firstConversation);
 release();await expect(page.getByTestId('mesh-stats')).toContainText('WebGL');
 const second=await(await request.get(`/api/documents/${b}`,{headers})).json();
 const ids=second.tree.map((feature:any)=>feature.id);
 await expect(page.getByLabel('特征树').getByRole('button')).toHaveCount(ids.length);
 await expect(page.getByRole('button',{name:'hole 草图',exact:true})).toHaveCount(0);
 page.once('dialog',dialog=>dialog.accept('垫套项目'));await page.getByRole('button',{name:'项目重命名'}).click();await expect(page.getByLabel('切换项目')).toContainText('垫套项目');
 await page.reload();await expect(page.getByLabel('切换项目')).toHaveValue(b);await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');
 await page.getByLabel('切换项目').selectOption(a);await expect(page.getByTestId('display-revision')).toHaveText('正式版本 2');await page.getByRole('button',{name:'hole 草图',exact:true}).click();await expect(page.getByLabel('diameter (mm)')).toHaveValue('8');
});

test('separate conversations can hold read-only pending plans and stale approval cannot modify the shared model',async({page,request})=>{
 const id=`pending-${Date.now()}`;await createDocument(request,id);await login(page,id);
 const first=new URL(page.url()).searchParams.get('conversation')!;
 const pending=await request.post(`/api/documents/${id}/jobs`,{headers,data:{operationId:'first-plan',baseRevision:0,conversationId:first,program:plate}});expect(pending.status()).toBe(202);
 await page.getByRole('button',{name:'刷新状态',exact:true}).click();await expect(page.getByTestId('approval-plan')).toBeVisible();
 await page.getByRole('button',{name:'新建对话',exact:true}).click();
 await expect(page.getByLabel('建模指令')).toBeEnabled();
 await expect(page.getByText('当前模型正在由该对话修改。',{exact:false})).toHaveCount(0);
 await page.getByLabel('建模指令').fill('创建80×60×10 mm孔板，孔径6 mm，孔中心20,15 mm');await page.getByRole('button',{name:'发送任务',exact:true}).click();
 await expect(page.getByTestId('approval-plan')).toBeVisible();
 const second=new URL(page.url()).searchParams.get('conversation')!;
 const before=await(await request.get(`/api/documents/${id}`,{headers})).json();expect(before.revision).toBe(0);expect(before.jobs.filter((job:any)=>job.status==='awaiting_approval')).toHaveLength(2);
 await page.getByLabel('切换对话').selectOption(first);await page.getByRole('button',{name:'批准并开始建模'}).click();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');
 await page.getByLabel('切换对话').selectOption(second);await page.getByRole('button',{name:'批准并开始建模'}).click();await expect(page.getByTestId('submission-error')).toContainText('stale');
 expect((await(await request.get(`/api/documents/${id}`,{headers})).json()).revision).toBe(1);
});
