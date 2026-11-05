import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {headers,createDocument,login,editorCommand,showActivity} from './helpers.ts';

test('source saves stay idle; approved explicit version runs preview, deliver and preserve formal on errors',async({page,request},info)=>{
 const id=`sources-${Date.now()}`,root=`/api/documents/${id}`;await createDocument(request,id);await login(page,id);
 const source="import FreeCAD as App, Part\ndoc=App.newDocument('Model')\nobj=doc.addObject('PartDesign::Feature','Box')\nobj.Shape=Part.makeBox(20,30,40)\ndoc.recompute()\n";
 async function save(content:string,parentVersionId:string|null){const response=await request.post(`${root}/source`,{headers,data:{source:content,parentVersionId}});expect(response.status()).toBe(201);return response.json();}
 async function run(operationId:string,version:any,baseRevision:number,criteria:any,expected:string){
  const response=await request.post(`${root}/jobs`,{headers,data:{operationId,baseRevision,run:{sourceVersionId:version.versionId,sourceHash:version.sourceHash,...(criteria?{criteria}:{})}}});expect(response.status()).toBe(202);
  await expect(page.getByTestId('approval-plan')).toHaveCount(0);
  if(expected==='committed'){await expect(page.getByRole('button',{name:'验收候选并提交'})).toBeVisible({timeout:20000});await page.getByRole('button',{name:'验收候选并提交'}).click();}
  await expect.poll(async()=>{const job=await(await request.get(`${root}/jobs/${operationId}`,{headers})).json();if(expected==='committed'&&job.status==='failed')throw new Error(job.error);return job.status;},{timeout:20000}).toBe(expected);
  return(await request.get(root,{headers})).json();
 }
 const first=await save(source,null);const second=await save(source.replace('20,30,40','20,35,40'),first.versionId);const third=await save(source.replace('20,30,40','20,45,40'),second.versionId);
 const idle=await(await request.get(root,{headers})).json();expect(idle.revision).toBe(0);expect(idle.jobs).toHaveLength(0);expect(idle.progress.filter((e:any)=>e.type==='python_execution')).toHaveLength(0);
 const saved=await(await request.get(`${root}/sources/${first.versionId}`,{headers})).json();expect(saved.source).toBe(source);
 const completed=await run('run-latest',third,0,{bbox:[20,45,40],volume:36000},'committed');expect(completed.validation.sourceVersionId).toBe(third.versionId);
 await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');await expect(page.getByTestId('mesh-stats')).toContainText('WebGL');
 const formal=await request.get(completed.artifacts['model.FCStd'],{headers});const hash=createHash('sha256').update(await formal.body()).digest('hex');
 const failedVersion=await save('def broken(:',third.versionId);await run('run-error',failedVersion,1,{bbox:[20,45,40],volume:36000},'failed');
 await showActivity(page);await expect(page.getByTestId('python-execution').filter({hasText:'SyntaxError'})).toBeVisible();
 await page.getByRole('button',{name:'仅显示 Python 源码'}).click();await page.getByLabel('选择源码版本').selectOption(failedVersion.versionId);await expect(page.getByTestId('source-diff')).toContainText('+def broken(:');await page.getByRole('button',{name:'仅显示模型'}).click();
 const unchanged=await request.get(completed.artifacts['model.FCStd'],{headers});expect(createHash('sha256').update(await unchanged.body()).digest('hex')).toBe(hash);
 const healthy=await save(source,failedVersion.versionId);const diagnostic=await run('diagnostic',healthy,1,{bbox:[20,31,40],volume:24800},'failed');expect(diagnostic.revision).toBe(1);
 expect(diagnostic.progress.some((event:any)=>event.type==='python_diagnostic')).toBe(true);
 await showActivity(page);await page.getByText('查看实际诊断模型',{exact:true}).click();await expect(page.getByTestId('recorded-candidate')).toContainText('未通过任务验收');await expect(page.getByTestId('recorded-candidate').getByTestId('mesh-stats')).toContainText('WebGL');
 await page.reload();await expect(page.getByTestId('display-revision')).toHaveText('正式版本 1');
 await showActivity(page);await page.getByText('查看实际诊断模型',{exact:true}).click();await expect(page.getByTestId('recorded-candidate').getByTestId('mesh-stats')).toContainText('WebGL');
 await page.getByLabel('导出模型',{exact:true}).click();
 const download=page.waitForEvent('download');await page.getByRole('menuitem',{name:'导出 STEP（.step）'}).click();await(await download).saveAs(info.outputPath('formal-r1.step'));
 await page.getByLabel('导出模型',{exact:true}).click();
 await page.getByRole('button',{name:'模型与源码左右并列'}).click();await page.getByLabel('选择源码版本').selectOption(healthy.versionId);await expect(page.getByTestId('source-diff')).toContainText('+import FreeCAD');
 mkdirSync('artifacts/source-workspace-and-activity',{recursive:true});await page.screenshot({path:resolve('artifacts/source-workspace-and-activity/source-model-workspace.png'),fullPage:true});
 await page.screenshot({path:info.outputPath('source-execution-versions.png'),fullPage:true});
});

test('Python workspace opens the project source and displays each saved parent diff',async({page,request},info)=>{
 const id=`source-ui-${Date.now()}`,root=`/api/documents/${id}`;await createDocument(request,id);await login(page,id);
 const original="import FreeCAD as App, Part\ndoc=App.newDocument('Model')\nobj=doc.addObject('PartDesign::Feature','Box')\nobj.Shape=Part.makeBox(20,30,40)\ndoc.recompute()\n";
 const first=await(await request.post(`${root}/source`,{headers,data:{source:original,parentVersionId:null}})).json();
 await page.getByRole('button',{name:'仅显示 Python 源码'}).click();await expect(page.getByTestId('source-workspace')).toBeVisible();
 await expect(page.getByLabel('Project Explorer')).toContainText('script.py');await expect(page.locator('.cm-content')).toContainText("Part.makeBox(20,30,40)");
 const editor=page.locator('.cm-content');await editor.fill(original.replace('20,30,40','20,35,40'));await editor.press('Control+s');await expect(page.getByTestId('source-version-state')).toContainText('已保存到项目工作副本');
 await page.reload();await page.getByRole('button',{name:'仅显示 Python 源码'}).click();await expect(page.locator('.cm-content')).toContainText("Part.makeBox(20,35,40)");
 await editorCommand(page,'创建源码检查点');await expect(page.getByTestId('source-version-state')).toContainText('项目检查点已保存');
 const history=(await(await request.get(`${root}/sources`,{headers})).json()).versions;await page.getByLabel('选择源码版本').selectOption(history.at(-1).versionId);
 await expect(page.getByTestId('source-diff')).toContainText('-obj.Shape=Part.makeBox(20,30,40)');
 await expect(page.getByTestId('source-diff')).toContainText('+obj.Shape=Part.makeBox(20,35,40)');
 const snapshot=await(await request.get(`${root}/sources`,{headers})).json();expect(snapshot.versions).toHaveLength(2);expect(snapshot.versions[1].parentVersionId).toBe(first.versionId);
 await editorCommand(page,'下载当前文件');
 mkdirSync('artifacts/source-workspace-and-activity',{recursive:true});await page.screenshot({path:resolve('artifacts/source-workspace-and-activity/source-diff.png'),fullPage:true});
 await page.screenshot({path:info.outputPath('python-source-diff.png'),fullPage:true});
});

test('saving conflicts preserve the editor and viewing historical diffs leaves the draft unchanged',async({page,request})=>{
 const id=`source-conflict-${Date.now()}`,root=`/api/documents/${id}`;await createDocument(request,id);const first=await(await request.post(`${root}/source`,{headers,data:{source:'width=20\n',parentVersionId:null}})).json();await login(page,id);
 await page.getByRole('button',{name:'仅显示 Python 源码'}).click();const editor=page.locator('.cm-content');await expect(editor).toContainText('width=20');await editor.fill('width=25\n');
 const remote=await request.put(`${root}/source/workspace`,{headers,data:{source:'width=27\n',baseVersionId:first.versionId,expectedBaseVersionId:first.versionId,draftRevision:0}});expect(remote.status()).toBe(200);
 await editor.press('Control+s');await expect(page.getByRole('alert')).toContainText('你的内容仍保留');await expect(editor).toContainText('width=25');
 await page.getByLabel('选择源码版本').selectOption(first.versionId);await expect(page.getByTestId('source-diff')).toContainText('+width=20');await expect(editor).toContainText('width=20');await page.getByRole('button',{name:'返回工作副本',exact:true}).click();await expect(editor).toContainText('width=25');
 const saved=await(await request.get(`${root}/source/workspace`,{headers})).json();expect(saved.workspace.source).toBe('width=27\n');
 await page.getByRole('button',{name:'保存冲突检查点'}).click();await expect(page.getByTestId('source-diff')).toContainText('+width=25');await expect(editor).toContainText('width=25');
 const versions=await(await request.get(`${root}/sources`,{headers})).json();expect(versions.versions).toHaveLength(2);await page.getByRole('button',{name:'采用我的项目版本'}).click();await expect.poll(async()=>(await(await request.get(`${root}/source/workspace`,{headers})).json()).workspace.source).toBe('width=25\n');
});

test('export menu has only formal model formats and cannot export revision zero',async({page,request})=>{
 const id=`source-export-${Date.now()}`;await createDocument(request,id);await login(page,id);
 await page.getByLabel('导出模型',{exact:true}).click();await expect(page.getByRole('menuitem')).toHaveText(['导出 FreeCAD 文档（.FCStd）','导出 STEP（.step）','导出 GLB（.glb）']);
 for(const item of await page.getByRole('menuitem').all())await expect(item).toBeDisabled();
 await expect(page.locator('.export-menu')).toHaveCount(1);await expect(page.getByRole('button',{name:/^下载 (FCStd|STEP|GLB)$/})).toHaveCount(0);await expect(page.getByText('当前没有可导出的正式修订')).toBeVisible();
});

test('a new project can import and save its initial Python source version',async({page,request})=>{
 const id=`source-import-${Date.now()}`,root=`/api/documents/${id}`;await createDocument(request,id);await login(page,id);
 await page.getByRole('button',{name:'仅显示 Python 源码'}).click();await expect(page.getByTestId('source-workspace')).toBeVisible();
 const imported="import FreeCAD as App\ndoc=App.newDocument('Imported')\n";
 await page.getByLabel('导入 Python 源文件').setInputFiles({name:'imported.py',mimeType:'text/x-python',buffer:Buffer.from(imported)});
 await expect(page.locator('.cm-content')).toContainText("doc=App.newDocument('Imported')");await editorCommand(page,'创建源码检查点');
 await expect(page.getByTestId('source-version-state')).toContainText('项目检查点已保存');await expect(page.locator('.cm-content')).toContainText("doc=App.newDocument('Imported')");
 const importedVersions=(await(await request.get(`${root}/sources`,{headers})).json()).versions;await page.getByLabel('选择源码版本').selectOption(importedVersions[0].versionId);
 const snapshot=await(await request.get(`${root}/sources`,{headers})).json();expect(snapshot.versions).toHaveLength(1);expect(snapshot.versions[0].parentVersionId).toBeNull();expect(snapshot.versions[0].actor).toBe('user');
 await expect(page.getByTestId('source-diff')).toContainText('+import FreeCAD as App');
 await showActivity(page);await expect(page.locator('[data-activity=source]').last()).toContainText('用户导入源码');
 const state=await(await request.get(root,{headers})).json();expect(state.jobs).toHaveLength(0);expect(state.progress.filter((event:any)=>event.type==='python_execution')).toHaveLength(0);
});

test('CodeMirror supports undo redo search and layout changes preserve the work copy',async({page,request})=>{
 const id=`source-editor-${Date.now()}`,root=`/api/documents/${id}`;await createDocument(request,id);await login(page,id);
 await page.getByRole('button',{name:'仅显示 Python 源码'}).click();const editor=page.locator('.cm-content');
 await editor.fill('value = 1\n');await editor.press('Control+z');await expect(editor).toHaveText('');await editor.press('Control+Shift+z');await expect(editor).toContainText('value = 1');
 await editor.press('Control+f');await expect(page.locator('.cm-search')).toBeVisible();await page.locator('.cm-search input[name=search]').fill('value');await page.keyboard.press('Tab');await page.locator('.cm-search input[name=replace]').fill('width');await page.keyboard.press('Tab');await page.locator('.cm-search button[name=replaceAll]').click();await expect(editor).toContainText('width = 1');await page.keyboard.press('Escape');await editor.press('Control+z');await expect(editor).toContainText('value = 1');
 await page.getByRole('button',{name:'模型与源码左右并列'}).click();await expect(page.locator('.stage-panel')).toHaveClass(/layout-side/);await expect(editor).toContainText('value = 1');
 await page.getByRole('separator',{name:'调整模型与源码区域大小'}).focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('separator',{name:'调整模型与源码区域大小'})).toHaveAttribute('aria-valuenow','55');
 await editor.click();await editor.press('Control+s');await expect(page.getByTestId('source-version-state')).toContainText('已保存到项目工作副本');
 await page.getByRole('button',{name:'仅显示模型'}).click();await page.reload();await expect(page.getByRole('button',{name:'仅显示模型'})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'仅显示 Python 源码'}).click();await expect(editor).toContainText('value = 1');
 const workspace=await(await request.get(`${root}/source/workspace`,{headers})).json();expect(workspace.workspace.source).toContain('value = 1');
 await editor.press('Control+s');await editor.press('Control+s');expect((await(await request.get(`${root}/sources`,{headers})).json()).versions).toHaveLength(0);
 expect((await(await request.get(root,{headers})).json()).jobs).toHaveLength(0);
 await page.getByRole('button',{name:'模型与源码上下并列'}).click();await expect(page.getByRole('button',{name:'模型与源码上下并列'})).toHaveAttribute('title','模型与源码上下并列');
 const separator=page.getByRole('separator',{name:'调整模型与源码区域大小'}),box=await separator.boundingBox();if(!box)throw new Error('Visible separator missing');await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2+45);await page.mouse.up();expect(Number(await separator.getAttribute('aria-valuenow'))).toBeGreaterThan(55);
 await page.reload();await expect(page.getByRole('button',{name:'模型与源码上下并列'})).toHaveAttribute('aria-pressed','true');
});

test('multiple source diffs remain individually accessible without replacing user edits',async({page,request})=>{
 const id=`source-diffs-${Date.now()}`,root=`/api/documents/${id}`;await createDocument(request,id);
 const first=await(await request.post(`${root}/source`,{headers,data:{source:'width=20\n',parentVersionId:null}})).json(),second=await(await request.post(`${root}/source`,{headers,data:{source:'width=30\n',parentVersionId:first.versionId}})).json(),third=await(await request.post(`${root}/source`,{headers,data:{source:'width=40\n',parentVersionId:second.versionId}})).json();
 await login(page,id);await page.getByRole('button',{name:'仅显示 Python 源码'}).click();const editor=page.locator('.cm-content');await expect(editor).toContainText('width=40');await editor.fill('width=45\n');
 for(const [version,previous,value] of [[second,20,30],[third,30,40]] as const){await page.getByLabel('选择源码版本').selectOption(version.versionId);await expect(page.getByTestId('source-diff')).toContainText(`-width=${previous}`);await expect(page.getByTestId('source-diff')).toContainText(`+width=${value}`);await expect(editor).toContainText(`width=${value}`);}
 await page.getByRole('button',{name:'返回工作副本',exact:true}).click();await page.getByRole('button',{name:'仅显示模型'}).click();await page.getByRole('button',{name:'仅显示 Python 源码'}).click();await expect(editor).toContainText('width=45');
});

test('running from the editor freezes the selected bytes while later edits remain independent',async({page,request})=>{
 const id=`source-freeze-${Date.now()}`,root=`/api/documents/${id}`;await createDocument(request,id);await login(page,id);
 await page.getByRole('button',{name:'仅显示 Python 源码'}).click();const editor=page.locator('.cm-content');
 const source="import FreeCAD as App, Part, time\ndoc=App.newDocument('Model')\nobj=doc.addObject('PartDesign::Feature','Box')\nobj.Shape=Part.makeBox(20,30,40)\ndoc.recompute()\ntime.sleep(1)\n";
 await expect(editor).toBeVisible();await editor.fill(source);await page.getByLabel('运行当前文件',{exact:true}).click();await expect(page.getByTestId('approval-plan')).toHaveCount(0);
 await expect.poll(async()=>((await(await request.get(root,{headers})).json()).jobs.length)).toBe(1);
 const snapshot=await(await request.get(root,{headers})).json(),job=snapshot.jobs[0],frozen=job.request.run;expect(frozen.sourceHash).toBe(createHash('sha256').update(source).digest('hex'));
 await editor.fill(source.replace('20,30,40','50,30,40'));
 await expect.poll(async()=>{const response=await(await request.get(`${root}/jobs/${job.operationId}`,{headers})).json();return response.status;},{timeout:20000}).toBe('awaiting_acceptance');
 await expect(editor).toContainText('Part.makeBox(50,30,40)');const events=(await(await request.get(`${root}/jobs/${job.operationId}/events`,{headers})).json()).events;
 const execution=events.filter((event:any)=>event.type==='python_execution'&&event.data.status!=='running').at(-1).data;expect(execution.sourceVersionId).toBe(frozen.sourceVersionId);expect(execution.sourceHash).toBe(frozen.sourceHash);expect(execution.validation.bbox).toEqual([20,30,40]);expect(execution.status).toBe('valid');
 expect((await(await request.get(root,{headers})).json()).revision).toBe(0);
});
