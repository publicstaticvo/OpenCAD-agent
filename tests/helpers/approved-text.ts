import type {Supervisor} from '../../gateway/supervisor.ts';

/** Explicit test-client approval; never changes the production authorization path. */
export async function approvedText(service:Supervisor,...args:Parameters<Supervisor['submitText']>){
 const submitted=service.submitText(...args);
 let job=await service.waitForJob(submitted.documentId,submitted.operationId);
 if(job.status==='awaiting_approval'){
  service.approveJob(job.documentId,job.operationId,job.plan!.planHash);
  job=await service.waitForJob(job.documentId,job.operationId);
 }
 return job;
}
