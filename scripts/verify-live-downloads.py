"""Independent native acceptance for the live browser's rectangular model."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'worker/tests'))
from native_harness import native
result=native('''
import sys
from pathlib import Path
import FreeCAD as App,Import
from worker.model_ops import apply_operations,feature
from worker.validation import validate_document,shape_metrics,compare
from worker.artifacts import glb_metrics
fcstd,step,glb=map(Path,sys.argv[1:])
doc=App.openDocument(str(fcstd))
criteria=dict(bbox=[40,30,15],volume=18000,parameters=[dict(feature='base',parameter='Length',value=15)])
validate_document(doc,criteria)
glb_metrics(glb,feature(doc,'Body').Tip.Shape)
imported=App.newDocument('LiveStep');Import.insert(str(step),imported.Name);imported.recompute()
shapes=[o.Shape for o in imported.Objects if hasattr(o,'Shape') and not o.Shape.isNull() and len(o.Shape.Solids)]
assert len(shapes)==1
compare(shape_metrics(shapes[0]),criteria)
apply_operations(doc,[dict(op='set_parameter',feature='base',parameter='Length',value=20)],'download-edit','one')
validate_document(doc,dict(bbox=[40,30,20],volume=24000))
print('live-downloads: passed')
''',*sys.argv[1:])
print(result.stdout)
