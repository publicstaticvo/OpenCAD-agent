"""Independent evaluation oracle: persisted BRep versus fixed native reference geometry."""
import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'worker/tests'))
from native_harness import native
result=native('''
import json,sys
from pathlib import Path
import FreeCAD as App
from worker.model_ops import apply_operations,feature
from worker.validation import shape_metrics
actual_path,fixture_name,criteria_json=sys.argv[1:]
if fixture_name not in ('plate','ring','step'):raise ValueError('Unknown reference geometry')
fixture=json.loads(Path('tests/fixtures/models/'+fixture_name+'.json').read_text())
criteria=json.loads(criteria_json)
reference=App.newDocument('Reference')
apply_operations(reference,fixture['operations'],'reference','create')
parameters=criteria.get('parameters',[])
if parameters:apply_operations(reference,[dict(op='set_parameter',**p) for p in parameters],'reference','parameters')
expected=feature(reference,'Body').Tip.Shape
actual=App.openDocument(str(Path(actual_path).resolve()))
bodies=[o for o in actual.Objects if o.TypeId=='PartDesign::Body']
if len(bodies)!=1 or bodies[0].Tip is None:raise ValueError('Invalid actual reference geometry')
shape=bodies[0].Tip.Shape
shape_metrics(shape);shape_metrics(expected)
# Both directed differences matter: identical bbox/volume/constraints can hide moved holes.
tolerance=max(1e-6,expected.Volume*1e-9)
for delta in (shape.cut(expected),expected.cut(shape)):
 if not delta.isNull() and (not delta.isValid() or abs(delta.Volume)>tolerance):
  raise ValueError('Independent reference geometry mismatch')
print('reference-geometry: passed')
''',*sys.argv[1:])
print('reference-geometry: passed')
