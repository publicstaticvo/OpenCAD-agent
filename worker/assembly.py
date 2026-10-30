"""Native two-component demonstrator using FreeCAD Assembly fixed joints."""
import math
import json
import sys
from pathlib import Path
import FreeCAD as App
import Part
import Sketcher

sys.path.insert(0,str(Path(App.getHomePath())/'Mod/Assembly'))
import Assembly
import JointObject

def identify(obj,stable_id):
    obj.addProperty('App::PropertyString','CadFeatureId')
    obj.CadFeatureId=stable_id
    return obj

def sketch(body,name,z=0):
    obj=identify(body.newObject('Sketcher::SketchObject',name),name)
    obj.Placement.Base=App.Vector(0,0,z)
    obj.addProperty('App::PropertyString','CadConstraintKinds');obj.CadConstraintKinds='{}'
    return obj

def dimension(sketch,kind,args,name):
    index=sketch.addConstraint(Sketcher.Constraint(kind,*args))
    sketch.renameConstraint(index,name)
    kinds=json.loads(sketch.CadConstraintKinds);kinds[name]=kind;sketch.CadConstraintKinds=json.dumps(kinds,sort_keys=True)

def rectangle(body,length,width):
    obj=sketch(body,'PlateOutline')
    points=[(0,0),(length,0),(length,width),(0,width)]
    for index in range(4):
        obj.addGeometry(Part.LineSegment(App.Vector(*points[index],0),App.Vector(*points[(index+1)%4],0)),False)
    for index in range(4):
        dimension(obj,'Coincident',[index,2,(index+1)%4,1],f'corner{index}')
        dimension(obj,'Horizontal' if index%2==0 else 'Vertical',[index],f'axis{index}')
    dimension(obj,'Coincident',[0,1,-1,1],'origin')
    dimension(obj,'Distance',[0,length],'length')
    dimension(obj,'Distance',[1,width],'width')
    return obj

def circle(body,name,diameter,center=(0,0),z=0):
    obj=sketch(body,name,z)
    obj.addGeometry(Part.Circle(App.Vector(*center,0),App.Vector(0,0,1),diameter/2),False)
    if center==(0,0):dimension(obj,'Coincident',[0,3,-1,1],'origin')
    else:
        dimension(obj,'DistanceX',[0,3,center[0]],'center_x')
        dimension(obj,'DistanceY',[0,3,center[1]],'center_y')
    dimension(obj,'Diameter',[0,diameter],'diameter')
    return obj

def extrude(body,profile,name,length,pocket=False):
    profile.Document.recompute()
    if profile.solve()!=0 or not profile.FullyConstrained:raise ValueError('Assembly sketch is not fully constrained')
    obj=identify(body.newObject('PartDesign::Pocket' if pocket else 'PartDesign::Pad',name),name)
    obj.Profile=profile;obj.Length=length
    profile.Document.recompute()
    if obj.Shape.isNull() or not obj.Shape.isValid() or len(obj.Shape.Solids)!=1:raise ValueError('Invalid component solid')
    return obj

def check_dimensions(obj,expected):
    if not obj.FullyConstrained or obj.solve()!=0:raise ValueError(f'{obj.Name} is not fully constrained')
    for name,value in expected.items():
        matches=[index for index,constraint in enumerate(obj.Constraints) if constraint.Name==name]
        if len(matches)!=1 or abs(obj.getDatum(matches[0]).Value-value)>1e-7:raise ValueError(f'{obj.Name}.{name} differs from approved dimensions')

def validate_plate(doc,design):
    from worker.validation import compare,shape_metrics
    body=doc.getObject('Plate')
    if body is None or body.Tip!=doc.getObject('PlatePocket'):raise ValueError('Plate feature history incomplete')
    check_dimensions(doc.PlateOutline,dict(length=design['length'],width=design['width']))
    check_dimensions(doc.PlateHole,dict(diameter=design['holeDiameter'],center_x=design['length']/2,center_y=design['width']/2))
    for name,value in [('PlatePad',design['thickness']),('PlatePocket',design['thickness'])]:
        if abs(doc.getObject(name).Length.Value-value)>1e-7:raise ValueError(f'{name} differs from approved thickness')
    metrics=shape_metrics(body.Tip.Shape)
    compare(metrics,dict(bbox=[design['length'],design['width'],design['thickness']],volume=design['length']*design['width']*design['thickness']-math.pi*(design['holeDiameter']/2)**2*design['thickness']))
    return metrics

def validate_pin(doc,design):
    from worker.validation import compare,shape_metrics
    body=doc.getObject('Pin')
    if body is None or body.Tip!=doc.getObject('PinPad'):raise ValueError('Pin feature history incomplete')
    check_dimensions(doc.PinOutline,dict(diameter=design['pinDiameter']))
    if abs(doc.PinPad.Length.Value-design['pinLength'])>1e-7:raise ValueError('Pin length differs from approved dimensions')
    metrics=shape_metrics(body.Tip.Shape)
    compare(metrics,dict(bbox=[design['pinDiameter'],design['pinDiameter'],design['pinLength']],volume=math.pi*(design['pinDiameter']/2)**2*design['pinLength']))
    return metrics

def build_demo(length,width,thickness,hole_diameter,pin_diameter,pin_length,observe=lambda stage,data:None):
    values=[length,width,thickness,hole_diameter,pin_diameter,pin_length]
    if any(type(value) not in (int,float) or not math.isfinite(value) or value<=0 for value in values):raise ValueError('Positive finite assembly dimensions required')
    if hole_diameter>=min(length,width):raise ValueError('Hole exceeds plate')
    doc=App.newDocument('PinPlateAssembly')
    build_plate(doc,length,width,thickness,hole_diameter,observe)
    build_pin(doc,pin_diameter,pin_length,observe)
    assemble(doc,length/2,width/2,observe)
    return doc

def build_plate(doc,length,width,thickness,hole_diameter,observe=lambda stage,data:None):
    if doc.Objects:raise ValueError('Plate creation requires empty candidate')
    plate=identify(doc.addObject('PartDesign::Body','Plate'),'plate')
    plate.Label='底板'
    observe('part_start',dict(partId='plate'))
    outline=rectangle(plate,length,width);observe('sketch_complete',dict(partId='plate',feature=outline.Name))
    extrude(plate,outline,'PlatePad',thickness)
    observe('feature_complete',dict(partId='plate',feature='PlatePad',operation='Pad'))
    hole=circle(plate,'PlateHole',hole_diameter,(length/2,width/2),thickness)
    extrude(plate,hole,'PlatePocket',thickness,True)
    observe('feature_complete',dict(partId='plate',feature='PlatePocket',operation='Pocket'))
    observe('part_complete',dict(partId='plate',volume=plate.Shape.Volume))
    return plate

def build_pin(doc,pin_diameter,pin_length,observe=lambda stage,data:None):
    if doc.getObject('Plate') is None or doc.getObject('Pin') is not None:raise ValueError('Pin requires completed plate and unique part ID')
    if doc.Plate.Shape.isNull() or not doc.Plate.Shape.isValid() or len(doc.Plate.Shape.Solids)!=1:raise ValueError('Plate geometry invalid before pin')
    pin=identify(doc.addObject('PartDesign::Body','Pin'),'pin');pin.Label='圆柱销'
    observe('part_start',dict(partId='pin'))
    profile=circle(pin,'PinOutline',pin_diameter);observe('sketch_complete',dict(partId='pin',feature=profile.Name))
    extrude(pin,profile,'PinPad',pin_length)
    observe('feature_complete',dict(partId='pin',feature='PinPad',operation='Pad'))
    observe('part_complete',dict(partId='pin',volume=pin.Shape.Volume))
    return pin

def edit_pin(doc,pin_diameter,observe=lambda stage,data:None):
    pin=doc.getObject('Pin');profile=doc.getObject('PinOutline')
    if pin is None or profile is None or pin.Tip!=doc.getObject('PinPad'):raise ValueError('Pin edit requires an existing parametric pin')
    index=[i for i,c in enumerate(profile.Constraints) if c.Name=='diameter']
    if len(index)!=1:raise ValueError('Pin diameter constraint is missing')
    profile.setDatum(index[0],App.Units.Quantity(pin_diameter,'mm'));doc.recompute()
    if pin.Shape.isNull() or not pin.Shape.isValid() or len(pin.Shape.Solids)!=1:raise ValueError('Edited pin geometry invalid')
    observe('feature_complete',dict(partId='pin',feature='PinOutline',operation='set_parameter'))
    observe('part_complete',dict(partId='pin',volume=pin.Shape.Volume))
    return pin

def assemble(doc,center_x,center_y,observe=lambda stage,data:None):
    plate=doc.getObject('Plate');pin=doc.getObject('Pin')
    if plate is None or pin is None or doc.getObject('Assembly') is not None:raise ValueError('Assembly requires two completed unique parts')
    for body in [plate,pin]:
        if body.Shape.isNull() or not body.Shape.isValid() or len(body.Shape.Solids)!=1:raise ValueError('Component geometry invalid before assembly')
    assembly=doc.addObject('Assembly::AssemblyObject','Assembly');assembly.Type='Assembly'
    joints=assembly.newObject('Assembly::JointGroup','Joints')
    first=assembly.newObject('App::Link','PlateComponent');first.setLink(plate)
    second=assembly.newObject('App::Link','PinComponent');second.setLink(pin)
    ground=joints.newObject('App::FeaturePython','Ground');JointObject.GroundedJoint(ground,first)
    fixed=joints.newObject('App::FeaturePython','Fixed');JointObject.Joint(fixed,0)
    fixed.Proxy.setJointConnectors(fixed,[[first,['']],[second,['']]])
    fixed.Offset1=App.Placement(App.Vector(center_x,center_y,0),App.Rotation())
    doc.recompute()
    if assembly.solve()!=0:raise ValueError('Assembly solver failed')
    doc.recompute();observe('assembly_complete',dict(components=[first.Name,second.Name]))
    return assembly

def inspect_assembly(doc):
    doc.recompute()
    if any('Invalid' in obj.State or 'Error' in obj.State for obj in doc.Objects):raise ValueError('Assembly recompute failed')
    if doc.getObject('Assembly') is None or doc.Assembly.TypeId!='Assembly::AssemblyObject':raise ValueError('Native assembly object missing')
    allowed={'Plate','PlateOutline','PlatePad','PlateHole','PlatePocket','Pin','PinOutline','PinPad','Assembly','Joints','PlateComponent','PinComponent','Ground','Fixed'}
    reference_names={'X_Axis','Y_Axis','Z_Axis','XY_Plane','XZ_Plane','YZ_Plane'}
    unexpected=[obj.Name for obj in doc.Objects if obj.Name not in allowed and obj.TypeId not in ('App::Origin','PartDesign::FeaturePython') and obj.Name.rstrip('0123456789') not in reference_names and not obj.Name.startswith('Origin')]
    if unexpected:raise ValueError('Assembly document contains unexpected objects: '+','.join(unexpected))
    assembly_children=sorted(obj.Name for obj in doc.Assembly.Group)
    if assembly_children!=['Fixed','Ground','Joints','PinComponent','PlateComponent']:raise ValueError('Assembly contains unexpected children: '+','.join(assembly_children))
    if sorted(obj.Name for obj in doc.Joints.Group)!=['Fixed','Ground']:raise ValueError('Assembly joint group contains unexpected joints')
    if sorted(obj.Name for obj in doc.Objects if obj.TypeId=='PartDesign::Body')!=['Pin','Plate']:raise ValueError('Assembly contains unexpected bodies')
    components=[obj for obj in doc.Assembly.Group if obj.TypeId=='App::Link']
    if len(components)!=2:raise ValueError('Assembly requires two components')
    report=[];bom=[]
    for component in components:
        body=component.LinkedObject
        if body.TypeId!='PartDesign::Body' or body.Tip is None:raise ValueError('Missing parametric component')
        expected_features=['PlateOutline','PlatePad','PlateHole','PlatePocket'] if body.Name=='Plate' else ['PinOutline','PinPad'] if body.Name=='Pin' else []
        if [obj.Name for obj in body.Group]!=expected_features:raise ValueError('Component feature history contains unexpected objects')
        shape=component.Shape
        if shape.isNull() or not shape.isValid() or len(shape.Solids)!=1:raise ValueError('Invalid component geometry')
        position=component.Placement.Base
        report.append(dict(id=component.Name,partId=body.CadFeatureId,position=[position.x,position.y,position.z],rotation=list(component.Placement.Rotation.Q),volume=shape.Volume))
        parameters={}
        for obj in body.Group:
            if obj.TypeId=='Sketcher::SketchObject':
                if not obj.FullyConstrained:raise ValueError('Underconstrained component sketch')
                parameters[obj.Name]={constraint.Name:obj.getDatum(index).Value for index,constraint in enumerate(obj.Constraints) if constraint.Type in ('Distance','Diameter','DistanceX','DistanceY')}
            elif obj.TypeId in ('PartDesign::Pad','PartDesign::Pocket'):
                if obj.Length.Value<=0 or obj.Shape.isNull() or not obj.Shape.isValid():raise ValueError('Invalid parametric feature')
                parameters[obj.Name]=dict(length=obj.Length.Value)
        bom.append(dict(partId=body.CadFeatureId,number=body.Name,name=body.Label,quantity=1,parameters=parameters))
    intersection=components[0].Shape.common(components[1].Shape)
    if not intersection.isNull() and not intersection.isValid():raise ValueError('Invalid intersection geometry')
    volume=intersection.Volume
    if not math.isfinite(volume) or volume<0:raise ValueError('Invalid intersection volume')
    state='collision' if volume>1e-7 else 'clear'
    reason='实体发生材料重叠' if state=='collision' else None
    axis=doc.PinComponent.Placement.Rotation.multVec(App.Vector(0,0,1))
    hole_center=App.Vector(doc.PlateHole.getDatum(next(i for i,c in enumerate(doc.PlateHole.Constraints) if c.Name=='center_x')).Value,doc.PlateHole.getDatum(next(i for i,c in enumerate(doc.PlateHole.Constraints) if c.Name=='center_y')).Value,doc.PlatePad.Length.Value)
    pin_base=doc.PinComponent.Placement.Base
    centerline_error=(pin_base-hole_center).cross(axis).Length
    hole_radius=doc.PlateHole.getDatum(next(i for i,c in enumerate(doc.PlateHole.Constraints) if c.Name=='diameter')).Value/2
    pin_radius=doc.PinOutline.getDatum(next(i for i,c in enumerate(doc.PinOutline.Constraints) if c.Name=='diameter')).Value/2
    if state=='clear' and pin_radius>=hole_radius:state='invalid';reason='圆柱销直径必须小于孔径'
    pin_top=pin_base+axis*doc.PinPad.Length.Value
    penetration=pin_top.dot(App.Vector(0,0,1))-doc.PlateHole.Placement.Base.z
    relation=dict(type='Fixed',first=doc.Fixed.Reference1[0].Name,second=doc.Fixed.Reference2[0].Name)
    if state=='clear' and (centerline_error>1e-7 or axis.getAngle(App.Vector(0,0,1))>1e-7):state='invalid';reason='圆柱销与底板孔不同轴'
    elif state=='clear' and penetration<doc.PlatePad.Length.Value-1e-7:state='invalid';reason='圆柱销没有贯穿底板'
    return dict(bom=bom,components=report,relation=relation,interference=dict(status=state,reason=reason,pairs=[dict(components=[obj.Name for obj in components],volume=volume)]))

def export_preview(doc,path):
    import Import
    components=[obj for obj in doc.Assembly.Group if obj.TypeId=='App::Link'] if doc.getObject('Assembly') else [obj for obj in doc.Objects if obj.TypeId=='PartDesign::Body']
    mesh_doc=App.newDocument('AssemblyMeshExport')
    try:
        mesh_objects=[]
        for component in components:
            obj=mesh_doc.addObject('Part::Feature',component.Name)
            shape=component.Shape.copy();placement=shape.Placement;shape.Placement=App.Placement()
            obj.Shape=shape.transformGeometry(placement.toMatrix());obj.Label=component.Label
            obj.Shape.tessellate(0.1);mesh_objects.append(obj)
        mesh_doc.recompute();Import.export(mesh_objects,str(Path(path).resolve()))
    finally:App.closeDocument(mesh_doc.Name)
    return Part.makeCompound([component.Shape for component in components])

def export_assembly(doc,directory,progress=lambda stage,status:None):
    import Import
    from worker.artifacts import glb_metrics
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
    report=inspect_assembly(doc)
    components=[obj for obj in doc.Assembly.Group if obj.TypeId=='App::Link']
    progress('export_step','start')
    Import.export([doc.Assembly],str((directory/'model.step').resolve()))
    imported=App.newDocument('AssemblyStepCheck')
    try:
        Import.insert(str((directory/'model.step').resolve()),imported.Name);imported.recompute()
        shapes=[obj.Shape for obj in imported.Objects if hasattr(obj,'Shape') and obj.TypeId!='App::Part' and not obj.Shape.isNull() and obj.Shape.Solids]
        solids=[solid for shape in shapes for solid in shape.Solids]
        if len(solids)!=len(components):raise ValueError(f'Assembly STEP component count mismatch: {len(solids)}')
        expected=[component.Shape for component in components]
        unmatched=list(solids)
        for shape in expected:
            matches=[solid for solid in unmatched if abs(solid.Volume-shape.Volume)<1e-5 and abs(solid.common(shape).Volume-shape.Volume)<1e-5]
            if len(matches)!=1:raise ValueError('Assembly STEP component geometry or placement mismatch')
            unmatched.remove(matches[0])
    finally:App.closeDocument(imported.Name)
    progress('export_step','complete')
    progress('export_glb','start')
    export_preview(doc,directory/'preview.glb')
    # The compound is a metrics-only aggregate; the FCStd retains independent linked Bodies.
    aggregate=Part.makeCompound([component.Shape for component in components])
    mesh=glb_metrics(directory/'preview.glb',aggregate)
    if mesh['meshes']!=len(components):raise ValueError('Assembly GLB component count mismatch')
    progress('export_glb','complete')
    return dict(step=dict(solids=len(solids)),glb=mesh,assembly=report)

def validate_assembly(doc,criteria,design):
    from worker.validation import compare
    if design.get('kind') not in ('pin_plate_assembly','edit_pin_plate_assembly'):raise ValueError('Assembly design contract required')
    expected=design['assembly'];report=inspect_assembly(doc)
    if report['interference']['status']!='clear':raise ValueError('Assembly validation failed: '+json.dumps(report['interference']))
    want=[
        ('PlateOutline','length',expected['length']),('PlateOutline','width',expected['width']),
        ('PlateHole','diameter',expected['holeDiameter']),('PlateHole','center_x',expected['length']/2),('PlateHole','center_y',expected['width']/2),
        ('PinOutline','diameter',expected['pinDiameter'])]
    for name,parameter,value in want:
        obj=doc.getObject(name)
        matches=[index for index,constraint in enumerate(obj.Constraints) if constraint.Name==parameter]
        if len(matches)!=1 or abs(obj.getDatum(matches[0]).Value-value)>1e-7:raise ValueError('Assembly dimension differs from approved design')
    for name,value in [('PlatePad',expected['thickness']),('PlatePocket',expected['thickness']),('PinPad',expected['pinLength'])]:
        if abs(doc.getObject(name).Length.Value-value)>1e-7:raise ValueError('Assembly feature length differs from approval')
    for actual,position in zip(report['components'],[[0,0,0],[expected['length']/2,expected['width']/2,0]]):
        if any(abs(a-b)>1e-7 for a,b in zip(actual['position'],position)) or actual['rotation']!=[0,0,0,1]:raise ValueError('Assembly position differs from approved design')
    if doc.PlateComponent.LinkedObject!=doc.Plate or doc.PinComponent.LinkedObject!=doc.Pin:raise ValueError('Assembly component links differ from approval')
    if doc.Fixed.JointType!='Fixed' or doc.Fixed.Reference1[0]!=doc.PlateComponent or doc.Fixed.Reference2[0]!=doc.PinComponent or doc.Ground.ObjectToGround!=doc.PlateComponent:raise ValueError('Assembly relation differs from approval')
    shape=Part.makeCompound([doc.PlateComponent.Shape,doc.PinComponent.Shape])
    box=shape.BoundBox
    metrics=dict(solids=len(shape.Solids),volume=shape.Volume,bbox=[box.XLength,box.YLength,box.ZLength]);compare(metrics,criteria)
    if metrics['solids']!=2:raise ValueError('Assembly requires two solids')
    return {**metrics,'assembly':report}
