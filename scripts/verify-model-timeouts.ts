import assert from 'node:assert/strict';
import {readModelYaml} from '../gateway/model-config.ts';
import {evaluationProvider} from '../gateway/eval-provider.mjs';
import {normalizeProbeContext} from '../gateway/pi-adapter.mjs';

const input=readModelYaml(process.argv[2]),protocol=process.argv[3] as 'openai-completions'|'openai-responses';
const provider=(seconds:number)=>evaluationProvider({provider:{...input,protocol,contextWindow:262144,maxTokens:16384}},input.apiKey,undefined,{timeouts:{requestSeconds:seconds}});
const context=(content:string)=>normalizeProbeContext({messages:[{role:'user',content,timestamp:Date.now()}]});
const unbounded=provider(0),stream=unbounded.streamFn(unbounded.model,context('Reply with only OK.'),{});
for await(const _event of stream){}assert.equal((await stream.result()).stopReason,'stop');
const deadline=provider(1),started=Date.now(),longContext=context('Write a detailed 10000-word explanation of parametric solid modeling.');
const expired=deadline.streamFn(deadline.model,longContext,{});for await(const _event of expired){}
assert.equal((await expired.result()).stopReason,'aborted');assert.ok(Date.now()-started>=900&&Date.now()-started<10000);
const controller=new AbortController(),cancelled=unbounded.streamFn(unbounded.model,longContext,{signal:controller.signal});
const timer=setTimeout(()=>controller.abort(),300);
try{for await(const _event of cancelled){}assert.equal((await cancelled.result()).stopReason,'aborted');}finally{clearTimeout(timer);}
console.log(`model-timeouts: passed (${protocol}; unlimited, 1-second deadline, cancellation)`);
