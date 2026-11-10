import {expect,test} from 'vitest';
import {validateAgentIDEContext,type AgentIDEContext} from './ide-context.ts';

const context:AgentIDEContext={projectId:'project',activeFile:{path:'design/plate.py',saved:false,unsaved:true,sourceVersionId:'source-1',draftRevision:3,contentHash:'a'.repeat(64),createdBy:'user',empty:false},selectedCode:{path:'design/plate.py',from:{line:4,column:1},to:{line:4,column:8},text:'width=40',before:'import FreeCAD',after:'height=10',fileHash:'a'.repeat(64),sourceVersionId:'source-1',draftRevision:3,unsaved:true},geometryReferences:[{projectId:'project',source:{kind:'revision',revision:2},modelHash:'b'.repeat(64),objectId:'Plate',displayName:'底板',objectType:'PartDesign::Body',selectionType:'face',subElement:'Face6',geometry:{area:2400,center:[30,20,8],normal:[0,0,1],bbox:[0,0,8,60,40,8]}}]};

test('IDE context preserves unsaved source selection and a revision-bound BRep face reference',()=>{
 expect(validateAgentIDEContext(context,'project')).toEqual(context);
});

test('IDE context rejects a selection whose file snapshot differs from the active editor',()=>{
 expect(()=>validateAgentIDEContext({...context,selectedCode:{...context.selectedCode,fileHash:'c'.repeat(64)}},'project')).toThrow(/does not match/);
});

test('IDE context rejects geometry references from another project or invalid face identity',()=>{
 expect(()=>validateAgentIDEContext({...context,geometryReferences:[{...context.geometryReferences[0],projectId:'other'}]},'project')).toThrow(/identity/);
 expect(()=>validateAgentIDEContext({...context,geometryReferences:[{...context.geometryReferences[0],subElement:'Face0'}]},'project')).toThrow(/Face reference/);
});
