import {filePaths,projectEntries,safePath,type Project} from './project-files.ts';

export const executable=(path:string)=>/\.(py|FCMacro)$/i.test(path);
export const parentPath=(path:string)=>path.split('/').slice(0,-1).join('/');
export const containsPath=(path:string,child:string)=>path===child||child.startsWith(path+'/');
export function createPath(project:Project,parent:string,name:string,directory:boolean):Project{
 if(!name.trim()||name!==name.trim()||/[\/\\]/.test(name))throw new Error('名称只能包含当前层级的文件或目录名称');
 const path=safePath(parent?`${parent}/${name}`:name);
 if(projectEntries(project).some(entry=>entry.path===path))throw new Error('目标位置已有同名文件或目录');
 if(parent&&!projectEntries(project).some(entry=>entry.path===parent&&entry.directory))throw new Error('父目录不存在');
 return directory?{...project,directories:[...project.directories,path]}:{...project,files:{...project.files,[path]:''},entrypoint:project.entrypoint||(executable(path)?path:'')};
}
export function transferPath(project:Project,source:string,destination:string,copy:boolean):Project{
 safePath(source);safePath(destination);const entries=projectEntries(project);
 if(!entries.some(entry=>entry.path===source))throw new Error('源文件或目录不存在');
 if(containsPath(source,destination))throw new Error('不能移动或复制到自身及其子目录');
 if(entries.some(entry=>entry.path===destination))throw new Error('目标位置已有同名文件或目录');
 const parent=parentPath(destination);if(parent&&!entries.some(entry=>entry.path===parent&&entry.directory))throw new Error('目标目录不存在');
 const remap=(path:string)=>containsPath(source,path)?destination+path.slice(source.length):path;
 const mapFiles=(files:Record<string,string>)=>Object.fromEntries(Object.entries(files).flatMap(([path,value])=>containsPath(source,path)?copy?[[path,value],[remap(path),value]]:[[remap(path),value]]:[[path,value]]));
 const directories=projectEntries(project).filter(entry=>entry.directory).map(entry=>entry.path).flatMap(path=>containsPath(source,path)?copy?[path,remap(path)]:[remap(path)]:[path]);
 return{...project,files:mapFiles(project.files),...(project.assets?{assets:mapFiles(project.assets)}:{}),directories:[...new Set(directories)],entrypoint:copy?project.entrypoint:remap(project.entrypoint)};
}
export function deletePath(project:Project,path:string):Project{
 const keep=(name:string)=>!containsPath(path,name);
 return{...project,files:Object.fromEntries(Object.entries(project.files).filter(([name])=>keep(name))),assets:Object.fromEntries(Object.entries(project.assets??{}).filter(([name])=>keep(name))),directories:project.directories.filter(keep),entrypoint:keep(project.entrypoint)?project.entrypoint:''};
}
