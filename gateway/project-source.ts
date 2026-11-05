import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import {createPatch} from 'diff';

export interface PythonProject{files:Record<string,string>;assets?:Record<string,string>;directories:string[];entrypoint:string;}
export function projectPath(value:unknown):string{
 if(typeof value!=='string'||!value||value.length>240||value.startsWith('/')||value.startsWith('~')||value.includes('\\')||/[\x00-\x1f\x7f]/.test(value)||value.split('/').some(part=>!part||part==='.'||part==='..')||posix.normalize(value)!==value)throw new Error('Invalid project relative path');
 return value;
}
export function projectSnapshot(input:unknown):PythonProject{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid Python project');
 const value=input as PythonProject;
 if(Object.keys(value).some(key=>!['files','assets','directories','entrypoint'].includes(key))||!value.files||typeof value.files!=='object'||Array.isArray(value.files)||value.assets!==undefined&&(!value.assets||typeof value.assets!=='object'||Array.isArray(value.assets))||!Array.isArray(value.directories))throw new Error('Invalid project fields');
 const files:Record<string,string>=Object.create(null),assets:Record<string,string>=Object.create(null);let bytes=0;
 const entries=Object.entries(value.files);if(entries.length+Object.keys(value.assets??{}).length>256)throw new Error('Project file count exceeds 256');
 for(const [path,content] of entries){projectPath(path);if(typeof content!=='string')throw new Error('Project files must contain UTF-8 text');bytes+=Buffer.byteLength(content);if(bytes>4*1024*1024||Buffer.byteLength(content)>1024*1024)throw new Error('Project source size limit exceeded');files[path]=content;}
 for(const [path,content] of Object.entries(value.assets??{})){projectPath(path);if(typeof content!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content))throw new Error('Project assets must be canonical base64');const raw=Buffer.from(content,'base64');if(raw.toString('base64')!==content||raw.length>1024*1024)throw new Error('Invalid project asset');bytes+=raw.length;if(bytes>4*1024*1024)throw new Error('Project source size limit exceeded');assets[path]=content;}
 if(value.directories.some(path=>typeof path!=='string'))throw new Error('Project directories must be relative paths');
 const rawDirectories=value.directories.map(projectPath);if(new Set(rawDirectories).size!==rawDirectories.length)throw new Error('Duplicate project directory');
 const directories=rawDirectories.sort();if(directories.length>256)throw new Error('Project directory count exceeded');
 for(const path of [...Object.keys(files),...Object.keys(assets),...directories]){if(directories.includes(path)&&(Object.hasOwn(files,path)||Object.hasOwn(assets,path))||Object.hasOwn(files,path)&&Object.hasOwn(assets,path))throw new Error('Project file and directory collision');const parents=path.split('/');parents.pop();while(parents.length){if(Object.hasOwn(files,parents.join('/'))||Object.hasOwn(assets,parents.join('/')))throw new Error('Project file and directory collision');parents.pop();}}
 const entrypoint=value.entrypoint;if(entrypoint!==''&&(!Object.hasOwn(files,projectPath(entrypoint))||!(/\.(py|FCMacro)$/i.test(entrypoint))))throw new Error('Project entrypoint must be an existing Python file or FCMacro');
 const result:PythonProject={files:Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b))),directories,entrypoint};if(Object.keys(assets).length)result.assets=Object.fromEntries(Object.entries(assets).sort(([a],[b])=>a.localeCompare(b)));return result;
}
export function singleFileProject(source:string):PythonProject{return{files:{'script.py':source},directories:[],entrypoint:'script.py'};}
export function projectHash(value:PythonProject):string{
 const project=projectSnapshot(value);
 // Single-file legacy histories keep their original SHA-256 identities.
 const text=project.entrypoint==='script.py'&&project.directories.length===0&&Object.keys(project.files).length===1&&!project.assets?project.files['script.py']:JSON.stringify(project);
 return createHash('sha256').update(text).digest('hex');
}
export function projectFileHashes(value:PythonProject):Record<string,string>{
 const project=projectSnapshot(value);
 return Object.fromEntries([...Object.entries(project.files).map(([path,content])=>[path,createHash('sha256').update(content).digest('hex')] as const),...Object.entries(project.assets??{}).map(([path,content])=>[path,createHash('sha256').update(Buffer.from(content,'base64')).digest('hex')] as const)]);
}
export function projectDiff(parent:PythonProject|null,next:PythonProject){
 const old={...(parent?.files??{}),...(parent?.assets??{})},current={...next.files,...(next.assets??{})};
 return [...new Set([...Object.keys(old),...Object.keys(current)])].sort().filter(path=>old[path]!==current[path]).map(path=>({path,kind:!Object.hasOwn(old,path)?'added':!Object.hasOwn(current,path)?'deleted':'modified',diff:Object.hasOwn(parent?.assets??{},path)||Object.hasOwn(next.assets??{},path)?`Binary asset ${path}: ${Object.hasOwn(old,path)?'removed or replaced':''}${Object.hasOwn(current,path)?' added or replaced':''}`:createPatch(path,(parent?.files??{})[path]??'',next.files[path]??'')}));
}
