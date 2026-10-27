import {test,expect} from 'vitest';import {createServer} from 'node:http';
import {Budget} from '../gateway/evaluation.ts';import type {Authorization} from '../gateway/evaluation.ts';
import {evaluationProvider} from '../gateway/eval-provider.mjs';
test('local HTTP protocol fixture checks Pi streaming, explicit key, token cap and pre-request budget; no remote service',async()=>{
 let requests=0;const bodies:any[]=[];
 const server=createServer(async(req,res)=>{requests++;expect(req.url).toBe('/v1/chat/completions');expect(req.headers.authorization).toBe('Bearer dummy-explicit-key');let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);bodies.push(body);res.writeHead(200,{'Content-Type':'text/event-stream'});for(const part of [{choices:[{index:0,delta:{role:'assistant',content:'protocol fixture'},finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}}])res.write('data: '+JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'fixture',...part})+'\n\n');res.end('data: [DONE]\n\n');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const address=server.address() as any;const budget=new Budget(.03,10000,1000,{input:1,output:10});
 const a={provider:{baseUrl:`http://127.0.0.1:${address.port}/v1`,model:'fixture',contextWindow:10000,maxTokens:1000,ratesUsdPerMillion:{input:1,output:10}}} as Authorization;
 try{
  const provider=evaluationProvider(a,'dummy-explicit-key',budget);const context={systemPrompt:'Test only',messages:[{role:'user',content:'hello',timestamp:1}],tools:[]};
  const first=await provider.streamFn(provider.model,context,{}).result();expect(first.stopReason,first.errorMessage).toBe('stop');expect(first.content[0].text).toBe('protocol fixture');expect(bodies[0].max_tokens??bodies[0].max_completion_tokens).toBe(1000);
  const second=await provider.streamFn(provider.model,context,{}).result();expect(second.stopReason).toBe('error');expect(second.errorMessage).toMatch(/budget/);expect(requests).toBe(1);expect(budget.requests).toBe(1);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
