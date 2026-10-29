"""Verify browser-downloaded demo revisions in an independent native process."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'worker/tests'))
from native_harness import native

result=native('''
import sys,math
from pathlib import Path
import FreeCAD as App,Import
from worker.model_ops import feature,apply_operations
from worker.validation import validate_document,validate_design,shape_metrics,compare
from worker.artifacts import glb_metrics
fcstd,step,glb=map(Path,sys.argv[1:4])
diameter,length,width,height=map(float,sys.argv[4:8])
doc=App.openDocument(str(fcstd))
volume=length*width*height-math.pi*(diameter/2)**2*height
parameters=[dict(feature='base',parameter='width',value=length),dict(feature='base',parameter='height',value=width),dict(feature='pad',parameter='Length',value=height)]
if diameter:parameters.append(dict(feature='hole',parameter='diameter',value=diameter))
criteria=dict(bbox=[length,width,height],volume=volume,parameters=parameters)
validate_document(doc,criteria)
design=dict(kind='add_hole' if diameter else 'create_box',dimensions=dict(length=length,width=width,height=height),diameter=diameter)
proof=validate_design(doc,design)
if diameter:assert proof['throughHole']['through'] and proof['throughHole']['center']==[length/2,width/2]
glb_metrics(glb,feature(doc,'Body').Tip.Shape)
imported=App.newDocument('DownloadedStep');Import.insert(str(step),imported.Name);imported.recompute()
shapes=[o.Shape for o in imported.Objects if hasattr(o,'Shape') and not o.Shape.isNull() and len(o.Shape.Solids)]
assert len(shapes)==1
compare(shape_metrics(shapes[0]),criteria)
if diameter:
 apply_operations(doc,[dict(op='set_parameter',feature='hole',parameter='diameter',value=diameter+1)],'download-edit','one')
 validate_document(doc,dict(bbox=[length,width,height],volume=length*width*height-math.pi*((diameter+1)/2)**2*height))
print('demo-downloads: passed')
''',*sys.argv[1:])
print(result.stdout)
