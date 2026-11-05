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
        self.progress=lambda stage,status,**details: None
        self.operation=lambda status,index,operation,step_id: None
        self.assembly_design=None
        self.assembly_stage=0
        self.design=None
        self.completed_stages=0
    def dispatch(self, method, params):
        if method=='begin_python':
            self.keys(params,{'envelope'})
            assert_contract('envelope',params['envelope'])
            if self.envelope:raise ValueError('Another candidate is loaded')
            self.envelope=dict(params['envelope']);self.directory=self.workspace/self.envelope['candidateId']
            if self.directory.is_symlink() or self.directory.resolve().parent!=self.workspace:raise ValueError('Invalid candidate directory')
            self.directory.mkdir(mode=0o700,exist_ok=True)
            return dict(candidateId=self.envelope['candidateId'])
        if method=='execute_script':
            if 'source' in params:
                self.keys(params,{'envelope','source','criteria','executionId','seconds'})
                project=dict(files={'script.py':params['source']},directories=[],entrypoint='script.py')
                params={**{key:value for key,value in params.items() if key!='source'},'projectJson':json.dumps(project,separators=(',',':')),'sourceHash':hashlib.sha256(params['source'].encode()).hexdigest()}
            self.keys(params,{'envelope','projectJson','sourceHash','criteria','executionId','seconds'})
            if self.envelope!=params['envelope'] or self.prepared:raise ValueError('Python candidate identity or state mismatch')
            if params['criteria'] is not None:assert_contract('criteria',params['criteria'])
            import uuid,shutil
            execution_id=str(uuid.UUID(params['executionId']))
            if execution_id!=params['executionId']:raise ValueError('Invalid execution identity')
            if not isinstance(params['projectJson'],str) or len(params['projectJson'].encode())>8*1024*1024:raise ValueError('Invalid project snapshot size')
            project=json.loads(params['projectJson'])
            legacy=project.get('entrypoint')=='script.py' and project.get('directories')==[] and list(project.get('files',{}))==['script.py'] and not project.get('assets')
            source_hash=hashlib.sha256(project['files']['script.py'].encode()).hexdigest() if legacy else hashlib.sha256(params['projectJson'].encode()).hexdigest()
            if source_hash!=params['sourceHash']:raise ValueError('Project source hash mismatch')
            from worker.python_execution import execute_project
            result=execute_project(self.directory/'executions'/execution_id,project,params['criteria'],params['seconds'],self.directory/'base.FCStd',params['sourceHash'],self.progress)
            if result['status']=='valid':
                directory=self.directory/'executions'/execution_id
                for name in ('model.FCStd','model.step','preview.glb','observation.png','tree.json','validation.json'):
                    shutil.copyfile(directory/name,self.directory/name)
                (self.directory/'project.json').write_text(params['projectJson'])
                (self.directory/'script.py').write_text(project['files'][project['entrypoint']])
                (self.directory/'execution.json').write_text(json.dumps(dict(executionId=execution_id,sourceHash=params['sourceHash'],entrypoint=project['entrypoint'])))
                (self.directory/'scripts.json').write_text('[]')
            return result
        if method=='prepare_python':
            self.keys(params,{'envelope','identity','criteria'})
            if self.envelope!=params['envelope'] or self.prepared:raise ValueError('Python candidate identity or state mismatch')
            from worker.artifacts import write_json
            validation=json.loads((self.directory/'validation.json').read_text());validation.update(params['identity'])
            if params['identity'].get('sourceVersionId'):validation['projectVersion']=1
            write_json(self.directory/'validation.json',validation);write_json(self.directory/'criteria.json',params['criteria'])
            files={}
            for name in ('model.FCStd','model.step','preview.glb','tree.json','validation.json','criteria.json','script.py','project.json','execution.json','scripts.json','observation.png'):
                if name=='project.json' and not validation.get('projectVersion'):continue
                path=self.directory/name
                if path.is_symlink() or not path.is_file():raise ValueError('Invalid Python artifact')
                raw=path.read_bytes();files[name]=dict(bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
            write_json(self.directory/'manifest.json',dict(files=files))
            self.prepared=dict(result=dict(validation=validation))
            return dict(validation=validation)
        if method=='begin_candidate':
            self.keys(params,{'envelope','design'} if 'design' in params else {'envelope'})
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
                if 'design' in params:
                    from worker.operation_plan import verify_plan
                    self.design=params['design'];verify_plan(self.doc,self.design,0)
            return dict(candidateId=envelope['candidateId'],tree=inspect_document(self.doc))
        if method=='inspect_document':
            self.keys(params,set())
            if not self.doc:return dict(tree=[],loaded=False)
            result=dict(tree=inspect_document(self.doc),loaded=True,candidateId=self.envelope['candidateId'])
            if self.design:
                from worker.operation_plan import model_state
                result['operationModel']=model_state(self.doc)
            return result
        if method=='candidate_snapshot':
            self.keys(params,{'envelope','sketchId','includePreview','sequence'});self.check_envelope(params['envelope'])
            if type(params['sequence']) is not int or not 1<=params['sequence']<=256 or type(params['includePreview']) is not bool:raise ValueError('Invalid snapshot identity')
            if self.assembly_design:
                from worker.assembly import export_preview,inspect_assembly
                from worker.artifacts import glb_metrics
                path=self.directory/f'candidate-{params["sequence"]}.glb'
                if path.exists():raise ValueError('Snapshot sequence already exists')
                shape=export_preview(self.doc,path);box=shape.BoundBox
                glb_metrics(path,shape)
                result=dict(candidateId=self.envelope['candidateId'],tree=inspect_document(self.doc),geometry=dict(volume=shape.Volume,solids=len(shape.Solids),bbox=[box.XLength,box.YLength,box.ZLength]),preview=dict(file=path.name,bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
                if self.doc.getObject('Assembly'):result['assembly']=inspect_assembly(self.doc)
                return result
            result=dict(candidateId=self.envelope['candidateId'],tree=inspect_document(self.doc),sketch=sketch_snapshot(self.doc,params['sketchId']))
            if self.design:
                from worker.operation_plan import verify_plan
                result.update(verify_plan(self.doc,self.design,self.completed_stages))
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
            if self.design:
                from worker.operation_plan import apply_stage
                result=apply_stage(self.doc,self.design,self.completed_stages,params['operations'],self.envelope['operationId'],params['stepId'],lambda status,index,op:self.operation(status,index,op,params['stepId']))
                self.completed_stages+=1
                return result
            return apply_operations(self.doc,params['operations'],self.envelope['operationId'],params['stepId'],lambda status,index,op:self.operation(status,index,op,params['stepId']))
        if method=='assembly_stage':
            self.keys(params,{'envelope','stage','design'});self.check_envelope(params['envelope'])
            if self.prepared:raise ValueError('Candidate sealed; no later writes')
            from worker.assembly import build_plate,build_pin,edit_pin,assemble,inspect_assembly,validate_plate,validate_pin
            design=params['design']
            self.keys(design,{'length','width','thickness','holeDiameter','pinDiameter','pinLength'})
            import math
            if any(type(value) not in (int,float) or not math.isfinite(value) or value<=0 or value>1000000 for value in design.values()):raise ValueError('Invalid assembly dimensions')
            if design['holeDiameter']>=min(design['length'],design['width']):raise ValueError('Hole exceeds plate')
            if self.assembly_design is not None and self.assembly_design!=design:raise ValueError('Assembly design changed during execution')
            stages=['plate','pin','assemble','check'] if self.envelope['baseRevision']==0 else ['pin_edit','check']
            if self.assembly_stage>=len(stages) or params['stage']!=stages[self.assembly_stage]:raise ValueError('Assembly stage order rejected')
            observe=lambda stage,data:self.progress('assembly',stage,**data)
            result_geometry=None
            if params['stage']=='plate':
                build_plate(self.doc,design['length'],design['width'],design['thickness'],design['holeDiameter'],observe)
                result_geometry=validate_plate(self.doc,design)
            elif params['stage']=='pin':
                build_pin(self.doc,design['pinDiameter'],design['pinLength'],observe)
                result_geometry=validate_pin(self.doc,design)
            elif params['stage']=='pin_edit':
                edit_pin(self.doc,design['pinDiameter'],observe)
                result_geometry=validate_pin(self.doc,design)
            elif params['stage']=='assemble':assemble(self.doc,design['length']/2,design['width']/2,observe);result_geometry=None
            result=dict(tree=inspect_document(self.doc),stage=params['stage'])
            if result_geometry:result['geometry']=result_geometry
            if self.assembly_stage>=2:result['assembly']=inspect_assembly(self.doc)
            self.assembly_design=dict(design);self.assembly_stage+=1
            return result
        if method=='assembly_check':
            self.keys(params,{'envelope','design'});self.check_envelope(params['envelope'])
            required_stage=3 if self.envelope['baseRevision']==0 else 1
            if self.prepared or self.assembly_stage!=required_stage or self.assembly_design!=params['design']:raise ValueError('Assembly is not ready for validation')
            from worker.assembly import inspect_assembly,validate_assembly
            import math
            design=params['design'];report=inspect_assembly(self.doc)
            self.progress('interference','complete',report=report['interference'])
            criteria=dict(bbox=[design['length'],design['width'],max(design['thickness'],design['pinLength'])],volume=design['length']*design['width']*design['thickness']-math.pi*(design['holeDiameter']/2)**2*design['thickness']+math.pi*(design['pinDiameter']/2)**2*design['pinLength'])
            validate_assembly(self.doc,criteria,dict(kind='edit_pin_plate_assembly' if self.envelope['baseRevision'] else 'pin_plate_assembly',assembly=design))
            self.assembly_stage+=1
            return dict(assembly=report)
        if method=='prepare_candidate':
            self.keys(params,{'envelope','criteria','design'} if 'design' in params else {'envelope','criteria'});self.check_envelope(params['envelope'])
            assert_contract('criteria',params['criteria'])
            if self.prepared:
                if params['criteria']!=self.prepared['criteria']:raise ValueError('Candidate sealed with different criteria')
                return self.prepared['result']
            from worker.artifacts import prepare_revision
            if 'design' in params:
                if self.design and (params['design']!=self.design or params['criteria']!=self.design['criteria'] or self.completed_stages!=len(self.design['stages'])):raise ValueError('Approved operation plan incomplete or changed')
                if params['design'].get('kind') in ('pin_plate_assembly','edit_pin_plate_assembly'):
                    from worker.assembly import validate_assembly
                    required_stage=4 if self.envelope['baseRevision']==0 else 2
                    if self.assembly_stage!=required_stage:raise ValueError('Assembly stages incomplete')
                    validate_assembly(self.doc,params['criteria'],params['design'])
                else:
                    from worker.validation import validate_design
                    validate_design(self.doc,params['design'])
                (self.directory/'design.json').write_text(json.dumps(params['design'],allow_nan=False))
            result=prepare_revision(self.doc,self.directory,params['criteria'],self.progress)
            result['candidateId']=self.envelope['candidateId']
            self.prepared=dict(criteria=params['criteria'],result=result)
            return result
        if method=='discard_candidate':
            self.keys(params,{'envelope'});self.check_envelope(params['envelope'])
            App.closeDocument(self.doc.Name);self.doc=None;self.envelope=None;self.directory=None;self.prepared=None;self.assembly_design=None;self.assembly_stage=0;self.design=None;self.completed_stages=0
            return dict(discarded=True)
        raise LookupError('Method not found')
    def check_envelope(self,envelope):
        assert_contract('envelope',envelope)
        if not self.doc or self.envelope!=envelope:raise ValueError('Candidate envelope mismatch')
    @staticmethod
    def keys(params,allowed):
        if type(params) is not dict or set(params)!=allowed:raise ValueError('Invalid method parameters')
