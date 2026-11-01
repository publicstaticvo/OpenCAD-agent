import {test,expect} from 'vitest';
import {operationPlanningRules} from '../gateway/pi-adapter.mjs';
test('operation planning reuses exact constraint signatures without globally prohibiting assemblies',()=>{
 const rules=operationPlanningRules();
 expect(rules).toContain('Coincident [geometry,point,geometry,point]');
 expect(rules).toContain('kind="operations"');
 expect(rules).not.toContain('No code, files, STEP editing, assemblies');
 expect(rules).not.toContain('exactly one Body and one connected solid');
});
