import {test,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {RevisionStore} from '../gateway/revision-store.ts';
import {Supervisor} from '../gateway/supervisor.ts';
import {createGateway} from '../gateway/server.ts';
import plate from './fixtures/models/plate.json';
import {selectHistory} from '../gateway/pi-adapter.mjs';

test('history trimming keeps complete tool rounds and marks historical geometry revisions',()=>{
 const round=(id:number)=>[{role:'user',content:`尺寸讨论 ${id}`,cadBaseRevision:id},{role:'assistant',content:[{type:'toolCall',id:`inspect-${id}`,name:'cad_inspect',arguments:{}}]},{role:'toolResult',toolCallId:`inspect-${id}`,toolName:'cad_inspect',content:[{type:'text',text:'{}'}]}];
 const first=round(1),second=round(2),budget=Buffer.byteLength(JSON.stringify(second));
 const selected=selectHistory([...first,...second],budget);
 expect(selected.included).toBe(1);expect(selected.omitted).toBe(1);expect(selected.messages).toHaveLength(3);
 expect(selected.messages[0].content).toContain('Historical CAD revision 2');
 expect(selected.messages[1].content[0].id).toBe(selected.messages[2].toolCallId);
 expect(selectHistory([...first,...second],1).messages).toEqual([]);
});

test('project write ownership covers queued jobs, conversations and restore, preserving idempotency',async()=>{
 const store=new RevisionStore(mkdtempSync(resolve('.work/conversation-lock-')));store.createDocument('alpha');store.createDocument('beta');
 const first=store.listConversations('alpha')[0],second=store.createConversation('alpha'),foreign=store.listConversations('beta')[0];
 const supervisor=await Supervisor.start(store);
 try{
  expect(()=>supervisor.submit('alpha',0,'foreign',plate,foreign.id)).toThrow('对话');
  const job=supervisor.submit('alpha',0,'first',plate,first.id);
  expect(supervisor.submit('alpha',0,'first',plate,first.id)).toEqual(job);
  expect(()=>supervisor.submit('alpha',0,'second',plate,second.id)).toThrow('项目正在修改');
  expect(()=>store.restoreRevision('alpha',1,0,'restore')).toThrow('项目正在修改');
  supervisor.cancelJob('alpha','first');await supervisor.waitForJob('alpha','first');
  expect(supervisor.submit('alpha',0,'second',plate,second.id).conversationId).toBe(second.id);
  supervisor.cancelJob('alpha','second');await supervisor.waitForJob('alpha','second');
  expect(store.snapshot('alpha').revision).toBe(0);
 }finally{await supervisor.close();store.close();}
});

test('HTTP project/conversation management checks ownership and persists pagination',async()=>{
 const token='conversation-test-access-0123456789';const app=await createGateway({dataDir:mkdtempSync(resolve('.work/conversation-api-')),accessToken:token,port:0});
 const request=async(path:string,method='GET',body?:unknown)=>fetch(app.baseUrl+'/api/documents'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 try{
  expect((await request('','POST',{id:'alpha',name:'甲项目'})).status).toBe(201);
  await request('','POST',{id:'beta',name:'乙项目'});
  expect((await (await request('')).json()).documents).toHaveLength(2);
  expect((await request('/alpha','PATCH',{name:'底座项目'})).status).toBe(200);
  const conversation=await (await request('/alpha/conversations','POST',{title:'尺寸讨论'})).json();
  expect((await request(`/beta/conversations/${conversation.id}`)).status).toBe(404);
  expect((await request(`/alpha/conversations/${conversation.id}`,'PATCH',{title:'底座尺寸'})).status).toBe(200);
  expect((await (await request(`/alpha/conversations/${conversation.id}/messages?afterOrdinal=0&limit=1`)).json()).messages).toEqual([]);
  expect((await request(`/alpha/conversations/${conversation.id}/messages?limit=0`)).status).toBe(400);
 }finally{await app.close();}
});
