import {test,expect} from 'vitest';
import {mkdtempSync,readdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {RevisionStore} from '../gateway/revision-store.ts';
import {Supervisor} from '../gateway/supervisor.ts';
import plate from './fixtures/models/plate.json';
import {approvedProgram} from './helpers/approved-program.ts';

test('projects and conversations persist independently and reject foreign conversation ownership',()=>{
 const root=mkdtempSync(resolve('.work/projects-'));let store=new RevisionStore(root);
 try{
  store.createDocument('alpha','甲项目');store.createDocument('beta','乙项目');
  const first=store.createConversation('alpha','尺寸讨论'),second=store.createConversation('alpha','开孔讨论');
  store.renameConversation('alpha',first.id,'底座尺寸');
  expect(store.listDocuments().map((p:any)=>p.name).sort()).toEqual(['乙项目','甲项目'].sort());
  expect(()=>store.conversation('beta',first.id)).toThrow();
  expect(store.conversation('alpha',first.id).title).toBe('底座尺寸');
  expect(store.messages('alpha',second.id).messages).toEqual([]);
  store.close();store=new RevisionStore(root);
  expect(store.listConversations('alpha')).toHaveLength(3);
  expect(store.listConversations('beta')).toHaveLength(1);
  expect(store.snapshot('alpha').revision).toBe(0);
 }finally{store.close();}
});

test('legacy SQLite upgrade preserves jobs and backfills messages exactly once',()=>{
 const root=mkdtempSync(resolve('.work/migrate-'));const db=new DatabaseSync(resolve(root,'store.sqlite'));
 db.exec("CREATE TABLE documents(id TEXT PRIMARY KEY,head INTEGER NOT NULL DEFAULT 0,health TEXT NOT NULL DEFAULT 'healthy'); CREATE TABLE jobs(document_id TEXT NOT NULL,operation_id TEXT NOT NULL,status TEXT NOT NULL,request_hash TEXT NOT NULL,job TEXT NOT NULL,PRIMARY KEY(document_id,operation_id)); INSERT INTO documents(id) VALUES('old');");
 const job={documentId:'old',operationId:'task',status:'answered',baseRevision:0,request:{kind:'text',text:'请记住项目尺寸'},agent:{messages:[{role:'user',content:'injected snapshot'},{role:'assistant',content:[{type:'text',text:'已记录'}],stopReason:'stop'}]}};
 db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run('old','task','answered','hash',JSON.stringify(job));db.close();
 for(let i=0;i<2;i++){const store=new RevisionStore(root);try{const conversation=store.listConversations('old')[0];const history=store.messages('old',conversation.id);expect(history.messages.map((m:any)=>m.content)).toEqual(['请记住项目尺寸',[{type:'text',text:'已记录'}]]);expect(store.snapshot('old').jobs).toHaveLength(1);}finally{store.close();}}
});

test('legacy upgrade backs up actual formal CAD packages and preserves the revision head',async()=>{
 const root=mkdtempSync(resolve('.work/migrate-cad-'));let store=new RevisionStore(root);store.createDocument('part');
 const supervisor=await Supervisor.start(store);
 try{approvedProgram(supervisor,'part',0,'create',plate);expect((await supervisor.waitForJob('part','create')).status).toBe('committed');}finally{await supervisor.close();store.close();}
 // Remove only the added workspace schema to reproduce the original SQLite layout.
 const legacy=new DatabaseSync(resolve(root,'store.sqlite'));
 legacy.exec('DROP TABLE messages; DROP TABLE conversations; ALTER TABLE jobs DROP COLUMN conversation_id; ALTER TABLE documents DROP COLUMN name; ALTER TABLE documents DROP COLUMN created_at; ALTER TABLE documents DROP COLUMN updated_at; PRAGMA user_version=0;');legacy.close();
 const backupsBefore=new Set(readdirSync(root).filter(name=>name.startsWith('before-workspace-')));
 store=new RevisionStore(root);
 try{
  expect(store.snapshot('part').revision).toBe(1);expect(store.snapshot('part').tree).toEqual(expect.any(Array));
  const backup=readdirSync(root).find(name=>name.startsWith('before-workspace-')&&!backupsBefore.has(name))!;
  const original=store.artifactPath('part',1,'model.FCStd'),relative=original.slice(root.length+1);
  expect(readFileSync(resolve(root,backup,relative))).toEqual(readFileSync(original));
  const saved=new DatabaseSync(resolve(root,backup,'store.sqlite'),{readOnly:true});
  try{expect(saved.prepare('SELECT head FROM documents WHERE id=?').get('part')).toMatchObject({head:1});expect(saved.prepare('PRAGMA user_version').get()).toMatchObject({user_version:0});}finally{saved.close();}
 }finally{store.close();}
 store=new RevisionStore(root);try{expect(store.snapshot('part').revision).toBe(1);expect(store.listConversations('part')).toHaveLength(1);expect(readdirSync(root).filter(name=>name.startsWith('before-workspace-'))).toHaveLength(backupsBefore.size+1);}finally{store.close();}
});
