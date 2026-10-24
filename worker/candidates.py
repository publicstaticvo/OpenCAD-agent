"""Worker-local candidate session; formal revisions are never passed here for writing."""
import json
from pathlib import Path
import FreeCAD as App
from worker.contracts import assert_contract
from worker.model_ops import apply_operations,inspect_document

class Candidates:
    def __init__(self, workspace):
        self.workspace=Path(workspace).resolve()
        self.doc=None
        self.envelope=None
        self.directory=None
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
        if method=='apply_operations':
            self.keys(params,{'envelope','stepId','operations'})
            self.check_envelope(params['envelope'])
            return apply_operations(self.doc,params['operations'],self.envelope['operationId'],params['stepId'])
        if method=='discard_candidate':
            self.keys(params,{'envelope'});self.check_envelope(params['envelope'])
            App.closeDocument(self.doc.Name);self.doc=None;self.envelope=None;self.directory=None
            return dict(discarded=True)
        raise LookupError('Method not found')
    def check_envelope(self,envelope):
        assert_contract('envelope',envelope)
        if not self.doc or self.envelope!=envelope:raise ValueError('Candidate envelope mismatch')
    @staticmethod
    def keys(params,allowed):
        if type(params) is not dict or set(params)!=allowed:raise ValueError('Invalid method parameters')
