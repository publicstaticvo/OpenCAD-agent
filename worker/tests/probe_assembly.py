"""Run with the bundled interpreter through native_harness."""
import json
import sys
from pathlib import Path
import FreeCAD as App
import Part

runtime=Path(App.getHomePath())
sys.path.insert(0,str(runtime/'Mod/Assembly'))
import Assembly

doc=App.newDocument('AssemblyProbe')
assembly=doc.addObject('Assembly::AssemblyObject','Assembly')
assembly.Type='Assembly'
joints=assembly.newObject('Assembly::JointGroup','Joints')
print(json.dumps(dict(gui=App.GuiUp,type=assembly.TypeId,properties=assembly.PropertiesList,methods=[name for name in dir(assembly) if any(word in name.lower() for word in ['solve','joint','ground','link'])])))
import JointObject
a=doc.addObject('PartDesign::Body','Plate')
b=doc.addObject('PartDesign::Body','Pin')
first=assembly.newObject('App::Link','PlateComponent');first.setLink(a)
second=assembly.newObject('App::Link','PinComponent');second.setLink(b)
ground=joints.newObject('App::FeaturePython','Ground')
JointObject.GroundedJoint(ground,first)
joint=joints.newObject('App::FeaturePython','Fixed')
JointObject.Joint(joint,0)
joint.Proxy.setJointConnectors(joint,[[first,['']],[second,['']]])
print('solve',assembly.solve())
App.closeDocument(doc.Name)
