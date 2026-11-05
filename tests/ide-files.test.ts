import {test,expect} from 'vitest';
import {transferPath,createPath} from '../web/src/ide-files.ts';
test('project tree moves preserve module content, entrypoint and reject collisions or recursive moves',()=>{
 const project={files:{'main.py':'import cad.shape','cad/shape.py':'width=40','other.py':'unchanged'},directories:['cad','target'],entrypoint:'cad/shape.py'};
 const moved=transferPath(project,'cad','target/cad',false);expect(moved.files['target/cad/shape.py']).toBe('width=40');expect(moved.entrypoint).toBe('target/cad/shape.py');expect(moved.files['other.py']).toBe('unchanged');expect(project.files['cad/shape.py']).toBe('width=40');
 expect(()=>transferPath(project,'cad','cad/sub',false)).toThrow();expect(()=>transferPath(project,'main.py','other.py',false)).toThrow();
 const copy=transferPath(project,'cad','target/cad',true);expect(copy.files['cad/shape.py']).toBe('width=40');expect(copy.entrypoint).toBe('cad/shape.py');
 expect(()=>createPath(project,'cad','../outside.py',false)).toThrow();expect(()=>createPath(project,'cad','shape.py',false)).toThrow();
 expect(createPath(project,'target','new.py',false).files['target/new.py']).toBe('');
});
