import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assertContract,type Criteria,type ModelProgram} from '../shared/cad-contracts.ts';
export interface EvaluationCase{id:string;category:string;prompt:string;expected:'commit'|'reject';fixture?:string;fixtureSha256?:string;seed?:string;criteria?:Criteria}
export interface Dataset{version:1;units:'mm';maxRepairCount:1;cases:EvaluationCase[]}
export const sha256=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
export function fixture(name:string):ModelProgram{if(!['plate','ring','step'].includes(name))throw new Error('Unknown fixture');const data=JSON.parse(readFileSync(`tests/fixtures/models/${name}.json`,'utf8'));assertContract('program',data);return data;}
export function readDataset(path:string):Dataset{
 const data=JSON.parse(readFileSync(path,'utf8'));
 if(data.version!==1||data.units!=='mm'||data.maxRepairCount!==1||!Array.isArray(data.cases)||data.cases.length!==10)throw new Error('Unsupported evaluation dataset');
 const ids=new Set();
 for(const c of data.cases){
  if(!/^[a-z][a-z0-9-]+$/.test(c.id)||ids.has(c.id)||!c.prompt||!['commit','reject'].includes(c.expected))throw new Error('Invalid evaluation case');ids.add(c.id);
  if(c.seed)fixture(c.seed);
  if(c.expected==='commit'){
   fixture(c.fixture);if(c.fixtureSha256!==sha256(readFileSync(`tests/fixtures/models/${c.fixture}.json`)))throw new Error('Fixture hash drift');assertContract('criteria',c.criteria);
  }
 }
 if(data.cases.filter((c:EvaluationCase)=>c.expected==='commit').length!==6)throw new Error('Expected six goldens');
 return data;
}
export interface Authorization{approved:true;approvalId:string;expiresAt:string;datasetSha256:string;dataScope:string;maxUsd:number;providerBillingCapConfirmed:true;provider:{protocol:'openai-completions';baseUrl:string;model:string;contextWindow:number;maxTokens:number;ratesUsdPerMillion:{input:number;output:number}}}
const finitePositive=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;
export function authorizeLive(input:unknown,env:Record<string,string|undefined>,dataset:string):Authorization{
 if(env.RUN_LIVE_CAD!=='1')throw new Error('Live blocked: RUN_LIVE_CAD=1 required before reading credentials');
 const a=input as Authorization;
 if(!a||a.approved!==true||!a.approvalId||!Number.isFinite(Date.parse(a.expiresAt))||Date.parse(a.expiresAt)<=Date.now())throw new Error('Live blocked: explicit unexpired approval required');
 if(a.datasetSha256!==sha256(readFileSync(dataset)))throw new Error('Live blocked: approved dataset hash mismatch');
 if(a.dataScope!=='text-and-structured-cad-summary-only'||a.providerBillingCapConfirmed!==true||!finitePositive(a.maxUsd))throw new Error('Live blocked: data boundary and provider billing cap approval required');
 const p=a.provider;if(!p||p.protocol!=='openai-completions'||!p.model||!Number.isSafeInteger(p.contextWindow)||p.contextWindow<1024||!Number.isSafeInteger(p.maxTokens)||p.maxTokens<1||p.maxTokens>=p.contextWindow)throw new Error('Live blocked: explicit provider/model/token limits required');
 const url=new URL(p.baseUrl);if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('Live blocked: invalid approved endpoint');
 if(!p.ratesUsdPerMillion||!finitePositive(p.ratesUsdPerMillion.input)||!finitePositive(p.ratesUsdPerMillion.output))throw new Error('Live blocked: verified upper pricing rates required');
 return a;
}
export class Budget{
 requests=0;sentRequests=0;reservedUsd=0;
 constructor(readonly maxUsd:number,readonly contextWindow:number,readonly maxTokens:number,readonly rates:{input:number;output:number}){}
 reserve(){const amount=(this.contextWindow*this.rates.input+this.maxTokens*this.rates.output)/1e6;if(this.reservedUsd+amount>this.maxUsd+1e-12)throw new Error('Evaluation budget exhausted before request');this.reservedUsd+=amount;this.requests++;return amount;}
}
export function matches(actual:any,criteria:Criteria,tree:any[]):boolean{
 if(!actual||actual.solids!==1||!finitePositive(actual.volume)||!Array.isArray(actual.bbox)||actual.bbox.length!==3||!actual.bbox.every(finitePositive)||Math.abs(actual.volume-criteria.volume)>Math.max(1e-6,criteria.volume*1e-9)||criteria.bbox.some((v,i)=>Math.abs(v-actual.bbox[i])>1e-6))return false;
 return(criteria.parameters??[]).every(p=>{const v=tree.find(f=>f.id===p.feature)?.parameters?.[p.parameter];return typeof v==='number'&&Math.abs(v-p.value)<1e-6;});
}

export function benchmarkPrompt(c:EvaluationCase):string{
 const name=c.fixture??c.seed;if(!name)return c.prompt;
 const program=fixture(name);
 const features=program.operations.filter(op=>['create_body','create_sketch','pad','pocket'].includes(op.op)).map(op=>`${op.id}=${op.op}`);
 const dimensions=program.operations.filter(op=>op.op==='add_constraint'&&['Distance','DistanceX','DistanceY','Diameter','Radius'].includes(op.kind as string)).map(op=>`${op.sketch}.${op.name}`);
 return c.prompt+'\n命名约定（本固定评测必须遵守，不代表通用零件命名限制）：特征 '+features.join(', ')+'；尺寸约束 '+dimensions.join(', ')+'；拉伸/切除长度使用 Length。孔位以固定参考坐标系与明确原点验收。';
}
