import {test,expect} from 'vitest';
import type {AppEvent} from '../shared/cad-contracts.ts';
import {buildActivityRows,groupActivityRows} from '../web/src/activity.ts';

function event(seq:number,type:string,data:any,jobId:string|null='job'):AppEvent{return{seq,documentId:'project',jobId,type,revision:0,candidateId:null,data};}

test('A timeline preserves real event order and merges each tool and execution status update',()=>{
 const jobs=[{operationId:'job',request:{text:'Create a box'}}];
 const rows=buildActivityRows(jobs,[
  event(1,'job_updated',{status:'planning'}),
  event(2,'agent_progress',{type:'tool_execution_start',toolCallId:'call-1',name:'write',args:{path:'script.py'}}),
  event(3,'source_saved',{versionId:'source-1',actor:'agent'}),
  event(4,'agent_progress',{type:'tool_execution_end',toolCallId:'call-1',isError:false,result:'saved'}),
  event(5,'python_execution',{executionId:'execution-1',sourceVersionId:'source-1',status:'running'}),
  event(6,'python_execution',{executionId:'execution-1',sourceVersionId:'source-1',status:'valid'}),
  event(7,'committed',{revision:1})
 ]);
 expect(rows.map(row=>row.kind)).toEqual(['user','tool','source','execution','committed']);
 expect(rows[1].started?.seq).toBe(2);expect(rows[1].ended?.seq).toBe(4);expect(rows[1].data.isError).toBe(false);
 expect(rows[3].seq).toBe(5);expect(rows[3].data.status).toBe('valid');expect(rows.at(-1)?.data.revision).toBe(1);
});

test('A timeline retains project source checkpoints with no job identity',()=>{
 const rows=buildActivityRows([],[event(1,'source_saved',{versionId:'checkpoint-1',actor:'user'},null)]);
 expect(rows).toHaveLength(1);expect(rows[0].kind).toBe('source');expect(rows[0].data.versionId).toBe('checkpoint-1');
});

test('Python job approval is visible when its persisted plan arrives with job_updated',()=>{
 const job={operationId:'job',request:{text:'Create a box'},status:'awaiting_approval',plan:{kind:'python',planHash:'approved-scope'}};
 const rows=buildActivityRows([job],[event(1,'job_updated',job),event(2,'plan_ready',job.plan)]);
 expect(rows.map(row=>row.kind)).toEqual(['user','plan']);expect(rows[1].data.planHash).toBe('approved-scope');
});

test('replayed events merge once and private thinking never enters visible activity',()=>{
 const first=event(1,'job_updated',{status:'running'}),message=event(2,'agent_progress',{type:'message_end',message:{role:'assistant',content:[{type:'thinking',thinking:'private reasoning'},{type:'text',text:'Visible result'}]}});
 const rows=buildActivityRows([{operationId:'job'}],[first,message,first,message]);
 expect(rows.filter(row=>row.kind==='assistant')).toHaveLength(1);expect(JSON.stringify(rows.map(row=>row.data))).not.toContain('private reasoning');
});

test('visible streaming text updates one message and adjacent operations form ordered groups',()=>{
 const rows=buildActivityRows([{operationId:'job'}],[event(1,'job_updated',{status:'running'}),event(2,'agent_progress',{type:'text_delta',messageId:'m',delta:'Working'}),event(3,'agent_progress',{type:'text_delta',messageId:'m',delta:' now'}),event(4,'agent_progress',{type:'message_end',messageId:'m',message:{role:'assistant',content:[{type:'text',text:'Working now'}]}}),event(5,'source_saved',{versionId:'v'}),event(6,'python_execution',{executionId:'e',status:'valid'}),event(7,'committed',{revision:1})]);
 expect(rows.filter(row=>row.kind==='assistant')).toHaveLength(1);expect(rows[1].data.text).toBe('Working now');expect(rows[1].seq).toBe(2);
 expect(groupActivityRows(rows).map(group=>group.map(row=>row.kind))).toEqual([['user'],['assistant'],['source','execution'],['committed']]);
});

test('persisted replies without stream events remain visible at their first recorded job state',()=>{
 const message={role:'assistant',content:[{type:'text',text:'Recorded reply'}]};
 const job={operationId:'job',agent:{messages:[message]}};const rows=buildActivityRows([job],[event(1,'job_updated',{...job,status:'answered'})]);
 expect(rows.filter(row=>row.kind==='assistant').map(row=>row.data.text)).toEqual(['Recorded reply']);
});

test('automatic execution requests keep their system origin and exact source identity',()=>{
 const rows=buildActivityRows([{operationId:'job'}],[event(1,'job_updated',{status:'running'}),event(2,'agent_progress',{type:'python_execution_requested',automatic:true,sourceVersionId:'source-1',sourceHash:'hash-1'}),event(3,'python_execution',{executionId:'execution-1',sourceVersionId:'source-1',status:'valid'})]);
 expect(rows.map(row=>row.kind)).toEqual(['user','execution_request','execution']);expect(rows[1].data).toMatchObject({automatic:true,sourceVersionId:'source-1',sourceHash:'hash-1'});
});

test('a task keeps separate execution identities in chronological order',()=>{
 const rows=buildActivityRows([{operationId:'task-1',request:{kind:'text',text:'Create and repair'}}],[event(1,'job_updated',{status:'running'},'task-1'),event(2,'python_execution',{executionId:'execution-1',candidateId:'candidate-1',status:'failed'},'task-1'),event(3,'python_execution',{executionId:'execution-2',candidateId:'candidate-2',status:'valid'},'task-1')]);
 const executions=rows.filter(row=>row.kind==='execution');expect(executions.map(row=>row.data.executionId)).toEqual(['execution-1','execution-2']);expect(executions.map(row=>row.data.candidateId)).toEqual(['candidate-1','candidate-2']);expect(executions.every(row=>row.jobId==='task-1')).toBe(true);
});

test('the user request row preserves snapshot-bound geometry references for history',()=>{
 const ideContext={projectId:'project',geometryReferences:[{projectId:'project',source:{kind:'revision',revision:3},modelHash:'a'.repeat(64),objectId:'Body',displayName:'主体',objectType:'PartDesign::Body',selectionType:'face',subElement:'Face6'}]};
 const rows=buildActivityRows([{operationId:'task-face',request:{kind:'text',text:'Add a hole on this face',ideContext}}],[event(1,'job_updated',{status:'planning'},'task-face')]);
 expect(rows[0].data.ideContext).toEqual(ideContext);
});
