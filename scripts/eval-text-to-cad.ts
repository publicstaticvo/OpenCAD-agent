import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';import {join,resolve} from 'node:path';import {execFileSync} from 'node:child_process';
import {authorizeLive,readDataset,sha256,Budget} from '../gateway/evaluation.ts';
import {runEvaluation} from '../gateway/evaluation-runner.ts';
import {fixtureTextRunner} from '../gateway/fake-provider.ts';import {runTextJob,type TextRunner} from '../gateway/agent.ts';
async function main(){
 const args=process.argv.slice(2),offline=args.includes('--offline'),datasetPath=args.find(x=>!x.startsWith('--'))??'evals/text-to-cad/v1.json';
 const dataset=readDataset(datasetPath);let runner:TextRunner,authorization:any=null,budget:Budget|null=null;
 if(offline)runner=fixtureTextRunner();
 else{
  if(process.env.RUN_LIVE_CAD!=='1')throw new Error('Live NOT RUN: RUN_LIVE_CAD=1 and explicit approval required. Use npm run test:eval for offline harness only.');
  if(!process.env.CAD_EVAL_APPROVAL)throw new Error('Live NOT RUN: CAD_EVAL_APPROVAL file required');
  authorization=authorizeLive(JSON.parse(readFileSync(process.env.CAD_EVAL_APPROVAL,'utf8')),process.env,datasetPath);
  const apiKey=process.env.CAD_EVAL_API_KEY;if(!apiKey)throw new Error('Live NOT RUN: explicitly injected CAD_EVAL_API_KEY required');
  budget=new Budget(authorization.maxUsd,authorization.provider.contextWindow,authorization.provider.maxTokens,authorization.provider.ratesUsdPerMillion);
  const {evaluationProvider}=await import('../gateway/eval-provider.mjs');const provider=evaluationProvider(authorization,apiKey,budget);
  runner=Object.assign((job:any,session:any,signal:AbortSignal)=>runTextJob(job,session,signal,provider),{mode:'live' as const});
 }
 const output=resolve(process.env.CAD_EVAL_OUTPUT??join('evals/results',new Date().toISOString().replace(/[:.]/g,'-')+'-'+(offline?'offline':'live')));mkdirSync(output,{recursive:true,mode:0o700});
 const startedAt=new Date().toISOString();
 const result=await runEvaluation(dataset,runner,join(output,'data'),offline?'offline':'live');
 const report={...result,startedAt,finishedAt:new Date().toISOString(),datasetSha256:sha256(readFileSync(datasetPath)),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),workingTreeDirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().length>0,node:process.version,authorization:authorization?{...authorization,credentialInjection:'CAD_EVAL_API_KEY (value never recorded)'}:null,reservedUpperCostUsd:budget?.reservedUsd??0,requestReservations:budget?.requests??0,httpRequests:budget?.sentRequests??0,limitations:offline?['Offline fake orchestration only; no live model qualification','Native CAD is real; fixtures do not measure language-model ability']:['Small fixed sample; does not prove general CAD ability','Provider billing cap and approved rate ceilings remain external responsibilities']};
 writeFileSync(join(output,'result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({output:join(output,'result.json'),mode:result.mode,passed:result.rows.filter(x=>x.pass).length,total:result.rows.length,modelQualityQualified:result.modelQualityQualified}));
 if(result.rows.some(x=>!x.pass))process.exitCode=1;
}
main().catch(error=>{console.error((error as Error).message);process.exitCode=1;});
