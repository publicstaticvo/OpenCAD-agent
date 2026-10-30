"""Independent native acceptance for the advanced-model two-part assembly."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'worker/tests'))
from native_harness import native
result=native('''
import json,sys
from pathlib import Path
import FreeCAD as App,Import,Part
from worker.assembly import inspect_assembly
from worker.artifacts import glb_metrics
fcstd,step,glb=map(Path,sys.argv[1:])
doc=App.openDocument(str(fcstd));report=inspect_assembly(doc)
if len(report['bom'])!=2 or len(report['components'])!=2:raise RuntimeError(json.dumps(report,ensure_ascii=False))
if report['components'][0]['position']!=[0,0,0] or report['components'][1]['position']!=[30,20,0]:raise RuntimeError('position mismatch')
expected_parameters=[dict(PlateOutline=dict(length=60,width=40),PlateHole=dict(center_x=30,center_y=20,diameter=8),PlatePad=dict(length=8),PlatePocket=dict(length=8)),dict(PinOutline=dict(diameter=7),PinPad=dict(length=20))]
for actual,expected in zip(report['bom'],expected_parameters):
 if actual['quantity']!=1 or actual['parameters']!=expected:raise RuntimeError('BOM or parameter mismatch')
for component,bounds in [(doc.PlateComponent,[0,60,0,40,0,8]),(doc.PinComponent,[26.5,33.5,16.5,23.5,0,20])]:
 box=component.Shape.BoundBox
 if any(abs(a-b)>1e-7 for a,b in zip([box.XMin,box.XMax,box.YMin,box.YMax,box.ZMin,box.ZMax],bounds)):raise RuntimeError('component bounds mismatch')
if not all(obj.FullyConstrained for obj in doc.Objects if obj.TypeId=='Sketcher::SketchObject'):raise RuntimeError('sketch constraint mismatch')
if doc.Assembly.solve()!=0:raise RuntimeError('assembly solve failed')
if report['interference']['status']!='clear' or report['interference']['pairs'][0]['volume']>=1e-7:raise RuntimeError('interference mismatch')
imported=App.newDocument('AdvancedAssemblyStep');Import.insert(str(step),imported.Name);imported.recompute()
solids=[solid for obj in imported.Objects if hasattr(obj,'Shape') and obj.TypeId!='App::Part' and not obj.Shape.isNull() for solid in obj.Shape.Solids]
if len(solids)!=2:raise RuntimeError('step solid count mismatch: '+str(len(solids)))
for component in [doc.PlateComponent,doc.PinComponent]:
 matches=[solid for solid in solids if abs(solid.Volume-component.Shape.Volume)<1e-5 and abs(solid.common(component.Shape).Volume-component.Shape.Volume)<1e-5]
 if len(matches)!=1:raise RuntimeError('STEP component geometry or placement mismatch')
aggregate=Part.makeCompound([doc.PlateComponent.Shape,doc.PinComponent.Shape]);metrics=glb_metrics(glb,aggregate)
if metrics['meshes']!=2:raise RuntimeError('glb mesh count mismatch: '+str(metrics))
print(json.dumps(dict(bom=len(report['bom']),components=len(report['components']),stepSolids=len(solids),glbMeshes=metrics['meshes'],interference=report['interference']),ensure_ascii=False))
''',*sys.argv[1:],timeout=60)
print('advanced-assembly-downloads: passed')
print(result.stdout)
candidate=Path(sys.argv[1]).with_name('native-m2-candidate.FCStd')
native('''
import sys,math
import FreeCAD as App
from worker.assembly import edit_pin,inspect_assembly
doc=App.openDocument(sys.argv[1]);before=inspect_assembly(doc)
edit_pin(doc,10);after=inspect_assembly(doc)
assert before['bom'][0]==after['bom'][0]
for old,new in zip(before['components'],after['components']):
 assert all(old[key]==new[key] for key in ['id','partId','position','rotation'])
assert abs(after['components'][1]['volume']-math.pi*25*20)<1e-6
assert after['interference']['status']=='collision'
assert abs(after['interference']['pairs'][0]['volume']-72*math.pi)<1e-6
doc.saveAs(sys.argv[2]);App.closeDocument(doc.Name)
''',sys.argv[1],str(candidate),timeout=60)
reopened=native('''
import sys,json,math
import FreeCAD as App
from worker.assembly import inspect_assembly
doc=App.openDocument(sys.argv[1]);report=inspect_assembly(doc)
assert report['bom'][1]['parameters']['PinOutline']['diameter']==10
assert report['interference']['status']=='collision'
assert abs(report['interference']['pairs'][0]['volume']-72*math.pi)<1e-6
print(json.dumps(report['interference'],ensure_ascii=False))
App.closeDocument(doc.Name)
''',str(candidate),timeout=60)
print('native-m2-collision-reopen: passed')
print(reopened.stdout)
