import {fixtureTextRunner} from './fake-provider.ts';
import {createGateway} from './server.ts';
import {ModelConfig,readModelYaml} from './model-config.ts';
import {mkdirSync,existsSync,readFileSync,writeFileSync,lstatSync} from 'node:fs';import {join,resolve} from 'node:path';import {randomBytes} from 'node:crypto';
const dataDir=resolve(process.env.CAD_DATA_DIR??'data');mkdirSync(dataDir,{recursive:true,mode:0o700});
const keyPath=join(dataDir,'access-token');let token=process.env.CAD_ACCESS_TOKEN;
if(!token){if(existsSync(keyPath)){if(lstatSync(keyPath).isSymbolicLink())throw new Error('Unsafe access-token path');token=readFileSync(keyPath,'utf8').trim();}else{token=randomBytes(32).toString('hex');writeFileSync(keyPath,token,{flag:'wx',mode:0o600});}}
const mode=process.env.CAD_PROVIDER??'live';if(!['none','fake','live'].includes(mode))throw new Error('CAD_PROVIDER must be live, fake or none');
const modelConfig=mode==='live'?new ModelConfig(dataDir):undefined;
if(process.env.CAD_MODEL_CONFIG){if(!modelConfig)throw new Error('CAD_MODEL_CONFIG requires CAD_PROVIDER=live');await modelConfig.save(readModelYaml(process.env.CAD_MODEL_CONFIG));}
const taskMs=process.env.CAD_TASK_TIMEOUT_MS===undefined?undefined:Number(process.env.CAD_TASK_TIMEOUT_MS);
if(taskMs!==undefined&&(!Number.isSafeInteger(taskMs)||taskMs<0||taskMs>2147483647))throw new Error('CAD_TASK_TIMEOUT_MS must be an integer between 0 and 2147483647 (0 disables the deadline)');
const app=await createGateway({modelConfig,textRunner:mode==='fake'?fixtureTextRunner():modelConfig?.runner,dataDir,accessToken:token,port:Number(process.env.PORT??3000),host:process.env.CAD_HOST??'127.0.0.1',allowedOrigins:process.env.CAD_ALLOWED_ORIGINS?.split(',') ,taskMs});
console.log(`CAD Gateway ${app.baseUrl}; local access key: ${keyPath}; model provider: ${mode}${modelConfig&&!modelConfig.status().configured?' (configure in workspace)':''}`);
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,async()=>{await app.close();process.exit(0);});
