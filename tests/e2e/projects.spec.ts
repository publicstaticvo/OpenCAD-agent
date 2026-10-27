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
