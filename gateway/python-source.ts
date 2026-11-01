import {createHash} from 'node:crypto';
import {applyPatch,parsePatch} from 'diff';

export interface ScriptVersion {source:string;sourceHash:string;parentHash:string|null}
export function scriptSource(input:{source?:string;patch?:string;parentHash?:string},parent?:ScriptVersion):ScriptVersion{
 if(!input||Object.keys(input).some(k=>!['source','patch','parentHash'].includes(k))||('source' in input)===('patch' in input))throw new Error('Choose source or patch');
 let source:string;
 if(input.patch!==undefined){
  if(!parent||input.parentHash!==parent.sourceHash)throw new Error('Script parent mismatch');
  if(typeof input.patch!=='string'||input.patch.length>262144)throw new Error('Invalid patch');
  const patches=parsePatch(input.patch);
  if(patches.length!==1||![patches[0].oldFileName,patches[0].newFileName].every(n=>n==='script.py'||n==='a/script.py'||n==='b/script.py'))throw new Error('Patch must update script.py only');
  const lines=parent.source.split('\n');
  for(const hunk of patches[0].hunks){
   const expected=hunk.lines.filter(line=>line.startsWith(' ')||line.startsWith('-')).map(line=>line.slice(1));
   if(expected.some((line,i)=>lines[hunk.oldStart-1+i]!==line))throw new Error('Patch does not match exact parent lines');
  }
  const applied=applyPatch(parent.source,patches[0],{fuzzFactor:0,autoConvertLineEndings:false});
  if(applied===false)throw new Error('Patch application failed');source=applied;
 }else{
  if(parent&&input.parentHash!==parent.sourceHash||!parent&&input.parentHash!==undefined)throw new Error('Script parent mismatch');
  source=input.source!;
 }
 if(typeof source!=='string'||!source.trim()||Buffer.byteLength(source)>262144)throw new Error('Invalid Python source size');
 return{source,sourceHash:createHash('sha256').update(source).digest('hex'),parentHash:parent?.sourceHash??null};
}
