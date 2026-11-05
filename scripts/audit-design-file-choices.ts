import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const path=resolve('data/store.sqlite');
if(!existsSync(path))throw new Error('No existing project database to inspect');
const database=new DatabaseSync(path,{readOnly:true});
try{
 const matches=(database.prepare('SELECT document_id,operation_id,job FROM jobs').all() as any[]).map(row=>({...row,value:JSON.parse(row.job)})).filter(row=>/L\s*形.*支架|L[- ]shaped.*bracket/i.test(row.value.request?.text??''));
 const report=matches.map(row=>{
  const events=(database.prepare('SELECT event FROM events WHERE document_id=? AND json_extract(event,\'$.jobId\')=? ORDER BY seq').all(row.document_id,row.operation_id) as any[]).map(item=>JSON.parse(item.event));
  return{documentId:row.document_id,operationId:row.operation_id,status:row.value.status,taskMatch:'L形支架',calls:events.filter(item=>item.type==='agent_progress'&&item.data?.type==='tool_execution_start').map(item=>({seq:item.seq,name:item.data.name,path:item.data.args?.path,operation:item.data.args?.operation,destination:item.data.args?.destination})),sourceChanges:events.filter(item=>item.type==='source_saved').map(item=>({seq:item.seq,versionId:item.data.versionId,changes:item.data.changes}))};
 });
 mkdirSync('.work/ide',{recursive:true});writeFileSync('.work/ide/design-file-choices.json',JSON.stringify(report,null,2));console.log(JSON.stringify({matchedTasks:report.length,report:'.work/ide/design-file-choices.json'}));
}finally{database.close();}
