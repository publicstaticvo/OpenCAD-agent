"""E2E acceptance of files downloaded by Chrome, using fresh native Python."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'worker/tests'))
from native_harness import native
native('''
import sys,math
from pathlib import Path
import FreeCAD as App,Import
from worker.model_ops import apply_operations,feature
from worker.validation import validate_document,shape_metrics,compare
from worker.artifacts import glb_metrics
fcstd,step,glb=map(Path,sys.argv[1:])
doc=App.openDocument(str(fcstd))
criteria=dict(bbox=[80,60,10],volume=48000-math.pi*16*10,parameters=[dict(feature='hole',parameter='diameter',value=8)])
validate_document(doc,criteria)
glb_metrics(glb,feature(doc,'Body').Tip.Shape)
imported=App.newDocument('DownloadedStep');Import.insert(str(step),imported.Name);imported.recompute()
shapes=[o.Shape for o in imported.Objects if hasattr(o,'Shape') and not o.Shape.isNull() and len(o.Shape.Solids)]
assert len(shapes)==1
compare(shape_metrics(shapes[0]),criteria)
apply_operations(doc,[dict(op='set_parameter',feature='hole',parameter='diameter',value=10)],'download-edit','one')
validate_document(doc,dict(bbox=[80,60,10],volume=48000-math.pi*25*10,parameters=[dict(feature='hole',parameter='diameter',value=10)]))
print('download-reopen-edit: passed')
''',*sys.argv[1:])
print('download-reopen-edit: passed')
