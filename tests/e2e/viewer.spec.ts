import {test,expect} from '@playwright/test';import plate from '../fixtures/models/plate.json' with {type:'json'};import {createDocument,programJob,login,headers} from './helpers.ts';
test('real browser renders GLB geometry, correct top-view hole and synchronized tree/parameters',async({page,request,browser},testInfo)=>{
 const id='viewer-'+Date.now();await createDocument(request,id);await programJob(request,id,0,'create',plate);await login(page,id);
 await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');await expect(page.getByTestId('mesh-stats')).toContainText('WebGL');
 await expect(page.getByTestId('mesh-stats')).toHaveAttribute('data-triangles',/^[1-9]\d*$/);
 const bounds=JSON.parse((await page.getByTestId('mesh-stats').getAttribute('data-bounds'))!);expect(bounds[1][0]-bounds[0][0]).toBeCloseTo(.08,6);expect(bounds[1][1]-bounds[0][1]).toBeCloseTo(.01,6);expect(bounds[1][2]-bounds[0][2]).toBeCloseTo(.06,6);
 await page.getByRole('button',{name:'hole 草图'}).click();await expect(page.getByLabel('diameter (mm)')).toHaveValue('6');
 await page.getByRole('button',{name:'俯视'}).click();const canvas=page.getByLabel('三维模型');await expect(canvas).toHaveAttribute('data-view','top');
 const box=await canvas.boundingBox();expect(box).not.toBeNull();
 const image=await canvas.screenshot();const pixels=await page.evaluate(async({base64,w,h})=>{
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d')!;ctx.drawImage(bitmap,0,0);
  const span=.08*1.55,at=(x:number,y:number)=>Array.from(ctx.getImageData(Math.round(w/2+(x-.04)*h/span),Math.round(h/2-(y-.03)*h/span),1,1).data);
  return{hole:at(.02,.015),solid:at(.005,.005)};
 },{base64:image.toString('base64'),w:box!.width,h:box!.height});
 expect(pixels.hole[0]+pixels.hole[1]+pixels.hole[2]).toBeGreaterThan(pixels.solid[0]+pixels.solid[1]+pixels.solid[2]+50);
 await testInfo.attach('actual-top-view',{body:image,contentType:'image/png'});testInfo.annotations.push({type:'browser',description:browser.version()});
 await page.reload();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');await expect(page.getByTestId('mesh-stats')).toContainText('WebGL');
});

const edit=(diameter:number)=>({operations:[{op:'set_parameter',feature:'hole',parameter:'diameter',value:diameter}],criteria:{bbox:[80,60,10],volume:48000-Math.PI*(diameter/2)**2*10,parameters:[{feature:'hole',parameter:'diameter',value:diameter}]}});
test('late GLB cannot replace a newer complete revision; before/after uses complete versions',async({page,request})=>{
 const id='late-'+Date.now();await createDocument(request,id);await programJob(request,id,0,'create',plate);await login(page,id);await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');
 let release!:()=>void;const held=new Promise<void>(r=>release=r);let requested=false;
 await page.route('**/revisions/2/artifacts/preview.glb',async route=>{requested=true;const response=await route.fetch();await held;await route.fulfill({response});});
 await programJob(request,id,1,'edit8',edit(8));await expect.poll(()=>requested).toBe(true);await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');
 await programJob(request,id,2,'edit10',edit(10));await expect(page.getByTestId('display-revision')).toHaveText('正式版本 3');release();
 await page.getByRole('button',{name:'hole 草图'}).click();await expect(page.getByLabel('diameter (mm)')).toHaveValue('10');
 await page.getByRole('button',{name:'查看修改前'}).click();await expect(page.getByTestId('display-revision')).toHaveText('历史版本 1');await expect(page.getByLabel('diameter (mm)')).toHaveValue('6');await expect(page.getByLabel('diameter (mm)')).toBeDisabled();
 await page.getByRole('button',{name:'查看当前版本'}).click();await expect(page.getByLabel('diameter (mm)')).toHaveValue('10');
});
test('actual socket disconnect, duplicate/out-of-order events and reconnect recover authoritative snapshot',async({page,request})=>{
 await page.addInitScript(()=>{const Native=window.WebSocket;(window as any).cadSockets=[];window.WebSocket=class extends Native{constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);(window as any).cadSockets.push(this);}};});
 const id='reconnect-'+Date.now();await createDocument(request,id);await programJob(request,id,0,'create',plate);await login(page,id);await expect(page.getByText('已连接',{exact:true})).toBeVisible();
 await page.evaluate(()=>{(window as any).cadSockets.at(-1).close();});await expect(page.getByText('连接恢复中')).toBeVisible();await programJob(request,id,1,'edit',edit(8));
 await expect(page.getByTestId('display-revision')).toHaveText('正式版本 2');await expect(page.getByText('已连接',{exact:true})).toBeVisible();
 await page.evaluate(id=>{const ws=(window as any).cadSockets.at(-1);for(const seq of [99999,1,1])ws.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'event',event:{documentId:id,seq,revision:1}})}));},id);
 await programJob(request,id,2,'next',edit(10));await expect(page.getByTestId('display-revision')).toHaveText('正式版本 3');await page.getByRole('button',{name:'hole 草图'}).click();await expect(page.getByLabel('diameter (mm)')).toHaveValue('10');
});
test('missing preview is an explicit failure and keeps the last complete version until retry',async({page,request})=>{
 const id='missing-'+Date.now();await createDocument(request,id);await programJob(request,id,0,'create',plate);await login(page,id);await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');
 await page.route('**/revisions/2/artifacts/preview.glb',route=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({message:'预览文件不存在'})}));
 await programJob(request,id,1,'edit',edit(8));await expect(page.getByRole('alert')).toContainText('预览文件不存在');await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');
 await page.unroute('**/revisions/2/artifacts/preview.glb');await page.getByRole('button',{name:'刷新状态'}).click();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 2');
});
