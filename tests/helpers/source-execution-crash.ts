import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout} from 'node:timers/promises';
import {createGateway} from '../../gateway/server.ts';
import {SourceVersions} from '../../gateway/source-versions.ts';

const app=await createGateway({dataDir:process.argv[2],accessToken:'source-restart-local-0123456789',port:0});
const versions=new SourceVersions(app.store);
const version=versions.save('project',{source:'while True: pass',parentVersionId:versions.head('project')!.versionId,actor:'user'});
const job=app.supervisor.submitPython('project',1,'restart-running',{kind:'run',run:{sourceVersionId:version.versionId,sourceHash:version.sourceHash}});
const deadline=Date.now()+10000;
for(;;){
 const row=app.store.db.prepare('SELECT record FROM python_executions WHERE operation_id=?').get(job.operationId) as any;
 const execution=row?JSON.parse(row.record):null;
 const path=execution&&join(app.store.candidatePath(execution.candidateId),'executions',execution.executionId,'execute.process.json');
 if(path&&existsSync(path)){
  process.send!({versionId:version.versionId,executionId:execution.executionId,nativePid:JSON.parse(readFileSync(path,'utf8')).pid});break;
 }
 if(Date.now()>deadline)throw new Error('Native execution did not start before test deadline');
 await setTimeout(20);
}
await app.supervisor.waitForJob('project',job.operationId);
await app.close();
