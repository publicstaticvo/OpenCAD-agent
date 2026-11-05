import {test,expect} from '@playwright/test';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {headers,createDocument,login,exportModel,editorCommand} from './helpers.ts';
import {projectZip,readProjectZip} from '../../web/src/project-files.ts';

test('multi-file editor imports, diffs, runs real FreeCAD and accepts the exact candidate',async({page,request})=>{
 const id=`multi-project-${Date.now()}`,root=`/api/documents/${id}`;await createDocument(request,id);await login(page,id);
 await page.getByRole('button',{name:'模型与源码左右并列'}).click();
 const project={files:{'main.FCMacro':"import FreeCAD as App, Part\nfrom cad.shape import dimensions\ndoc=App.newDocument('Project')\nobj=doc.addObject('PartDesign::Feature','Box')\nobj.Shape=Part.makeBox(*dimensions())\ndoc.recompute()\n",'cad/__init__.py':'','cad/shape.py':'def dimensions(): return (40,30,10)\n'},directories:['cad'],entrypoint:'main.FCMacro'};
 await page.getByLabel('导入 Python 源文件').setInputFiles({name:'project.zip',mimeType:'application/zip',buffer:Buffer.from(projectZip(project))});
 await expect(page.getByRole('tab',{name:/main.FCMacro/})).toBeVisible();await editorCommand(page,'保存全部');
 await expect(page.getByTestId('source-version-state')).toContainText('已保存到项目工作副本');expect((await(await request.get(root+'/sources',{headers})).json()).versions).toHaveLength(0);
 await page.getByLabel('打开文件 cad/shape.py',{exact:true}).click();await expect(page.locator('.cm-content:visible')).toContainText('40,30,10');await page.locator('.cm-content:visible').fill('def dimensions(): return (40,30,15)\n');
 await expect(page.getByTestId('source-diff')).toContainText('-def dimensions(): return (40,30,10)');await expect(page.getByTestId('source-diff')).toContainText('+def dimensions(): return (40,30,15)');
 await editorCommand(page,'运行项目','运行');
 await expect(page.getByTestId('approval-plan')).toHaveCount(0);await expect(page.getByRole('button',{name:'验收候选并提交'})).toBeVisible({timeout:20000});
 await expect(page.getByTestId('candidate-panel')).toContainText('[40, 30, 15]');const before=await(await request.get(root,{headers})).json();expect(before.revision).toBe(0);
 const job=before.jobs.find((value:any)=>value.status==='awaiting_acceptance');expect(job).toBeTruthy();
 mkdirSync('artifacts/source-workspace-and-activity',{recursive:true});await page.screenshot({path:resolve('artifacts/source-workspace-and-activity/project-candidate.png'),fullPage:true});
 await page.getByRole('button',{name:'验收候选并提交'}).click();await expect.poll(async()=>(await(await request.get(root,{headers})).json()).revision).toBe(1);
 const current=await(await request.get(root,{headers})).json();expect(current.validation.sourceVersionId).toBe(job.result.sourceVersionId);expect(current.validation.executionId).toBe(job.result.executionId);
 const download=await exportModel(page,'STEP');expect(await download.failure()).toBeNull();
 await page.getByRole('button',{name:'仅显示 Python 源码'}).click();const versions=await(await request.get(root+'/sources',{headers})).json();await page.getByLabel('选择源码版本').selectOption(versions.versions[0].versionId);
 await expect(page.getByTestId('historical-source')).toBeVisible();await expect(page.getByLabel('打开文件 cad/shape.py',{exact:true})).toBeVisible();await expect(page.getByTestId('source-diff').filter({hasText:'Index: cad/shape.py'})).toContainText('+def dimensions(): return (40,30,15)');
 await page.screenshot({path:resolve('artifacts/source-workspace-and-activity/project-file-diff.png'),fullPage:true});
 expect(readProjectZip(projectZip(project))).toEqual(project);
 await page.getByRole('button',{name:'返回工作副本',exact:true}).click();
 const zipEvent=page.waitForEvent('download');await editorCommand(page,'导出项目 ZIP');const zipDownload=await zipEvent;
 const zipPath=resolve('artifacts/source-workspace-and-activity/roundtrip-project.zip');await zipDownload.saveAs(zipPath);
 const imported=readProjectZip(readFileSync(zipPath));expect(imported.files['cad/shape.py']).toContain('40,30,15');expect(imported.entrypoint).toBe('main.FCMacro');
 const copiedId=`multi-copy-${Date.now()}`;await createDocument(request,copiedId);await page.goto(`/?document=${copiedId}`);await page.getByRole('button',{name:'模型与源码左右并列'}).click();
 await page.getByLabel('导入 Python 源文件').setInputFiles(zipPath);await page.getByLabel('运行当前文件',{exact:true}).click();
 await expect(page.getByRole('button',{name:'验收候选并提交'})).toBeVisible({timeout:20000});await expect(page.getByTestId('candidate-panel')).toContainText('[40, 30, 15]');
 expect((await(await request.get(`/api/documents/${copiedId}`,{headers})).json()).revision).toBe(0);
});

test('historical file and full-project adoption preserve exact immutable snapshots',async({page,request})=>{
 const id=`restore-project-${Date.now()}`,root=`/api/documents/${id}`;await createDocument(request,id);await login(page,id);await page.getByRole('button',{name:'仅显示 Python 源码'}).click();
 const project={files:{'main.py':'width = 40\n','other.py':'height = 10\n'},directories:[],entrypoint:'main.py'};
 await page.getByLabel('导入 Python 源文件').setInputFiles({name:'history.zip',mimeType:'application/zip',buffer:Buffer.from(projectZip(project))});await editorCommand(page,'创建源码检查点');await expect(page.getByTestId('source-version-state')).toContainText('项目检查点已保存');
 const first=(await(await request.get(root+'/sources',{headers})).json()).versions[0];
 await page.locator('.cm-content:visible').fill('width = 60\n');await page.getByLabel('打开文件 other.py',{exact:true}).click();await page.locator('.cm-content:visible').fill('height = 15\n');await editorCommand(page,'创建源码检查点');
 await expect.poll(async()=>(await(await request.get(root+'/sources',{headers})).json()).versions.length).toBe(2);
 await page.getByLabel('选择源码版本').selectOption(first.versionId);await page.getByLabel('打开文件 main.py',{exact:true}).click();await page.getByRole('button',{name:'采用所查看文件',exact:true}).click();
 await expect(page.locator('.cm-content:visible')).toContainText('width = 40');await editorCommand(page,'保存全部');
 await expect.poll(async()=>(await(await request.get(root+'/source/workspace',{headers})).json()).workspace.project.files).toEqual({'main.py':'width = 40\n','other.py':'height = 15\n'});
 await page.getByLabel('选择源码版本').selectOption(first.versionId);await page.getByRole('button',{name:'采用整个历史项目',exact:true}).click();await editorCommand(page,'保存全部');
 await expect.poll(async()=>(await(await request.get(root+'/source/workspace',{headers})).json()).workspace.project.files).toEqual(project.files);
 const history=(await(await request.get(root+'/sources',{headers})).json()).versions;expect(history).toHaveLength(2);const second=history.find((value:any)=>value.versionId!==first.versionId);const snapshot=await(await request.get(root+'/sources/'+second.versionId,{headers})).json();expect(snapshot.project.files).toEqual({'main.py':'width = 60\n','other.py':'height = 15\n'});
 expect((await(await request.get(root,{headers})).json()).revision).toBe(0);
});

test('per-file buffers, saved files and Agent conversation remain independent of historical viewing',async({page,request})=>{
 const id=`multi-buffers-${Date.now()}`,root=`/api/documents/${id}`;await createDocument(request,id);await login(page,id);await page.getByRole('button',{name:'仅显示 Python 源码'}).click();
 const project={files:{'main.py':'width = 40\n','other.py':'height = 10\n'},directories:[],entrypoint:'main.py'};
 await page.getByLabel('导入 Python 源文件').setInputFiles({name:'project.zip',mimeType:'application/zip',buffer:Buffer.from(projectZip(project))});await editorCommand(page,'创建源码检查点');await expect(page.getByTestId('source-version-state')).toContainText('项目检查点已保存');
 const versions=await(await request.get(root+'/sources',{headers})).json();const version=versions.versions[0];
 await page.locator('.cm-content:visible').fill('width = 60\n');await expect(page.getByLabel('建模指令')).toBeEnabled();
 await page.getByLabel('打开文件 other.py',{exact:true}).click();await page.locator('.cm-content:visible').fill('height = 15\n');await page.locator('.cm-content:visible').press('Control+s');await expect(page.getByTestId('source-version-state')).toContainText('已保存到项目工作副本');
 await page.getByLabel('打开文件 main.py',{exact:true}).click();await expect(page.locator('.cm-content:visible')).toContainText('width = 60');
 const working=await(await request.get(root+'/source/workspace',{headers})).json();expect(working.workspace.project.files['main.py']).toBe('width = 40\n');expect(working.workspace.project.files['other.py']).toBe('height = 15\n');
 await page.getByLabel('选择源码版本').selectOption(version.versionId);await expect(page.locator('.cm-content:visible')).toContainText('width = 40');await expect(page.getByLabel('建模指令')).toBeEnabled();await page.getByRole('button',{name:'返回工作副本',exact:true}).click();await expect(page.locator('.cm-content:visible')).toContainText('width = 60');
 const remote=await request.post(root+'/source',{headers,data:{source:'width = 70\n',parentVersionId:version.versionId}});expect(remote.status()).toBe(409);
 await editorCommand(page,'保存全部');const saved=await(await request.get(root+'/source/workspace',{headers})).json();expect(saved.workspace.project.files['main.py']).toBe('width = 60\n');
 const downloadEvent=page.waitForEvent('download');await editorCommand(page,'导出项目 ZIP');expect(await(await downloadEvent).failure()).toBeNull();
});

test('entry page searches real persisted project names',async({page,request})=>{
 const id=`find-project-${Date.now()}`;await createDocument(request,id);const renamed=await request.patch(`/api/documents/${id}`,{headers,data:{name:'可搜索的工程 '+id}});expect(renamed.status()).toBe(200);
 await page.goto('/');await page.getByLabel('访问密钥').fill('e2e-local-access-0123456789abcdef');await page.getByRole('button',{name:'连接工作区'}).click();await page.getByLabel('搜索项目').fill(id);await expect(page.getByRole('button',{name:new RegExp('可搜索的工程 '+id)})).toBeVisible();await page.getByRole('button',{name:new RegExp('可搜索的工程 '+id)}).click();await expect(page.getByLabel('切换项目')).toHaveValue(id);
});
