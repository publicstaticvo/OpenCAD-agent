import unittest
from native_harness import native

SCRIPT='''
import json,math,sys
import FreeCAD as App
from worker.model_ops import apply_operations,inspect_document
fixture=json.load(open('tests/fixtures/models/'+sys.argv[1]+'.json'))
doc=App.newDocument('Test')
apply_operations(doc,fixture['operations'],'create','step1')
tree=inspect_document(doc)
assert len({x['id'] for x in tree})==len(tree)
assert all(x['type']!='Part::Feature' for x in tree)
body=next(x for x in doc.Objects if x.TypeId=='PartDesign::Body')
s=body.Tip.Shape
assert s.isValid() and len(s.Solids)==1
assert abs(s.Volume-fixture['criteria']['volume'])<1e-6,(s.Volume,fixture['criteria']['volume'])
assert all(abs(a-b)<1e-6 for a,b in zip([s.BoundBox.XLength,s.BoundBox.YLength,s.BoundBox.ZLength],fixture['criteria']['bbox']))
assert all(o.FullyConstrained for o in doc.Objects if o.TypeId=='Sketcher::SketchObject')
n=len(doc.Objects)
apply_operations(doc,fixture['operations'],'create','step1')
assert len(doc.Objects)==n,'duplicate step created objects'
try:apply_operations(doc,[{'op':'create_body','id':'duplicate'}],'create','step1')
except ValueError:pass
else:raise AssertionError('reused step with different payload accepted')
'''
class ModelTests(unittest.TestCase):
 def test_three_editable_parametric_models(self):
  for name in ['plate','ring','step']:
   with self.subTest(name=name):native(SCRIPT,name)
 def test_named_diameter_survives_labels_and_edit(self):
  native(SCRIPT+'''
for o in doc.Objects:o.Label='display name'
apply_operations(doc,[dict(op='set_parameter',feature='hole',parameter='diameter',value=8)],'edit','step2')
assert abs(body.Tip.Shape.Volume-(48000-math.pi*16*10))<1e-6
assert next(x for x in inspect_document(doc) if x['id']=='hole')['parameters']['diameter']==8
''','plate')
 def test_invalid_input_never_mutates_document(self):
  native('''
import FreeCAD as App
from worker.model_ops import apply_operations
doc=App.newDocument('Bad')
for op in [dict(op='pad',id='bad',sketch='x',length=True),dict(op='execute_python',code='x')]:
 try:apply_operations(doc,[dict(op='create_body',id='Body'),op],'bad','1')
 except ValueError:pass
 else:raise AssertionError('invalid input accepted')
 assert len(doc.Objects)==0
''')
 def test_underconstrained_conflicting_or_unknown_reference_rejected(self):
  native('''
import FreeCAD as App
from worker.model_ops import apply_operations
doc=App.newDocument('Bad')
ops=[dict(op='create_body',id='Body'),dict(op='create_sketch',id='base',body='Body',plane='XY',origin=[0,0,0]),dict(op='add_geometry',sketch='base',geometryId=0,geometry=dict(kind='circle',center=[0,0],radius=3)),dict(op='pad',id='pad',sketch='base',length=10)]
try:apply_operations(doc,ops,'bad','1')
except ValueError as e:assert 'constrain' in str(e).lower()
else:raise AssertionError('underconstrained sketch accepted')
''')
 def test_conflicting_constraint_and_missing_feature_rejected(self):
  native(SCRIPT+'''
for ops in [[dict(op='add_constraint',sketch='hole',name='conflict',kind='Diameter',args=[0,12])],[dict(op='set_parameter',feature='deleted',parameter='diameter',value=8)],[dict(op='pad',id='new',sketch='base',length=10,reversed=True)]]:
 try:apply_operations(doc,ops,'bad',str(ops))
 except (ValueError,RuntimeError):pass
 else:raise AssertionError('invalid operation accepted')
''','plate')
