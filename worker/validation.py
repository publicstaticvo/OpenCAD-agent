"""Deterministic native acceptance; recompute status alone is never sufficient."""
import math
import FreeCAD as App
import Part
from worker.contracts import assert_contract
from worker.model_ops import bodies,feature,inspect_document,sketch_snapshot

def shape_metrics(shape):
    if shape.isNull() or len(shape.Solids)!=1:raise ValueError('Expected exactly one solid')
    if not shape.isValid() or not math.isfinite(shape.Volume) or shape.Volume<=0:raise ValueError('Invalid solid geometry')
    box=shape.BoundBox
    return dict(solids=1,volume=shape.Volume,bbox=[box.XLength,box.YLength,box.ZLength])

def compare(metrics,criteria):
    if abs(metrics['volume']-criteria['volume'])>max(1e-6,abs(criteria['volume'])*1e-9):raise ValueError('Volume acceptance mismatch')
    if any(abs(a-b)>1e-6 for a,b in zip(metrics['bbox'],criteria['bbox'])):raise ValueError('Bounding box acceptance mismatch')

def validate_document(doc,criteria):
    assert_contract('criteria',criteria)
    if doc is None:raise ValueError('Document failed to open')
    doc.recompute()
    body_list=bodies(doc)
    if len(body_list)!=1 or body_list[0].Tip is None:raise ValueError('Expected one Body with Tip')
    metrics=shape_metrics(body_list[0].Tip.Shape)
    tree=inspect_document(doc)
    allowed={'PartDesign::Body','Sketcher::SketchObject','PartDesign::Pad','PartDesign::Pocket','App::Origin','App::Line','App::Plane','App::Point'}
    for obj in doc.Objects:
        if obj.TypeId not in allowed:raise ValueError('Unsupported object type in document')
        if any(s in obj.State for s in ('Invalid','Error')):raise ValueError('Recompute error')
        if obj.TypeId=='Sketcher::SketchObject' and (not obj.FullyConstrained or obj.solve()!=0):raise ValueError('Sketch must be fully constrained')
    compare(metrics,criteria)
    rows={x['id']:x for x in tree}
    for p in criteria.get('parameters',[]):
        value=rows.get(p['feature'],{}).get('parameters',{}).get(p['parameter'])
        if value is None or abs(value-p['value'])>1e-6:raise ValueError('Parameter acceptance mismatch')
    return dict(metrics,bodyId=body_list[0].CadFeatureId,tipId=body_list[0].Tip.CadFeatureId)

def validate_constraints(doc,sketch_id,expected):
    actual=sketch_snapshot(doc,sketch_id)
    remaining=list(actual['constraints'])
    if not actual['fullyConstrained'] or len(remaining)!=len(expected) or len({c['name'] for c in remaining})!=len(remaining):
        raise ValueError(f'Approved {sketch_id} constraints mismatch')
    for required in expected:
        matches=[i for i,c in enumerate(remaining) if all(
            math.isfinite(c[key]) and abs(c[key]-value)<=1e-6 if key=='value' else c[key]==value
            for key,value in required.items())]
        if not matches:raise ValueError(f'Approved {sketch_id} constraint type or reference mismatch')
        remaining.pop(matches[0])

def validate_design(doc,design):
    if design['kind']=='program':return {}
    rows=inspect_document(doc)
    expected={'Body':'PartDesign::Body','base':'Sketcher::SketchObject','pad':'PartDesign::Pad'}
    if design['kind']!='create_box':expected.update(hole='Sketcher::SketchObject',pocket='PartDesign::Pocket')
    if {r['id']:r['type'] for r in rows}!=expected:raise ValueError('Approved feature structure mismatch')
    base=feature(doc,'base','Sketcher::SketchObject');body=feature(doc,'Body','PartDesign::Body')
    dims=design['dimensions'];length,width,height=dims['length'],dims['width'],dims['height']
    corners=[(0,0),(length,0),(length,width),(0,width)]
    if base.GeometryCount!=4 or base.Placement.Base.Length>1e-7 or base.Placement.Rotation.Angle>1e-7:raise ValueError('Approved rectangle placement mismatch')
    for i,g in enumerate(base.Geometry):
        if not isinstance(g,Part.LineSegment):raise ValueError('Approved rectangle line mismatch')
        for point,target in [(g.StartPoint,corners[i]),(g.EndPoint,corners[(i+1)%4])]:
            if math.dist([point.x,point.y],target)>1e-6:raise ValueError('Approved rectangle dimensions mismatch')
    constraints=[]
    for i in range(4):
        constraints.append(dict(kind='Coincident',firstGeometry=i,firstPos=2,secondGeometry=(i+1)%4,secondPos=1))
        constraints.append(dict(kind='Vertical' if i%2 else 'Horizontal',firstGeometry=i))
    constraints.extend([
        dict(kind='Coincident',firstGeometry=0,firstPos=1,secondGeometry=-1,secondPos=1),
        dict(kind='Distance',name='width',firstGeometry=0,value=length),
        dict(kind='Distance',name='height',firstGeometry=1,value=width),
    ])
    validate_constraints(doc,'base',constraints)
    pad=feature(doc,'pad','PartDesign::Pad')
    if pad.Profile[0]!=base or abs(pad.Length.Value-height)>1e-6 or pad.Reversed or pad.Midplane:raise ValueError('Approved Pad profile, length or direction mismatch')
    if design['kind']=='create_box':
        if body.Tip!=pad:raise ValueError('Approved Pad Tip mismatch')
        return {}
    hole=feature(doc,'hole','Sketcher::SketchObject');pocket=feature(doc,'pocket','PartDesign::Pocket')
    cx,cy=length/2,width/2;radius=design['diameter']/2
    if hole.GeometryCount!=1 or not isinstance(hole.Geometry[0],Part.Circle):raise ValueError('Approved circle missing')
    circle=hole.Geometry[0]
    if math.dist([circle.Center.x,circle.Center.y],[cx,cy])>1e-6 or abs(circle.Radius-radius)>1e-6 or math.dist(list(hole.Placement.Base),[0,0,height])>1e-6 or hole.Placement.Rotation.Angle>1e-7:raise ValueError('Approved hole placement or diameter mismatch')
    validate_constraints(doc,'hole',[
        dict(kind='Diameter',name='diameter',firstGeometry=0,value=design['diameter']),
        dict(kind='DistanceX',name='center_x',firstGeometry=0,firstPos=3,value=cx),
        dict(kind='DistanceY',name='center_y',firstGeometry=0,firstPos=3,value=cy),
    ])
    if pocket.Profile[0]!=hole or abs(pocket.Length.Value-height)>1e-6 or pocket.Reversed or body.Tip!=pocket:raise ValueError('Approved through Pocket mismatch')
    shape=body.Tip.Shape
    cylinder=[f for f in shape.Faces if isinstance(f.Surface,Part.Cylinder) and abs(f.Surface.Radius-radius)<1e-6 and math.dist([f.Surface.Center.x,f.Surface.Center.y],[cx,cy])<1e-6 and abs(f.BoundBox.ZMin)<1e-6 and abs(f.BoundBox.ZMax-height)<1e-6]
    if not cylinder:raise ValueError('Through hole cylindrical face missing')
    for z in [height*.1,height*.5,height*.9]:
        if shape.isInside(App.Vector(cx,cy,z),1e-7,True):raise ValueError('Hole is not through')
        if not shape.isInside(App.Vector((cx+radius+length)/2,cy,z),1e-7,True):raise ValueError('Material outside hole missing')
    return dict(throughHole=dict(center=[cx,cy],diameter=2*circle.Radius,through=True))
