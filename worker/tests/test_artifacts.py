import unittest
from native_harness import native
BUILD='''
import json,sys,tempfile,hashlib,os
from pathlib import Path
import FreeCAD as App
from worker.model_ops import apply_operations,feature
from worker.validation import validate_document
from worker.artifacts import prepare_revision,verify_package
fixture=json.load(open('tests/fixtures/models/plate.json'))
doc=App.newDocument('Plate')
apply_operations(doc,fixture['operations'],'create','1')
'''
APPROVED_BOX='''
import json,os,tempfile
from pathlib import Path
import FreeCAD as App
from worker.model_ops import apply_operations,feature
from worker.validation import validate_document,validate_design
from worker.artifacts import prepare_revision
fixture=json.load(open('tests/fixtures/models/plate.json'))
operations=[]
for operation in fixture['operations']:
 operations.append(operation)
 if operation['op']=='pad':break
criteria=dict(bbox=[80,60,10],volume=48000,parameters=[dict(feature='base',parameter='width',value=80),dict(feature='base',parameter='height',value=60)])
design=dict(version=1,kind='create_box',dimensions=dict(length=80,width=60,height=10))
doc=App.newDocument('ApprovedBox')
'''
class ArtifactTests(unittest.TestCase):
 def test_approved_rectangle_constraints_survive_independent_reopen(self):
  native(APPROVED_BOX+'''
# Constraint order and nondimensional names are deliberately different.
constraints=[op for op in operations if op['op']=='add_constraint']
for index,op in enumerate(constraints):
 if op['kind'] not in ('Distance','DistanceX','DistanceY'):op['name']='actual_'+str(index)
operations=[op for op in operations if op['op'] not in ('add_constraint','pad')]+list(reversed(constraints))+[operations[-1]]
apply_operations(doc,operations,'box','one')
validate_document(doc,criteria);validate_design(doc,design)
with tempfile.TemporaryDirectory(prefix='approved-reopen-') as tmp:
 directory=Path(tmp);(directory/'design.json').write_text(json.dumps(design))
 result=prepare_revision(doc,directory,criteria)
 assert result['verifierPid']!=os.getpid()
 assert result['validation']['volume']==48000
 assert (directory/'manifest.json').exists()
''')
 def test_independent_reopen_rejects_unapproved_constraint_references_with_identical_geometry(self):
  native(APPROVED_BOX+'''
corner=next(op for op in operations if op.get('name')=='corner0')
corner['args']=[1,1,0,2]
apply_operations(doc,operations,'box','one')
# This real alternative constraint preserves the shape and solver state.
assert feature(doc,'base').FullyConstrained
assert feature(doc,'base').ConstraintCount==11
assert validate_document(doc,criteria)['volume']==48000
with tempfile.TemporaryDirectory(prefix='approved-reopen-') as tmp:
 directory=Path(tmp);(directory/'design.json').write_text(json.dumps(design))
 try:prepare_revision(doc,directory,criteria)
 except ValueError as error:assert 'constraint' in str(error).lower(),str(error)
 else:raise AssertionError('independent verifier accepted unapproved constraint references')
 assert not (directory/'manifest.json').exists()
''')
 def test_independent_reopen_exports_and_editability(self):
  native(BUILD+'''
with tempfile.TemporaryDirectory(prefix='cad-package-') as tmp:
 directory=Path(tmp)
 result=prepare_revision(doc,directory,fixture['criteria'])
 assert result['verifierPid']!=os.getpid(),'validation must run in independent native process'
 assert result['validation']['solids']==1
 assert abs(result['validation']['volume']-47717.256661176914)<1e-6
 assert result['validation']['glb']['triangles']>0
 assert result['validation']['glb']['bounds'][0]==[0,0,-0.06]
 assert result['validation']['glb']['bounds'][1]==[0.08,0.01,0]
 for name in ['model.FCStd','model.step','preview.glb','tree.json','validation.json','criteria.json']:
  assert result['manifest'][name]['sha256']==hashlib.sha256((directory/name).read_bytes()).hexdigest()
 verify_package(directory)
 App.closeDocument(doc.Name)
 reopened=App.openDocument(str(directory/'model.FCStd'))
 apply_operations(reopened,[dict(op='set_parameter',feature='hole',parameter='diameter',value=8)],'edit','1')
 assert abs(feature(reopened,'Body').Tip.Shape.Volume-(48000-3.141592653589793*16*10))<1e-6
 (directory/'preview.glb').write_bytes(b'corrupt')
 try:verify_package(directory)
 except ValueError:pass
 else:raise AssertionError('tampered package accepted')
''')
 def test_no_solid_even_if_native_status_valid(self):
  native(BUILD+'''
apply_operations(doc,[dict(op='set_parameter',feature='hole',parameter='diameter',value=500)],'edit','1')
try:validate_document(doc,fixture['criteria'])
except ValueError as e:assert 'solid' in str(e).lower()
else:raise AssertionError('zero solid accepted')
''')
 def test_missing_identity_parameter_and_wrong_acceptance_criteria_rejected(self):
  for mutation in ["feature(doc,'hole').removeProperty('CadFeatureId')", "feature(doc,'hole').renameConstraint(0,'lost')", "fixture['criteria']['bbox']=[80,60,12]", "fixture['criteria']['parameters'][0]['value']=8"]:
   with self.subTest(mutation=mutation):
    native(BUILD+mutation+'''
try:validate_document(doc,fixture['criteria'])
except ValueError:pass
else:raise AssertionError('invalid model accepted')
''')
 def test_corrupt_and_empty_files_rejected_without_ready_manifest(self):
  native('''
from pathlib import Path
import tempfile,json
from worker.artifacts import verify_saved
for contents in [b'',b'not a FreeCAD document']:
 with tempfile.TemporaryDirectory() as t:
  p=Path(t);(p/'model.FCStd').write_bytes(contents);(p/'criteria.json').write_text(json.dumps(dict(bbox=[80,60,10],volume=47717.256661176914)))
  try:verify_saved(p)
  except (ValueError,RuntimeError,OSError):pass
  else:raise AssertionError('corrupt file accepted')
  assert not (p/'manifest.json').exists()
''')
 def test_export_failure_or_verifier_exit_never_marks_ready(self):
  native(BUILD+'''
with tempfile.TemporaryDirectory() as t:
 p=Path(t);(p/'model.step').mkdir()
 try:prepare_revision(doc,p,fixture['criteria'])
 except (ValueError,RuntimeError,OSError):pass
 else:raise AssertionError('export failure accepted')
 assert not (p/'manifest.json').exists()
''')
 def test_acceptance_tolerances_match_recorded_engineering_defaults(self):
  for mutation in ["fixture['criteria']['bbox'][2]+=0.000005", "fixture['criteria']['volume']+=0.0002"]:
   with self.subTest(mutation=mutation):
    native(BUILD+mutation+'''
try:validate_document(doc,fixture['criteria'])
except ValueError:pass
else:raise AssertionError('out-of-tolerance model accepted')
''')
 def test_curved_mesh_uses_tessellation_tolerance_not_brep_tolerance(self):
  native('''
import json,tempfile,FreeCAD as A
from pathlib import Path
from worker.model_ops import apply_operations
from worker.artifacts import prepare_revision
for name in ['ring','step']:
 f=json.load(open('tests/fixtures/models/'+name+'.json'));d=A.newDocument('Other')
 apply_operations(d,f['operations'],'create','1')
 with tempfile.TemporaryDirectory() as t:
  r=prepare_revision(d,Path(t),f['criteria'])
  assert r['validation']['solids']==1
  assert r['validation']['glb']['triangles']>0
 A.closeDocument(d.Name)
''')
 def test_glb_checks_actual_binary_vertices_not_only_declared_metadata(self):
  native(BUILD+'''
import struct
with tempfile.TemporaryDirectory() as t:
 p=Path(t);prepare_revision(doc,p,fixture['criteria'])
 raw=bytearray((p/'preview.glb').read_bytes());size=struct.unpack_from('<I',raw,12)[0];g=json.loads(raw[20:20+size]);a=g['accessors'][g['meshes'][0]['primitives'][0]['attributes']['POSITION']];view=g['bufferViews'][a['bufferView']]
 offset=20+size+8+view.get('byteOffset',0)+a.get('byteOffset',0)
 struct.pack_into('<f',raw,offset,float('nan'));(p/'preview.glb').write_bytes(raw)
 from worker.artifacts import glb_metrics
 try:glb_metrics(p/'preview.glb',feature(doc,'Body').Tip.Shape)
 except ValueError:pass
 else:raise AssertionError('non-finite binary vertex accepted')
''')
