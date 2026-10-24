import {test,expect} from 'vitest';
import {WorkerClient} from '../gateway/worker-client.ts';
import plate from './fixtures/models/plate.json';
test('real RPC candidate validates before mutation, preserves stable IDs and deduplicates steps',async()=>{
 const c=await WorkerClient.start();const envelope={documentId:'doc',baseRevision:0,operationId:'create',candidateId:'candidate'};
 try{
  expect(await c.request('begin_candidate',{envelope})).toMatchObject({candidateId:'candidate',tree:[]});
  await expect(c.request('apply_operations',{envelope,stepId:'bad',operations:[{op:'create_body',id:'Body'},{op:'pad',id:'bad',sketch:'none',length:true}]})).rejects.toThrow(/Invalid operation/);
  expect((await c.request('inspect_document',{})).tree).toEqual([]);
  const tree=await c.request('apply_operations',{envelope,stepId:'build',operations:plate.operations});
  expect(tree.map((x:any)=>x.id)).toEqual(['Body','base','pad','hole','pocket']);
  expect(await c.request('apply_operations',{envelope,stepId:'build',operations:plate.operations})).toEqual(tree);
  await expect(c.request('apply_operations',{envelope:{...envelope,baseRevision:1},stepId:'stale',operations:[{op:'set_parameter',feature:'hole',parameter:'diameter',value:8}]})).rejects.toThrow(/envelope/i);
  const updated=await c.request('apply_operations',{envelope,stepId:'edit',operations:[{op:'set_parameter',feature:'hole',parameter:'diameter',value:8}]});
  expect(updated.find((x:any)=>x.id==='hole').parameters.diameter).toBe(8);
 }finally{await c.close();}
});
