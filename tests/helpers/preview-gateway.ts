import {createGateway} from '../../gateway/server.ts';
import {approvedStages} from '../../gateway/plan.ts';
import type {TextRunner} from '../../gateway/agent.ts';

// Native browser integration driver; no language model or fabricated CAD result.
const runner:TextRunner=Object.assign(async(_job:any,session:any)=>{
 if(session.mode==='planning'){await session.propose({kind:'create_box',length:42,width:24,height:8});return;}
 for(const [index,stage] of approvedStages(session.plan).entries())await session.apply(stage.operations,`native-${index}`);
 await session.prepare(session.plan.criteria);return session.plan.criteria;
},{mode:'fake' as const});
const gateway=await createGateway({dataDir:process.env.CAD_DATA_DIR!,accessToken:'approved-preview-local-token-012345',port:0,textRunner:runner});
gateway.store.createDocument('part');process.send!({baseUrl:gateway.baseUrl});
process.once('SIGTERM',()=>{void gateway.close().then(()=>process.exit(0));});
