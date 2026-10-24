"""Deterministic native acceptance; recompute status alone is never sufficient."""
import math
from worker.contracts import assert_contract
from worker.model_ops import bodies,feature,inspect_document

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
