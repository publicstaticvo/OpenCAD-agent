import {execFileSync} from 'node:child_process';import {readFileSync} from 'node:fs';import {join} from 'node:path';
import {RevisionStore} from './revision-store.ts';import {Supervisor} from './supervisor.ts';import type {TextRunner} from './agent.ts';
import {fixture,matches,sha256,benchmarkPrompt,type Dataset} from './evaluation.ts';
export async function runEvaluation(dataset:Dataset,runner:TextRunner,directory:string,mode:'offline'|'live'){
 const store=new RevisionStore(directory),supervisor=await Supervisor.start(store,{textRunner:runner});
 const rows:{id:string;expected:string;pass:boolean;firstSuccess:boolean;repairs:number;toolCalls:number;providerRequests:number;reportedCostUsd:number|null;durationMs:number;userInterventions:number;status:string;error:string|null}[]=[];
 try{
  for(const c of dataset.cases){
   const started=Date.now();let pass=false,error:string|null=null,status='not_run',toolCalls=0,repairs=0,providerRequests=0,reportedCost=0,usageKnown=true;
   for(let attempt=0;attempt<=(c.expected==='commit'?1:0);attempt++){
    const id=`${c.id}-${attempt}`;store.createDocument(id);let base=0;
    if(c.seed){const seed=supervisor.submit(id,0,'seed',fixture(c.seed));const result=await supervisor.waitForJob(id,seed.operationId);if(result.status!=='committed')throw new Error('Native seed failed: '+result.error);base=1;}
    const before=base?sha256(readFileSync(store.artifactPath(id,base,'model.FCStd'))):null;
    const prompt=benchmarkPrompt(c)+(attempt?`\n上次验收失败：${error}。请修正，仍须满足原请求，禁止改写验收要求。`:'');
    const job=supervisor.submitText(id,base,'eval',prompt),done=await supervisor.waitForJob(id,job.operationId);status=done.status;error=done.error;
    toolCalls+=done.agent?.toolCalls??0;repairs+=done.agent?.blockedCalls??0;providerRequests+=done.agent?.usage?.length??0;
    for(const u of done.agent?.usage??[]){if(typeof u?.cost?.total==='number'&&Number.isFinite(u.cost.total))reportedCost+=u.cost.total;else usageKnown=false;}
    const snapshot=store.snapshot(id);
    if(c.expected==='reject'){
     pass=done.status!=='committed'&&snapshot.revision===base&&(base===0||sha256(readFileSync(store.artifactPath(id,base,'model.FCStd')))===before);break;
    }
    if(done.status==='committed'){
     const validation=JSON.parse(readFileSync(store.artifactPath(id,snapshot.revision,'validation.json'),'utf8'));
     const program=fixture(c.fixture!),expectedHistory=program.operations.filter(op=>['create_body','create_sketch','pad','pocket'].includes(op.op));
     const types:Record<string,string>={create_body:'PartDesign::Body',create_sketch:'Sketcher::SketchObject',pad:'PartDesign::Pad',pocket:'PartDesign::Pocket'};
     pass=matches(validation,c.criteria!,snapshot.tree)&&snapshot.tree.length===expectedHistory.length&&expectedHistory.every(op=>snapshot.tree.some(f=>f.id===op.id&&f.type===types[op.op]));
     if(!pass)error='Independent golden dimensions, parameter or editable history mismatch';
     if(pass){try{execFileSync('python',['scripts/compare-eval-geometry.py',store.artifactPath(id,snapshot.revision,'model.FCStd'),c.fixture!,JSON.stringify(c.criteria)],{stdio:'pipe',timeout:30000});}catch{pass=false;error='Independent reference geometry mismatch';}}
    }
    if(pass||repairs>=1||attempt===1)break;
    repairs++;
   }
   rows.push({id:c.id,expected:c.expected,pass:pass&&repairs<=dataset.maxRepairCount,firstSuccess:pass&&repairs===0,repairs,toolCalls,providerRequests,reportedCostUsd:mode==='offline'?0:usageKnown?reportedCost:null,durationMs:Date.now()-started,userInterventions:0,status,error});
  }
 }finally{await supervisor.close();store.close();}
 const positives=rows.filter(x=>x.expected==='commit');
 return{version:1,mode,modelQualityQualified:mode==='live'&&rows.every(x=>x.pass),firstSuccessRate:positives.filter(x=>x.firstSuccess).length/positives.length,rows};
}
