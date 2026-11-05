import {createReadTool,createWriteTool,createEditTool} from '@earendil-works/pi-coding-agent';
import {SourceVersions,type SourceVersion} from './source-versions.ts';
import {projectSnapshot,projectPath,type PythonProject} from './project-source.ts';

const object=(properties:Record<string,unknown>,required:string[])=>({type:'object',properties,required,additionalProperties:false});
export const sourceToolSchemas={
 read:{...createReadTool('/cad-project').parameters,properties:{...(createReadTool('/cad-project').parameters as any).properties,sourceVersionId:{type:'string'}}},
 write:createWriteTool('/cad-project').parameters,
 edit:createEditTool('/cad-project').parameters,
 cad_files:object({operation:{type:'string',enum:['list','mkdir','delete','move','set_entrypoint']},path:{type:'string'},destination:{type:'string'}},['operation']),
};
type ProjectFile=PythonProject['files'];

function paths(project:PythonProject){
 const directories=new Set(project.directories);for(const path of [...Object.keys(project.files),...Object.keys(project.assets??{})]){let parent=path.split('/');parent.pop();while(parent.length){directories.add(parent.join('/'));parent.pop();}}
 return [...[...directories].map(path=>({path,type:'directory'})),...Object.keys(project.files).map(path=>({path,type:'file'})),...Object.keys(project.assets??{}).map(path=>({path,type:'asset'}))].sort((a,b)=>a.path.localeCompare(b.path));
}

/** Pi's standard file tools operate on immutable project snapshots, never on host paths. */
export function createSourceTools(versions:SourceVersions,documentId:string,operationId?:string,baseVersionId?:string|null){
 const cwd=`/cad-project/${documentId}`;
 let viewed=baseVersionId?versions.read(documentId,baseVersionId):versions.head(documentId);
 const current=()=>viewed?.project??{files:{},directories:[],entrypoint:''};
 const resolvePath=(value:unknown)=>{
  if(typeof value!=='string')throw new Error('Project path must be text');
  const absolute=value.startsWith(cwd+'/');
  const raw=absolute?value.slice(cwd.length+1):value;
  return projectPath(raw);
 };
 const save=(project:PythonProject,toolCallId:string)=>{
  const parent=viewed;
  const version=versions.saveProject(documentId,{project,parentVersionId:parent?.versionId??null,actor:'agent',operationId,toolCallId},{preserveConflict:true});
  if(versions.head(documentId)?.versionId!==version.versionId)throw new Error(`Project source conflict; your complete project version ${version.versionId} was retained. Read the current project and compare its file diffs before editing again.`);
  viewed=version;
  return{version:{versionId:version.versionId,sourceHash:version.sourceHash,parentVersionId:version.parentVersionId,actor:version.actor,createdAt:version.createdAt,entrypoint:version.project.entrypoint,files:Object.keys(version.project.files)},changes:versions.fileDiffs(documentId,version.versionId)};
 };
 function wrap(name:'read'|'write'|'edit'){
  const base=name==='read'?createReadTool(cwd):name==='write'?createWriteTool(cwd):createEditTool(cwd);
  return{...base,description:base.description+(name==='write'?' Creates a new project-relative file when the path does not exist. For an independent new design choose a descriptive new filename, preserve existing unrelated files, and select its entrypoint with cad_files before cad_run.':name==='edit'?' Modifies an existing project file. Use write to create a separate design or module.':''),parameters:sourceToolSchemas[name],async execute(toolCallId:string,args:any,signal?:AbortSignal){
   const path=resolvePath(args.path);if(signal?.aborted)throw signal.reason;
   if(name==='read'&&!args.sourceVersionId)viewed=versions.head(documentId);
   const project=current();const sourceVersionId=args.sourceVersionId;
   const selected=name==='read'&&sourceVersionId?versions.read(documentId,sourceVersionId):viewed;
   const readProject=selected?.project??project;
   if(!Object.hasOwn(readProject.files,path)){
    if(name==='write'){
     if(selected!==viewed)throw new Error('Writes must target the current Agent project version');
    }else throw new Error(`Project file does not exist: ${path}`);
   }
   const absolute=`${cwd}/${path}`;let saved:SourceVersion|undefined;
   const readFile=async(file:string)=>{if(file!==absolute)throw new Error('Project file path changed during operation');if(!Object.hasOwn(readProject.files,path))throw new Error(`Project file does not exist: ${path}`);return Buffer.from(readProject.files[path]);};
   const access=async(file:string)=>{if(file!==absolute||!Object.hasOwn(readProject.files,path))throw new Error(`Project file does not exist: ${path}`);};
   const writeFile=async(file:string,content:string)=>{
    if(file!==absolute)throw new Error('Project file path changed during operation');if(signal?.aborted)throw signal.reason;
    const next=projectSnapshot({...current(),files:{...current().files,[path]:content},entrypoint:current().entrypoint||(/\.(py|FCMacro)$/i.test(path)?path:'')});
    saved=versions.saveProject(documentId,{project:next,parentVersionId:viewed?.versionId??null,actor:'agent',operationId,toolCallId},{preserveConflict:true});
    if(versions.head(documentId)?.versionId!==saved.versionId)throw new Error(`Project source conflict; your complete project version ${saved.versionId} was retained. Read the current project and compare its file diffs before editing again.`);
    viewed=saved;
   };
   const tool=name==='read'?createReadTool(cwd,{operations:{readFile,access,detectImageMimeType:async()=>null}}):name==='write'?createWriteTool(cwd,{operations:{writeFile,mkdir:async(directory:string)=>{if(directory===cwd)return;const raw=directory.startsWith(cwd+'/')?directory.slice(cwd.length+1):directory;projectPath(raw);}}}):createEditTool(cwd,{operations:{readFile,writeFile,access}});
   const {sourceVersionId:_,...input}=args;const result=await tool.execute(toolCallId,{...input,path:absolute},signal);
   const version=saved??selected;
   const detail=version&&{versionId:version.versionId,sourceHash:version.sourceHash,parentVersionId:version.parentVersionId,actor:version.actor,createdAt:version.createdAt,toolCallId:version.toolCallId,eventSeq:version.eventSeq,entrypoint:version.project.entrypoint,files:Object.keys(version.project.files)};
   return{...result,content:[...result.content,{type:'text' as const,text:JSON.stringify({version:detail,changes:saved?versions.fileDiffs(documentId,saved.versionId):[]})}],details:{...(result.details??{}),version:detail,changes:saved?versions.fileDiffs(documentId,saved.versionId):[]}};
  }};
 }
 const filesTool={name:'cad_files',label:'Project files',description:'List or change directories, remove or move a project file, and choose the Python entrypoint. Every mutation creates an immutable full-project source version.',parameters:sourceToolSchemas.cad_files,async execute(toolCallId:string,args:any,signal?:AbortSignal){
  if(signal?.aborted)throw signal.reason;const project=current();let next:PythonProject=project;
  if(args.operation==='list')return{content:[{type:'text',text:JSON.stringify({entrypoint:project.entrypoint,files:paths(project),sourceVersionId:viewed?.versionId??null,sourceHash:viewed?.sourceHash??null})}],details:{project}};
  const path=resolvePath(args.path);
  if(args.operation==='mkdir'){
   if(project.files[path]!==undefined||project.assets?.[path]!==undefined||project.directories.includes(path))throw new Error('Project path already exists');next=projectSnapshot({...project,directories:[...project.directories,path]});
  }else if(args.operation==='delete'){
   const prefix=path+'/';if(!Object.hasOwn(project.files,path)&&!Object.hasOwn(project.assets??{},path)&&!project.directories.includes(path)&&![...Object.keys(project.files),...Object.keys(project.assets??{})].some(name=>name.startsWith(prefix))&&!project.directories.some(name=>name.startsWith(prefix)))throw new Error('Project path does not exist');
   const files=Object.fromEntries(Object.entries(project.files).filter(([name])=>name!==path&&!name.startsWith(prefix))),assets=Object.fromEntries(Object.entries(project.assets??{}).filter(([name])=>name!==path&&!name.startsWith(prefix)));const directories=project.directories.filter(name=>name!==path&&!name.startsWith(prefix));
   next=projectSnapshot({files,assets,directories,entrypoint:project.entrypoint===path||project.entrypoint.startsWith(prefix)?'':project.entrypoint});
  }else if(args.operation==='move'){
   const destination=resolvePath(args.destination);if(path===destination||destination.startsWith(path+'/'))throw new Error('Invalid project move destination');
   const prefix=path+'/';if(!Object.hasOwn(project.files,path)&&!Object.hasOwn(project.assets??{},path)&&!project.directories.includes(path)&&![...Object.keys(project.files),...Object.keys(project.assets??{})].some(name=>name.startsWith(prefix))&&!project.directories.some(name=>name.startsWith(prefix)))throw new Error('Project path does not exist');
   if(Object.hasOwn(project.files,destination)||Object.hasOwn(project.assets??{},destination)||project.directories.includes(destination)||[...Object.keys(project.files),...Object.keys(project.assets??{})].some(name=>name.startsWith(destination+'/'))||project.directories.some(name=>name.startsWith(destination+'/')))throw new Error('Project move destination already exists');
   const movedFiles=Object.fromEntries(Object.entries(project.files).map(([name,content])=>[name===path||name.startsWith(path+'/')?destination+name.slice(path.length):name,content]));
   const movedAssets=Object.fromEntries(Object.entries(project.assets??{}).map(([name,content])=>[name===path||name.startsWith(path+'/')?destination+name.slice(path.length):name,content]));
   const movedDirectories=project.directories.map(name=>name===path||name.startsWith(path+'/')?destination+name.slice(path.length):name);
   next=projectSnapshot({files:movedFiles,assets:movedAssets,directories:movedDirectories,entrypoint:project.entrypoint===path||project.entrypoint.startsWith(path+'/')?destination+project.entrypoint.slice(path.length):project.entrypoint});
  }else if(args.operation==='set_entrypoint'){
   if(!Object.hasOwn(project.files,path)||!(/\.(py|FCMacro)$/i.test(path)))throw new Error('Entrypoint must be an existing .py or .FCMacro file');next=projectSnapshot({...project,entrypoint:path});
  }else throw new Error('Unsupported project file operation');
  const saved=save(next,toolCallId);return{content:[{type:'text',text:JSON.stringify(saved)}],details:saved};
 }};
 return{read:wrap('read'),write:wrap('write'),edit:wrap('edit'),cad_files:filesTool};
}
