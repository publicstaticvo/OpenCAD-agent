import {createGateway} from './server.ts';
import {mkdirSync,existsSync,readFileSync,writeFileSync,lstatSync} from 'node:fs';import {join,resolve} from 'node:path';import {randomBytes} from 'node:crypto';
const dataDir=resolve(process.env.CAD_DATA_DIR??'data');mkdirSync(dataDir,{recursive:true,mode:0o700});
const keyPath=join(dataDir,'access-token');let token=process.env.CAD_ACCESS_TOKEN;
if(!token){if(existsSync(keyPath)){if(lstatSync(keyPath).isSymbolicLink())throw new Error('Unsafe access-token path');token=readFileSync(keyPath,'utf8').trim();}else{token=randomBytes(32).toString('hex');writeFileSync(keyPath,token,{flag:'wx',mode:0o600});}}
const app=await createGateway({dataDir,accessToken:token,port:Number(process.env.PORT??3000),host:process.env.CAD_HOST??'127.0.0.1',allowedOrigins:process.env.CAD_ALLOWED_ORIGINS?.split(',')});
console.log(`CAD Gateway ${app.baseUrl}; local access key: ${keyPath}; model provider: none (no paid calls)`);
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,async()=>{await app.close();process.exit(0);});
