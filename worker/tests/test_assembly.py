import unittest
from native_harness import native

class AssemblyTests(unittest.TestCase):
    def test_candidate_package_independent_verification_and_collision_rejection(self):
        native("""
import math,json
from pathlib import Path
from tempfile import mkdtemp
import FreeCAD as App
from worker.assembly import build_demo
from worker.artifacts import prepare_revision,verify_package
design=dict(length=80,width=60,thickness=10,holeDiameter=8,pinDiameter=7,pinLength=20)
criteria=dict(bbox=[80,60,20],volume=48000-math.pi*16*10+math.pi*3.5**2*20)
directory=Path(mkdtemp(dir='.work',prefix='assembly-package-'))
doc=build_demo(80,60,10,8,7,20)
(directory/'design.json').write_text(json.dumps(dict(kind='pin_plate_assembly',assembly=design)))
result=prepare_revision(doc,directory,criteria)
assert result['validation']['solids']==2
assert result['validation']['assembly']['interference']['status']=='clear'
assert len(verify_package(directory))==6
App.closeDocument(doc.Name)
directory=Path(mkdtemp(dir='.work',prefix='assembly-collision-package-'))
doc=build_demo(80,60,10,8,9,20)
(directory/'design.json').write_text(json.dumps(dict(kind='pin_plate_assembly',assembly={**design,'pinDiameter':9})))
try:prepare_revision(doc,directory,criteria)
except ValueError:pass
else:raise AssertionError('Collision package accepted')
assert not (directory/'manifest.json').exists()
App.closeDocument(doc.Name)
""",timeout=60)

    def test_candidate_stages_require_order_and_envelope(self):
        native("""
import math
from pathlib import Path
from tempfile import mkdtemp
import FreeCAD as App
from worker.candidates import Candidates
root=Path(mkdtemp(dir='.work',prefix='assembly-candidate-'))
session=Candidates(root)
envelope=dict(documentId='assembly',baseRevision=0,operationId='build',candidateId='candidate')
session.dispatch('begin_candidate',dict(envelope=envelope))
design=dict(length=80,width=60,thickness=10,holeDiameter=8,pinDiameter=7,pinLength=20)
def stage(name):return session.dispatch('assembly_stage',dict(envelope=envelope,stage=name,design=design))
try:stage('pin')
except ValueError:pass
else:raise AssertionError('Pin before plate accepted')
plate=stage('plate');assert len([row for row in plate['tree'] if row['type']=='PartDesign::Body'])==1
pin=stage('pin');assert len([row for row in pin['tree'] if row['type']=='PartDesign::Body'])==2
assert abs(pin['geometry']['volume']-math.pi*3.5**2*20)<1e-6
assembled=stage('assemble');assert assembled['assembly']['components'][1]['position']==[40,30,0]
checked=stage('check');assert checked['assembly']['interference']['status']=='clear'
try:session.dispatch('assembly_stage',dict(envelope={**envelope,'operationId':'different'},stage='check',design=design))
except ValueError:pass
else:raise AssertionError('Wrong candidate envelope accepted')
session.dispatch('discard_candidate',dict(envelope=envelope))
""")

    def test_native_assembly_normal_collision_and_restore(self):
        result=native("""
import json,math,os
from pathlib import Path
import FreeCAD as App
from worker.assembly import build_demo,inspect_assembly,export_assembly
directory=Path('.work/assembly-native');directory.mkdir(exist_ok=True)
for diameter,expected in [(7,0),(9,math.pi*(4.5**2-4**2)*10)]:
 doc=build_demo(80,60,10,8,diameter,20)
 report=inspect_assembly(doc)
 assert len(report['bom'])==2 and len(report['components'])==2
 assert report['components'][1]['position']==[40,30,0],report
 assert report['interference']['status']==('clear' if diameter==7 else 'collision')
 assert abs(report['interference']['pairs'][0]['volume']-expected)<1e-6
 assert all(o.FullyConstrained for o in doc.Objects if o.TypeId=='Sketcher::SketchObject')
 assert len([o for o in doc.Objects if o.TypeId=='PartDesign::Body'])==2
 assert doc.Assembly.solve()==0
 path=directory/f'assembly-{diameter}.FCStd';doc.saveAs(str(path.resolve()));App.closeDocument(doc.Name)
 reopened=App.openDocument(str(path.resolve()))
 assert inspect_assembly(reopened)==report
 exports=export_assembly(reopened,directory/f'exports-{diameter}')
 assert exports['step']['solids']==2 and exports['glb']['meshes']==2,exports
 assert reopened.Fixed.JointType=='Fixed' and reopened.Ground.ObjectToGround==reopened.PlateComponent
 assert reopened.PinComponent.LinkedObject==reopened.Pin
 assert reopened.Assembly.solve()==0
 assert inspect_assembly(reopened)==report
 print(json.dumps(report))
 App.closeDocument(reopened.Name)
""",timeout=60)
        self.assertIn('collision',result.stdout)

    def test_fresh_process_reopens_joint_sources_and_exports(self):
        native("""
from pathlib import Path
import FreeCAD as App
from worker.assembly import build_demo
directory=Path('.work/assembly-independent');directory.mkdir(exist_ok=True)
doc=build_demo(80,60,10,8,7,20)
doc.saveAs(str((directory/'model.FCStd').resolve()))
App.closeDocument(doc.Name)
""")
        result=native("""
import json
from pathlib import Path
import FreeCAD as App
from worker.assembly import inspect_assembly,export_assembly
directory=Path('.work/assembly-independent')
doc=App.openDocument(str((directory/'model.FCStd').resolve()))
assert doc.Assembly.solve()==0
report=inspect_assembly(doc)
assert report['components'][1]['position']==[40,30,0]
assert report['interference']['status']=='clear'
assert doc.PinPad.Profile[0]==doc.PinOutline and doc.PlatePocket.Profile[0]==doc.PlateHole
exports=export_assembly(doc,directory)
(directory/'verified.json').write_text(json.dumps(exports,ensure_ascii=False,indent=2))
print('independent-assembly-reopen: passed')
App.closeDocument(doc.Name)
""",timeout=60)
        self.assertIn('independent-assembly-reopen: passed',result.stdout)

    def test_invalid_geometry_never_reports_clear(self):
        native("""
import FreeCAD as App
from worker.assembly import build_demo,inspect_assembly
doc=build_demo(80,60,10,8,7,20)
doc.PinPad.Length=0;doc.recompute()
try:inspect_assembly(doc)
except ValueError:pass
else:raise AssertionError('Invalid component accepted by interference check')
App.closeDocument(doc.Name)
""")

    def test_unapproved_components_and_joints_are_rejected(self):
        native("""
import FreeCAD as App
from worker.assembly import build_demo,inspect_assembly
for mutation in ('body','joint'):
 doc=build_demo(80,60,10,8,7,20)
 if mutation=='body':
  extra=doc.addObject('PartDesign::Feature','ExtraBodyFeature');extra.Shape=doc.PinPad.Shape.copy();doc.recompute()
 else:
  extra=doc.Joints.newObject('App::FeaturePython','ExtraJoint')
 try:inspect_assembly(doc)
 except ValueError:pass
 else:raise AssertionError(f'{mutation} mutation accepted')
 App.closeDocument(doc.Name)
""")

    def test_pin_edit_preserves_plate_and_detects_collision(self):
        native("""
import FreeCAD as App
from worker.assembly import build_demo,edit_pin,inspect_assembly
doc=build_demo(60,40,8,8,7,20)
before=inspect_assembly(doc)
edit_pin(doc,10)
after=inspect_assembly(doc)
assert before['bom'][0]==after['bom'][0]
assert after['bom'][1]['parameters']['PinOutline']['diameter']==10
assert after['interference']['status']=='collision'
assert abs(after['interference']['pairs'][0]['volume']-72*3.141592653589793)<1e-6
assert doc.PlateHole.getDatum(next(i for i,c in enumerate(doc.PlateHole.Constraints) if c.Name=='diameter')).Value==8
App.closeDocument(doc.Name)
""")

    def test_component_position_fit_and_penetration_are_checked(self):
        native("""
import FreeCAD as App,Sketcher
from worker.assembly import build_demo,inspect_assembly
for case,expected in [('offset','collision'),('diameter','clear'),('through','invalid')]:
 doc=build_demo(80,60,10,8,7,20)
 if case=='offset':doc.Fixed.Offset1=App.Placement(App.Vector(41,30,0),App.Rotation());doc.Assembly.solve()
 elif case=='diameter':
  index=next(i for i,c in enumerate(doc.PinOutline.Constraints) if c.Name=='diameter')
  doc.PinOutline.setDatum(index,App.Units.Quantity(5,'mm'));doc.recompute()
 else:doc.PinPad.Length=5;doc.recompute()
 report=inspect_assembly(doc)
 assert report['interference']['status']==expected,report
 App.closeDocument(doc.Name)
""")
