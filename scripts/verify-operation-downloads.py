"""Independently verify actual browser downloads against the approved operation plan."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'worker/tests'))
from native_harness import native

result=native('''
import json,sys
import FreeCAD as App,Import,Part
from worker.validation import validate_document,validate_design,shape_metrics,compare
from worker.operation_plan import compare_shapes
from worker.model_ops import bodies
from worker.artifacts import glb_metrics
from pathlib import Path
fcstd,step,glb,plan_path=map(Path,sys.argv[1:5])
plan=json.loads(plan_path.read_text())
doc=App.openDocument(str(fcstd))
validation=validate_document(doc,plan['criteria']);validation.update(validate_design(doc,plan))
body=bodies(doc)[0]
glb_metrics(glb,body.Tip.Shape)
imported=App.newDocument('DownloadedStep');Import.insert(str(step),imported.Name);imported.recompute()
shapes=[obj.Shape for obj in imported.Objects if hasattr(obj,'Shape') and not obj.Shape.isNull() and len(obj.Shape.Solids)]
assert len(shapes)==1
compare(shape_metrics(shapes[0]),plan['criteria']);compare_shapes(shapes[0],body.Tip.Shape)
if len(sys.argv)>5:
 case=sys.argv[5]
 points=[(0,0),(40,0),(0,30)] if case.startswith('triangle') else [(0,0),(60,0),(60,10),(10,10),(10,50),(0,50)]
 height=12 if case=='triangle-edit' else 10 if case=='triangle' else 8
 vertices=[App.Vector(x,y,0) for x,y in points];wire=Part.makePolygon(vertices+[vertices[0]])
 expected=Part.Face(wire).extrude(App.Vector(0,0,height))
 if case=='bracket-hole':expected=expected.cut(Part.makeCylinder(2,8,App.Vector(30,5,0)))
 compare_shapes(body.Tip.Shape,expected)
print('operation-downloads: passed')
''',*sys.argv[1:])
print(result.stdout)
