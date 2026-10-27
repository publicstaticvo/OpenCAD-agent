import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';import {join,resolve} from 'node:path';import {execFileSync} from 'node:child_process';
import {readDataset,sha256} from '../gateway/evaluation.ts';
import {runEvaluation} from '../gateway/evaluation-runner.ts';
import {fixtureTextRunner} from '../gateway/fake-provider.ts';import type {TextRunner} from '../gateway/agent.ts';
import {ModelConfig,readModelYaml} from '../gateway/model-config.ts';
async function main(){
 const args=process.argv.slice(2),offline=args.includes('--offline'),datasetPath=args.find(x=>!x.startsWith('--'))??'evals/text-to-cad/v1.json';
 const dataset=readDataset(datasetPath);let runner:TextRunner,authorization:any=null;
 const output=resolve(process.env.CAD_EVAL_OUTPUT??join('evals/results',new Date().toISOString().replace(/[:.]/g,'-')+'-'+(offline?'offline':'live')));mkdirSync(output,{recursive:true,mode:0o700});
 if(offline)runner=fixtureTextRunner();
 else{
  if(process.env.RUN_LIVE_CAD!=='1')throw new Error('真实模型评测需要 RUN_LIVE_CAD=1');
  const config=new ModelConfig(resolve(process.env.CAD_DATA_DIR??'data'));
  if(process.env.CAD_MODEL_CONFIG)await config.save(readModelYaml(process.env.CAD_MODEL_CONFIG));
  config.provider();authorization=config.status();runner=config.runner;
 }
 const startedAt=new Date().toISOString();
 const result=await runEvaluation(dataset,runner,join(output,'data'),offline?'offline':'live');
 const report={...result,startedAt,finishedAt:new Date().toISOString(),datasetSha256:sha256(readFileSync(datasetPath)),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),workingTreeDirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().length>0,node:process.version,authorization,pricing:null,limitations:offline?['Offline orchestration only; no model qualification']:['Small fixed sample; does not prove general CAD ability','Price calculation is not configured']};
 writeFileSync(join(output,'result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({output:join(output,'result.json'),mode:result.mode,passed:result.rows.filter(x=>x.pass).length,total:result.rows.length,modelQualityQualified:result.modelQualityQualified}));
 if(result.rows.some(x=>!x.pass))process.exitCode=1;
}
main().catch(error=>{console.error((error as Error).message);process.exitCode=1;});
