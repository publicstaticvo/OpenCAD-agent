import {expect,type APIRequestContext,type Page} from '@playwright/test';
export const token='e2e-local-access-0123456789abcdef';export const headers={Authorization:`Bearer ${token}`};
export async function createDocument(request:APIRequestContext,id:string){const r=await request.post('/api/documents',{headers,data:{id}});expect(r.status()).toBe(201);}
export async function programJob(request:APIRequestContext,id:string,baseRevision:number,operationId:string,program:any){const r=await request.post(`/api/documents/${id}/jobs`,{headers,data:{baseRevision,operationId,program}});expect(r.status()).toBe(202);await expect.poll(async()=>{const j=await request.get(`/api/documents/${id}/jobs/${operationId}`,{headers});return(await j.json()).status;},{timeout:15000}).toBe('committed');}
export async function login(page:Page,id:string){await page.goto(`/?document=${id}`);await page.getByLabel('访问密钥').fill(token);await page.getByRole('button',{name:'连接工作区'}).click();}
