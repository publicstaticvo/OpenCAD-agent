import type {Supervisor} from '../../gateway/supervisor.ts';
/** A test user explicitly approves the exact submitted program through the production approval method. */
export function approvedProgram(supervisor:Supervisor,...args:Parameters<Supervisor['submit']>){
 const job=supervisor.submit(...args);
 return supervisor.approveJob(job.documentId,job.operationId,job.plan!.planHash);
}
