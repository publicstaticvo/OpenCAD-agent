"""Verify approved operations against independently reconstructed native documents."""
import hashlib
import json
import math
import FreeCAD as App
from worker.model_ops import apply_operations,bodies,feature,inspect_document,sketch_snapshot

def history_hash(history):
    return hashlib.sha256(json.dumps(history,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()).hexdigest()

def history(doc):
    body_list=bodies(doc)
    if not body_list:return []
    if len(body_list)!=1 or 'CadOperationHistory' not in body_list[0].PropertiesList:raise ValueError('Verified operation history missing')
    result=json.loads(body_list[0].CadOperationHistory)
    if type(result) is not list or sum(len(batch) for batch in result)>4096:raise ValueError('Operation history exceeds supported size')
    return result

def model_state(doc):
    rows=inspect_document(doc)
    result=dict(tree=rows,sketches=[],features=[],tip=None)
    for row in rows:
        obj=feature(doc,row['id'])
        if obj.TypeId=='Sketcher::SketchObject':
            snapshot=sketch_snapshot(doc,row['id']);snapshot.pop('tree')
            result['sketches'].append(snapshot)
        elif obj.TypeId in ('PartDesign::Pad','PartDesign::Pocket'):
            modes={}
            for key in ('Type','Length2','Offset','TaperAngle','TaperAngle2','AlongSketchNormal','UseCustomVector','Refine'):
                if key in obj.PropertiesList:
                    value=getattr(obj,key);modes[key]=value.Value if hasattr(value,'Value') else value
            result['features'].append(dict(id=row['id'],profile=obj.Profile[0].CadFeatureId,length=obj.Length.Value,reversed=bool(obj.Reversed),midplane=bool(obj.Midplane),modes=modes))
    body_list=bodies(doc)
    if body_list and body_list[0].Tip:result['tip']=body_list[0].Tip.CadFeatureId
    return result

def same(actual,expected):
    if type(actual) in (int,float) and type(expected) in (int,float):return math.isfinite(actual) and abs(actual-expected)<=1e-6
    if isinstance(expected,dict):return isinstance(actual,dict) and actual.keys()==expected.keys() and all(same(actual[k],v) for k,v in expected.items())
    if isinstance(expected,list):return isinstance(actual,list) and len(actual)==len(expected) and all(same(a,b) for a,b in zip(actual,expected))
    return actual==expected

def compare_shapes(actual,expected):
    if actual.isNull() or expected.isNull() or not actual.isValid() or not expected.isValid():raise ValueError('Invalid geometry during operation replay')
    tolerance=max(1e-6,expected.Volume*1e-9)
    if actual.cut(expected).Volume>tolerance or expected.cut(actual).Volume>tolerance:raise ValueError('Actual solid differs from approved operation replay')

def verify_plan(doc,plan,completed):
    stages=plan['stages']
    if plan['kind']!='operations' or plan['version']!=2 or not 0<=completed<=len(stages):raise ValueError('Invalid operation plan verification request')
    actual_history=history(doc)
    if len(actual_history)<completed:raise ValueError('Approved operation history incomplete')
    prefix=actual_history[:-completed] if completed else actual_history
    suffix=actual_history[-completed:] if completed else []
    if history_hash(prefix)!=plan['baseHistoryHash'] or suffix!=[s['operations'] for s in stages[:completed]]:raise ValueError('Operation history differs from approved plan or base revision')
    reference=App.newDocument('ApprovedOperationReplay')
    try:
        for index,batch in enumerate(actual_history):apply_operations(reference,batch,'replay',str(index))
        actual=model_state(doc);expected=model_state(reference)
        if not same(actual,expected):raise ValueError('Actual sketches, constraints or features differ from approved operation replay')
        for sketch in actual['sketches']:
            if not sketch['fullyConstrained']:raise ValueError('Approved sketch is not fully constrained')
        if actual['tip']:
            a=feature(doc,actual['tip']);b=feature(reference,expected['tip'])
            if hasattr(a,'Shape') and a.TypeId!='Sketcher::SketchObject':compare_shapes(a.Shape,b.Shape)
        return dict(operationPlanHash=plan['planHash'],completedStages=completed,operationHistoryHash=history_hash(actual_history),operationModel=actual)
    finally:App.closeDocument(reference.Name)

def apply_stage(doc,plan,completed,operations,operation_id,step_id,observe):
    if completed>=len(plan['stages']) or operations!=plan['stages'][completed]['operations']:raise ValueError('Operations differ from approved stage')
    previous=history(doc)
    verify_plan(doc,plan,completed)
    result=apply_operations(doc,operations,operation_id,step_id,observe)
    body=bodies(doc)[0]
    if 'CadOperationHistory' not in body.PropertiesList:body.addProperty('App::PropertyString','CadOperationHistory')
    body.CadOperationHistory=json.dumps(previous+[operations],sort_keys=True,allow_nan=False)
    verify_plan(doc,plan,completed+1)
    return result
