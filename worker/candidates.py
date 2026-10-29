"""Worker-local candidate session; formal revisions are never passed here for writing."""
import json
import hashlib
from pathlib import Path
import FreeCAD as App
from worker.contracts import assert_contract
from worker.model_ops import apply_operations,inspect_document,sketch_snapshot

class Candidates:
    def __init__(self, workspace):
        self.workspace=Path(workspace).resolve()
        self.doc=None
        self.envelope=None
        self.directory=None
        self.prepared=None
        self.progress=lambda stage,status: None
        self.operation=lambda status,index,operation,step_id: None
    def dispatch(self, method, params):
        if method=='begin_candidate':
            self.keys(params,{'envelope'})
            envelope=params['envelope'];assert_contract('envelope',envelope)
            if self.doc:
                if envelope!=self.envelope:raise ValueError('Another candidate is loaded')
            else:
                directory=self.workspace/envelope['candidateId']
                if directory.is_symlink() or directory.resolve().parent!=self.workspace:raise ValueError('Invalid candidate directory')
                directory.mkdir(mode=0o700,parents=False,exist_ok=True)
                model=directory/'model.FCStd'
                if model.is_symlink():raise ValueError('Invalid candidate model')
                self.doc=App.openDocument(str(model)) if model.exists() else App.newDocument('Candidate')
                self.envelope=dict(envelope);self.directory=directory
            return dict(candidateId=envelope['candidateId'],tree=inspect_document(self.doc))
        if method=='inspect_document':
            self.keys(params,set())
            if not self.doc:return dict(tree=[],loaded=False)
            return dict(tree=inspect_document(self.doc),loaded=True,candidateId=self.envelope['candidateId'])
        if method=='candidate_snapshot':
            self.keys(params,{'envelope','sketchId','includePreview','sequence'});self.check_envelope(params['envelope'])
            if type(params['sequence']) is not int or not 1<=params['sequence']<=256 or type(params['includePreview']) is not bool:raise ValueError('Invalid snapshot identity')
            result=dict(candidateId=self.envelope['candidateId'],tree=inspect_document(self.doc),sketch=sketch_snapshot(self.doc,params['sketchId']))
            body_list=[o for o in self.doc.Objects if o.TypeId=='PartDesign::Body']
            if body_list and body_list[0].Tip and hasattr(body_list[0].Tip,'Shape') and not body_list[0].Tip.Shape.isNull() and body_list[0].Tip.Shape.Solids:
                from worker.validation import shape_metrics
                result['geometry']=shape_metrics(body_list[0].Tip.Shape)
                if params['includePreview']:
                    import Import
                    body_list[0].Shape.tessellate(0.1)
                    path=self.directory/f'candidate-{params["sequence"]}.glb'
                    if path.exists():raise ValueError('Snapshot sequence already exists')
                    Import.export([body_list[0]],str(path))
                    from worker.artifacts import glb_metrics
                    glb_metrics(path,body_list[0].Tip.Shape)
                    result['preview']=dict(file=path.name,bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest())
            return result
        if method=='apply_operations':
            self.keys(params,{'envelope','stepId','operations'})
            self.check_envelope(params['envelope'])
            if self.prepared:raise ValueError('Candidate sealed; no later writes')
            return apply_operations(self.doc,params['operations'],self.envelope['operationId'],params['stepId'],lambda status,index,op:self.operation(status,index,op,params['stepId']))
        if method=='prepare_candidate':
            self.keys(params,{'envelope','criteria','design'} if 'design' in params else {'envelope','criteria'});self.check_envelope(params['envelope'])
            assert_contract('criteria',params['criteria'])
            if self.prepared:
                if params['criteria']!=self.prepared['criteria']:raise ValueError('Candidate sealed with different criteria')
                return self.prepared['result']
            from worker.artifacts import prepare_revision
            if 'design' in params:
                from worker.validation import validate_design
                validate_design(self.doc,params['design'])
                (self.directory/'design.json').write_text(json.dumps(params['design'],allow_nan=False))
            result=prepare_revision(self.doc,self.directory,params['criteria'],self.progress)
            result['candidateId']=self.envelope['candidateId']
            self.prepared=dict(criteria=params['criteria'],result=result)
            return result
        if method=='discard_candidate':
            self.keys(params,{'envelope'});self.check_envelope(params['envelope'])
            App.closeDocument(self.doc.Name);self.doc=None;self.envelope=None;self.directory=None;self.prepared=None
            return dict(discarded=True)
        raise LookupError('Method not found')
    def check_envelope(self,envelope):
        assert_contract('envelope',envelope)
        if not self.doc or self.envelope!=envelope:raise ValueError('Candidate envelope mismatch')
    @staticmethod
    def keys(params,allowed):
        if type(params) is not dict or set(params)!=allowed:raise ValueError('Invalid method parameters')
