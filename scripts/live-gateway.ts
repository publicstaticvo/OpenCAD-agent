/** Real-process browser-test supervisor: restart only after an explicit SIGKILL. */
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const directory=process.env.CAD_LIVE_DATA_DIR;
if(!directory||process.env.RUN_LIVE_CAD!=='1')throw new Error('Live test directory and authorization required');
mkdirSync(directory,{recursive:true,mode:0o700});
let stopping=false;
function start(){
 const child=spawn(process.execPath,['--import','tsx','gateway/main.ts'],{stdio:'inherit',env:process.env});
 writeFileSync(resolve(directory!,'gateway-process.json'),JSON.stringify({pid:child.pid}),{mode:0o600});
 const stop=()=>{stopping=true;child.kill('SIGTERM');};
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 child.once('error',error=>{throw error;});
 child.once('exit',(code,signal)=>{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);if(!stopping&&signal==='SIGKILL')start();else process.exit(code??0);});
}
start();
