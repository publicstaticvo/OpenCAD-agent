import {test,expect} from 'vitest';
import {describeModelFailure,publicModelMessage} from '../shared/model-errors.ts';

// Exact Pi error fields recovered from existing real gpt-5.6-sol jobs.
test.each([
 '502: {"message":"Upstream service temporarily unavailable","type":"upstream_error"}',
 '503: {"message":"Service temporarily unavailable","type":"api_error"}',
])('real provider failures retain HTTP status without exposing response bodies: %s',errorMessage=>{
 const description=describeModelFailure({stopReason:'error',errorMessage});
 expect(description).toContain(`HTTP ${errorMessage.slice(0,3)}`);
 expect(description).toContain('未提交正式模型');
 expect(description).not.toContain('cad_finish');
 expect(description).not.toContain('{');
 const original={role:'assistant',stopReason:'error',errorMessage,content:[]};
 const sanitized=publicModelMessage(original);
 expect(sanitized.errorMessage).toBe(description);
 expect(publicModelMessage(sanitized)).toEqual(sanitized);
 expect(original.errorMessage).toBe(errorMessage);
});
