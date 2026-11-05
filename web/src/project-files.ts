import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';

export type Project={files:Record<string,string>;assets?:Record<string,string>;directories:string[];entrypoint:string};
export const emptyProject=():Project=>({files:{},directories:[],entrypoint:''});
export function safePath(path:string){if(!path||path.length>240||path.startsWith('/')||path.includes('\\')||/[\x00-\x1f\x7f]/.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('文件路径必须位于项目内');return path;}
export function filePaths(project:Project){return [...Object.keys(project.files),...Object.keys(project.assets??{})].sort();}
export function projectEntries(project:Project){const directories=new Set(project.directories);for(const path of filePaths(project)){const parts=path.split('/');parts.pop();while(parts.length){directories.add(parts.join('/'));parts.pop();}}return [...[...directories].map(path=>({path,directory:true})),...filePaths(project).map(path=>({path,directory:false}))].sort((a,b)=>a.path.localeCompare(b.path));}
export function base64(bytes:Uint8Array){let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(result);}
export function bytesOf(project:Project,path:string){return Object.hasOwn(project.files,path)?strToU8(project.files[path]):Uint8Array.from(atob(project.assets?.[path]??''),char=>char.charCodeAt(0));}
export function importBytes(project:Project,path:string,bytes:Uint8Array){safePath(path);if(bytes.length>1024*1024)throw new Error('单个项目文件不能超过 1 MiB');try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(text.includes('\0'))throw new Error('Binary file');project.files[path]=text;delete project.assets?.[path];}catch{project.assets??={};project.assets[path]=base64(bytes);delete project.files[path];}}
export function readProjectZip(bytes:Uint8Array):Project{
 const seen=new Set<string>();let size=0,count=0;
 const entries=unzipSync(bytes,{filter:file=>{if(++count>513)throw new Error('ZIP 条目数量超出范围');const path=file.name.endsWith('/')?file.name.slice(0,-1):file.name;safePath(path);if(seen.has(path))throw new Error('ZIP 包含重复路径');seen.add(path);size+=file.originalSize;if(size>8*1024*1024||file.originalSize>1024*1024)throw new Error('ZIP 展开大小超出范围');return true;}});
 const project=emptyProject();let configured='';
 for(const [path,bytes]of Object.entries(entries)){if(path==='.cad-project.json'){configured=JSON.parse(strFromU8(bytes)).entrypoint;continue;}if(path.endsWith('/'))project.directories.push(path.slice(0,-1));else importBytes(project,path,bytes);}
 project.entrypoint=configured||Object.keys(project.files).find(path=>/\.(py|FCMacro)$/i.test(path))||'';if(project.entrypoint&&!Object.hasOwn(project.files,project.entrypoint))throw new Error('ZIP 入口文件不存在');return project;
}
export function projectZip(project:Project){const files:Record<string,Uint8Array>={'.cad-project.json':strToU8(JSON.stringify({entrypoint:project.entrypoint}))};for(const path of project.directories)files[path+'/']=new Uint8Array();for(const path of filePaths(project))files[path]=bytesOf(project,path);return zipSync(files,{level:6});}
export function downloadBytes(bytes:Uint8Array,name:string,type='application/octet-stream'){const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
