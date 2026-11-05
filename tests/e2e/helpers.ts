import {expect,type APIRequestContext,type Page} from '@playwright/test';
export const token='e2e-local-access-0123456789abcdef';export const headers={Authorization:`Bearer ${token}`};
export async function createDocument(request:APIRequestContext,id:string){const r=await request.post('/api/documents',{headers,data:{id}});expect(r.status()).toBe(201);}
export async function programJob(request:APIRequestContext,id:string,baseRevision:number,operationId:string,program:any){const r=await request.post(`/api/documents/${id}/jobs`,{headers,data:{baseRevision,operationId,program}});expect(r.status()).toBe(202);const job=await r.json();expect(job.status).toBe('awaiting_approval');expect((await request.post(`/api/documents/${id}/jobs/${operationId}/approve`,{headers,data:{planHash:job.plan.planHash}})).status()).toBe(200);await expect.poll(async()=>{const j=await request.get(`/api/documents/${id}/jobs/${operationId}`,{headers});return(await j.json()).status;},{timeout:15000}).toBe('committed');}
export async function login(page:Page,id:string){await page.goto(`/?document=${id}`);await page.getByLabel('访问密钥').fill(token);await page.getByRole('button',{name:'连接工作区'}).click();}
export async function editorCommand(page:Page,name:string,menu='文件'){await page.getByRole('menuitem',{name:menu,exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();}
export async function showActivity(page:Page){await page.getByRole('tab',{name:'活动历史',exact:true}).click();}
export async function exportModel(page:Page,format:string){
 const menu=page.locator('.export-menu');if(await menu.getAttribute('open')===null)await menu.locator('summary').click();
 const labels:Record<string,string>={FCStd:'导出 FreeCAD 文档（.FCStd）',STEP:'导出 STEP（.step）',GLB:'导出 GLB（.glb）'};
 const pending=page.waitForEvent('download');await page.getByRole('menuitem',{name:labels[format],exact:true}).click();return pending;
}
