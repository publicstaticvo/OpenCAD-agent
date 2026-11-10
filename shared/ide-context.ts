export interface CodeSelection {
 path:string;
 from:{line:number;column:number};
 to:{line:number;column:number};
 text:string;
 before:string;
 after:string;
 fileHash:string;
 sourceVersionId:string|null;
 draftRevision:number;
 unsaved:boolean;
}

export interface ActiveFileContext {
 path:string;
 saved:boolean;
 unsaved:boolean;
 sourceVersionId:string|null;
 draftRevision:number;
 contentHash:string;
 createdBy:'user'|'agent'|'import'|'unknown';
 createdAt?:number;
 empty:boolean;
}

export interface GeometryReference {
 projectId:string;
 source:{kind:'revision';revision:number}|{kind:'execution';executionId:string;candidateId:string};
 modelHash:string;
 objectId:string;
 displayName:string;
 objectType:string;
 selectionType:'object'|'feature'|'face';
 featureId?:string;
 subElement?:string;
 point?:[number,number,number];
 pointPrecision?:'preview-tessellation';
 geometry?:{area:number;center:[number,number,number];normal:[number,number,number];bbox:[number,number,number,number,number,number]};
}

export interface AgentIDEContext {
 projectId:string;
 activeFile?:ActiveFileContext;
 selectedCode?:CodeSelection;
 geometryReferences:GeometryReference[];
}

export function validateAgentIDEContext(value:unknown,projectId:string):AgentIDEContext {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('IDE context must be an object');
 const context=value as AgentIDEContext;
 if(context.projectId!==projectId||!Array.isArray(context.geometryReferences)||context.geometryReferences.length>16)throw new Error('IDE context project or geometry reference list is invalid');
 if(context.activeFile&&(!context.activeFile.path||context.activeFile.path.length>240||context.activeFile.path.startsWith('/')||context.activeFile.path.split('/').some(part=>!part||part==='.'||part==='..')||!['user','agent','import','unknown'].includes(context.activeFile.createdBy)||typeof context.activeFile.saved!=='boolean'||typeof context.activeFile.unsaved!=='boolean'||context.activeFile.saved===context.activeFile.unsaved||!Number.isSafeInteger(context.activeFile.draftRevision)||context.activeFile.draftRevision<0||!/^([a-f0-9]{64}|)$/.test(context.activeFile.contentHash)||typeof context.activeFile.empty!=='boolean'))throw new Error('Active file context is invalid');
 if(context.selectedCode&&((context.selectedCode.text?.length??0)>8000||(context.selectedCode.before?.length??0)>1000||(context.selectedCode.after?.length??0)>1000||!context.selectedCode.path||context.selectedCode.path.length>240||context.selectedCode.path.startsWith('/')||context.selectedCode.path.split('/').some(part=>!part||part==='.'||part==='..')||!/^([a-f0-9]{64})$/.test(context.selectedCode.fileHash)||!Number.isSafeInteger(context.selectedCode.draftRevision)||context.selectedCode.draftRevision<0||!Number.isSafeInteger(context.selectedCode.from.line)||!Number.isSafeInteger(context.selectedCode.from.column)||!Number.isSafeInteger(context.selectedCode.to.line)||!Number.isSafeInteger(context.selectedCode.to.column)||context.selectedCode.from.line<1||context.selectedCode.from.column<1||context.selectedCode.to.line<context.selectedCode.from.line||context.selectedCode.to.column<1||typeof context.selectedCode.unsaved!=='boolean'))throw new Error('Selected source range is invalid');
 if(context.selectedCode&&(!context.activeFile||context.selectedCode.path!==context.activeFile.path||context.selectedCode.fileHash!==context.activeFile.contentHash||context.selectedCode.sourceVersionId!==context.activeFile.sourceVersionId||context.selectedCode.draftRevision!==context.activeFile.draftRevision||context.selectedCode.unsaved!==context.activeFile.unsaved))throw new Error('Selected source range does not match the active file snapshot');
 for(const reference of context.geometryReferences){
  if(reference.projectId!==projectId||!reference.objectId||reference.objectId.length>128||!reference.modelHash||reference.modelHash.length>128||!reference.displayName||reference.displayName.length>256||!reference.objectType||reference.objectType.length>128||!['object','feature','face'].includes(reference.selectionType))throw new Error('Geometry reference identity is invalid');
  if(reference.selectionType==='face'&&!/^Face[1-9][0-9]*$/.test(reference.subElement??''))throw new Error('Face reference is invalid');
  if(reference.point&&reference.point.some(value=>!Number.isFinite(value)))throw new Error('Geometry pick point is invalid');
  if(reference.pointPrecision!==undefined&&reference.pointPrecision!=='preview-tessellation')throw new Error('Geometry pick point precision is invalid');
  if(reference.source.kind==='revision'?!Number.isSafeInteger(reference.source.revision)||reference.source.revision<1:!reference.source.executionId||!reference.source.candidateId)throw new Error('Geometry reference source is invalid');
  if(reference.geometry&&(!Number.isFinite(reference.geometry.area)||reference.geometry.area<0||[...reference.geometry.center,...reference.geometry.normal,...reference.geometry.bbox].some(value=>!Number.isFinite(value))))throw new Error('Geometry reference measurements are invalid');
 }
 return structuredClone(context);
}
