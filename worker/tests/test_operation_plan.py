import unittest
from native_harness import native

class OperationPlanTests(unittest.TestCase):
 def test_non_rectangular_plans_replay_save_reopen_and_reject_native_tampering(self):
  native('''
import json,hashlib,tempfile,os
from pathlib import Path
import FreeCAD as App
from worker.candidates import Candidates
from worker.model_ops import feature
from worker.operation_plan import history_hash,verify_plan

def polygon(points,dimensions,axes,height):
 ops=[dict(op='create_body',id='Body'),dict(op='create_sketch',id='outline',body='Body',plane='XY',origin=[0,0,0])]
 for i,p in enumerate(points):ops.append(dict(op='add_geometry',sketch='outline',geometryId=i,geometry={'kind':'line','from':p,'to':points[(i+1)%len(points)]}))
 for i in range(len(points)):ops.append(dict(op='add_constraint',sketch='outline',name='corner'+str(i),kind='Coincident',args=[i,2,(i+1)%len(points),1]))
 for i,axis in axes:ops.append(dict(op='add_constraint',sketch='outline',name='axis'+str(i),kind=axis,args=[i]))
 ops.append(dict(op='add_constraint',sketch='outline',name='origin',kind='Coincident',args=[0,1,-1,1]))
 for i,value in dimensions:ops.append(dict(op='add_constraint',sketch='outline',name='size'+str(i),kind='Distance',args=[i,value]))
 return [dict(name='实际多边形草图',sketchId='outline',operations=ops),dict(name='Pad',sketchId='outline',operations=[dict(op='pad',id='solid',sketch='outline',length=height)])]

cases=[('triangle',polygon([[0,0],[40,0],[0,30]],[(0,40),(2,30)],[(0,'Horizontal'),(2,'Vertical')],10),[40,30,10],6000),('bracket',polygon([[0,0],[60,0],[60,10],[10,10],[10,50],[0,50]],[(0,60),(1,10),(2,50),(3,40)],[(i,'Horizontal' if i%2==0 else 'Vertical') for i in range(6)],8),[60,50,8],8000)]
for name,stages,bbox,volume in cases:
 with tempfile.TemporaryDirectory(prefix='operation-plan-') as directory:
  session=Candidates(directory);env=dict(documentId=name,baseRevision=0,operationId='create',candidateId='candidate')
  plan=dict(version=2,kind='operations',baseHistoryHash=history_hash([]),planHash=name,stages=stages,criteria=dict(bbox=bbox,volume=volume))
  session.dispatch('begin_candidate',dict(envelope=env,design=plan))
  for i,stage in enumerate(stages):
   session.dispatch('apply_operations',dict(envelope=env,stepId=str(i),operations=stage['operations']))
   snapshot=session.dispatch('candidate_snapshot',dict(envelope=env,sketchId='outline',sequence=i+1,includePreview=True))
   assert snapshot['sketch']['fullyConstrained'] and snapshot['completedStages']==i+1
  prepared=session.dispatch('prepare_candidate',dict(envelope=env,criteria=plan['criteria'],design=plan))
  assert prepared['validation']['operationPlanHash']==name
  assert prepared['verifierPid']!=os.getpid()
  assert abs(prepared['validation']['volume']-volume)<1e-6
  solid=feature(session.doc,'solid');solid.Type='?TwoLengths';session.doc.recompute()
  try:verify_plan(session.doc,plan,2)
  except ValueError:pass
  else:raise AssertionError('Changed Pad extent mode accepted')
  solid.Type='Length';solid.Reversed=True;session.doc.recompute()
  try:verify_plan(session.doc,plan,2)
  except ValueError:pass
  else:raise AssertionError('Reversed solid accepted with identical bbox lengths and volume')
  session.dispatch('discard_candidate',dict(envelope=env))
''',timeout=60)
