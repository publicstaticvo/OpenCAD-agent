"""Restricted editable Part Design operations. No source code or paths cross this API."""
import hashlib
import json
import math
import uuid
import FreeCAD as App
import Part
import Sketcher
from worker.contracts import assert_contract

SUPPORTED = {'PartDesign::Body', 'Sketcher::SketchObject', 'PartDesign::Pad', 'PartDesign::Pocket'}

def feature(doc, stable_id, expected=None):
    found = [o for o in doc.Objects if 'CadFeatureId' in o.PropertiesList and o.CadFeatureId == stable_id]
    if len(found) != 1 or found[0].TypeId not in SUPPORTED:
        raise ValueError(f'Unknown or ambiguous feature: {stable_id}')
    obj = found[0]
    if expected and obj.TypeId != expected:
        raise ValueError(f'Wrong feature type: {stable_id}')
    return obj

def tag(obj, stable_id):
    obj.addProperty('App::PropertyString', 'CadFeatureId')
    obj.CadFeatureId = stable_id
    obj.Label = stable_id
    return obj

def bodies(doc):
    return [o for o in doc.Objects if o.TypeId == 'PartDesign::Body']

def add_named_constraint(sketch, op):
    kinds = json.loads(sketch.CadConstraintKinds)
    if op['name'] in kinds: raise ValueError('Duplicate constraint name')
    kind, args = op['kind'], op['args']
    arity = dict(Coincident=4, Horizontal=1, Vertical=1, Distance=2, DistanceX=3, DistanceY=3, Diameter=2, Radius=2, Equal=2)
    if len(args) != arity[kind]: raise ValueError('Unsupported constraint arity')
    def index(i, external=False):
        if type(i) not in (int,float) or int(i)!=i or not (-1 if external else 0) <= i < sketch.GeometryCount:
            raise ValueError('Invalid geometry reference')
        return int(i)
    def point(g,p):
        g=index(g,True)
        choices=[1] if g==-1 else ([1,2] if isinstance(sketch.Geometry[g],Part.LineSegment) else [3])
        if p not in choices: raise ValueError('Invalid geometry point')
        return [g,int(p)]
    if kind=='Coincident': converted=point(*args[:2])+point(*args[2:])
    elif kind in ('Horizontal','Vertical'):
        converted=[index(args[0])]
        if not isinstance(sketch.Geometry[converted[0]],Part.LineSegment): raise ValueError('Line required')
    elif kind=='Equal':converted=[index(i) for i in args]
    elif kind in ('DistanceX','DistanceY'):converted=point(*args[:2])+[float(args[2])]
    else:
        converted=[index(args[0]),float(args[1])]
        if args[1]<=0:raise ValueError('Positive dimension required')
        if kind in ('Diameter','Radius') and not isinstance(sketch.Geometry[converted[0]],Part.Circle):raise ValueError('Circle required')
        if kind=='Distance' and not isinstance(sketch.Geometry[converted[0]],Part.LineSegment):raise ValueError('Line required')
    idx=sketch.addConstraint(Sketcher.Constraint(kind,*converted))
    sketch.renameConstraint(idx,op['name'])
    kinds[op['name']]=kind
    sketch.CadConstraintKinds=json.dumps(kinds,sort_keys=True)
    if sketch.solve()!=0:raise ValueError('Conflicting sketch constraints')

def apply_operations(doc, operations, operation_id, step_id):
    if type(operations) is not list or not 1<=len(operations)<=256:raise ValueError('Invalid operations count')
    for op in operations:assert_contract('operation',op)
    if not isinstance(operation_id,str) or not isinstance(step_id,str) or not operation_id or not step_id:raise ValueError('Step identity required')
    digest=hashlib.sha256(json.dumps(operations,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    key=json.dumps([operation_id,step_id])
    body_list=bodies(doc)
    steps=json.loads(body_list[0].CadAppliedSteps) if body_list and 'CadAppliedSteps' in body_list[0].PropertiesList else {}
    if key in steps:
        if steps[key]!=digest:raise ValueError('Step identity reused with different content')
        return inspect_document(doc)
    doc.openTransaction('CAD candidate step')
    try:
        for op in operations:
            kind=op['op']
            if 'id' in op:
                if any('CadFeatureId' in o.PropertiesList and o.CadFeatureId==op['id'] for o in doc.Objects):raise ValueError('Duplicate feature ID')
            name='F'+uuid.uuid4().hex
            if kind=='create_body':
                if bodies(doc):raise ValueError('Single Body only')
                body=tag(doc.addObject('PartDesign::Body',name),op['id'])
                body.addProperty('App::PropertyString','CadAppliedSteps');body.CadAppliedSteps='{}'
            elif kind=='create_sketch':
                body=feature(doc,op['body'],'PartDesign::Body')
                sk=tag(body.newObject('Sketcher::SketchObject',name),op['id'])
                sk.addProperty('App::PropertyString','CadConstraintKinds');sk.CadConstraintKinds='{}'
                rotation={'XY':App.Rotation(),'XZ':App.Rotation(App.Vector(1,0,0),90),'YZ':App.Rotation(App.Vector(0,1,0),90)}[op['plane']]
                sk.Placement=App.Placement(App.Vector(*op['origin']),rotation)
            elif kind=='add_geometry':
                sk=feature(doc,op['sketch'],'Sketcher::SketchObject');g=op['geometry']
                if op['geometryId']!=sk.GeometryCount:raise ValueError('Geometry IDs must be contiguous')
                if g['kind']=='line':
                    if math.dist(g['from'],g['to'])<1e-7:raise ValueError('Degenerate line')
                    shape=Part.LineSegment(App.Vector(*g['from'],0),App.Vector(*g['to'],0))
                else:shape=Part.Circle(App.Vector(*g['center'],0),App.Vector(0,0,1),g['radius'])
                sk.addGeometry(shape,False)
            elif kind=='add_constraint':add_named_constraint(feature(doc,op['sketch'],'Sketcher::SketchObject'),op)
            elif kind in ('pad','pocket'):
                sk=feature(doc,op['sketch'],'Sketcher::SketchObject');doc.recompute()
                if not sk.FullyConstrained:raise ValueError('Sketch must be fully constrained before solid operation')
                body=sk.getParentGeoFeatureGroup()
                solid=tag(body.newObject('PartDesign::Pad' if kind=='pad' else 'PartDesign::Pocket',name),op['id'])
                solid.Profile=sk;solid.Length=op['length'];solid.Reversed=False
            elif kind=='set_parameter':
                obj=feature(doc,op['feature']);parameter=op['parameter'];value=op['value']
                if obj.TypeId in ('PartDesign::Pad','PartDesign::Pocket') and parameter=='Length':
                    if value<=0:raise ValueError('Positive Length required')
                    obj.Length=value
                elif obj.TypeId=='Sketcher::SketchObject':
                    kinds=json.loads(obj.CadConstraintKinds)
                    if parameter not in kinds or kinds[parameter] not in ('Distance','DistanceX','DistanceY','Diameter','Radius'):raise ValueError('Parameter not editable')
                    if kinds[parameter] in ('Distance','Diameter','Radius') and value<=0:raise ValueError('Positive dimension required')
                    obj.setDatum(constraint_index(obj,parameter),App.Units.Quantity(f'{value} mm'))
                    if obj.solve()!=0:raise ValueError('Conflicting sketch constraints')
                else:raise ValueError('Parameter not editable')
            doc.recompute()
            if any('Invalid' in o.State or 'Error' in o.State for o in doc.Objects):raise ValueError('Model recompute failed')
        body=bodies(doc)[0];steps[key]=digest;body.CadAppliedSteps=json.dumps(steps,sort_keys=True)
        doc.commitTransaction()
    except Exception:
        doc.abortTransaction()
        raise
    return inspect_document(doc)

def constraint_index(sketch, name):
    matches=[i for i,c in enumerate(sketch.Constraints) if c.Name==name]
    if len(matches)!=1:raise ValueError('Named constraint missing or ambiguous')
    return matches[0]

def inspect_document(doc):
    result=[]
    for obj in doc.Objects:
        if obj.TypeId not in SUPPORTED:continue
        if 'CadFeatureId' not in obj.PropertiesList:raise ValueError('Feature ID missing')
        params={};constraints={}
        if obj.TypeId=='Sketcher::SketchObject':
            if 'CadConstraintKinds' not in obj.PropertiesList:raise ValueError('Constraint metadata missing')
            for name,kind in json.loads(obj.CadConstraintKinds).items():
                idx=constraint_index(obj,name)
                if idx<0:raise ValueError('Named constraint missing')
                constraints[name]=idx
                if kind in ('Distance','DistanceX','DistanceY','Diameter','Radius'):params[name]=obj.getDatum(idx).Value
        if obj.TypeId in ('PartDesign::Pad','PartDesign::Pocket'):params['Length']=obj.Length.Value
        parent=obj.getParentGeoFeatureGroup()
        result.append(dict(id=obj.CadFeatureId,label=obj.Label,type=obj.TypeId,parent=parent.CadFeatureId if parent and 'CadFeatureId' in parent.PropertiesList else None,parameters=params,constraints=constraints))
    if len({o['id'] for o in result})!=len(result):raise ValueError('Duplicate feature ID')
    return result
