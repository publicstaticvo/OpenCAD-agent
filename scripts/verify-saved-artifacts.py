"""Verify actual downloaded artifacts against the published version's CAD criteria."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'worker/tests'))
from native_harness import native

result=native('''
import sys,json
from pathlib import Path
import FreeCAD as App,Import
from worker.validation import validate_document,shape_metrics,compare
from worker.artifacts import glb_metrics
fcstd,step,glb,criteria_path=map(Path,sys.argv[1:])
criteria=json.loads(criteria_path.read_text())
doc=App.openDocument(str(fcstd))
validate_document(doc,criteria)
body=[obj for obj in doc.Objects if obj.TypeId=='PartDesign::Body'][0]
glb_metrics(glb,body.Tip.Shape)
imported=App.newDocument('DownloadedStep');Import.insert(str(step),imported.Name);imported.recompute()
shapes=[obj.Shape for obj in imported.Objects if hasattr(obj,'Shape') and not obj.Shape.isNull() and len(obj.Shape.Solids)]
assert len(shapes)==1
compare(shape_metrics(shapes[0]),criteria)
print('saved-artifacts: passed')
''',*sys.argv[1:])
print(result.stdout)
