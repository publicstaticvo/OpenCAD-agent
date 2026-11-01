import {test,expect} from 'vitest';
import {createPatch} from 'diff';
import {scriptSource} from '../gateway/python-source.ts';

test('script patches require the exact parent and exact hunk positions',()=>{
 const parent=scriptSource({source:'a = 1\nb = 2\n'});
 const patch=createPatch('script.py',parent.source,'a = 3\nb = 2\n');
 const updated=scriptSource({parentHash:parent.sourceHash,patch},parent);
 expect(updated.source).toBe('a = 3\nb = 2\n');
 expect(updated.parentHash).toBe(parent.sourceHash);
 expect(()=>scriptSource({parentHash:'wrong',patch},parent)).toThrow(/parent/i);
 expect(()=>scriptSource({parentHash:parent.sourceHash,patch:createPatch('script.py','different\n','other\n')},parent)).toThrow(/patch/i);
 expect(()=>scriptSource({source:'x',patch})).toThrow();
});
