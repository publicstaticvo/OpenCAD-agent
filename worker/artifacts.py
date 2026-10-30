"""Save, independently reopen and verify a complete candidate package. No HEAD writes."""
import math
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import threading
import FreeCAD as App
from worker.validation import validate_document,shape_metrics,compare
from worker.model_ops import bodies,inspect_document

FILES=('model.FCStd','model.step','preview.glb','tree.json','validation.json','criteria.json')

def write_json(path,value):
    with path.open('w') as file:
        json.dump(value,file,sort_keys=True,allow_nan=False)
        file.flush();os.fsync(file.fileno())

def glb_metrics(path,shape):
    raw=path.read_bytes()
    if len(raw)<20 or struct.unpack_from('<4sII',raw)!=(b'glTF',2,len(raw)):raise ValueError('Invalid GLB header')
    size,kind=struct.unpack_from('<II',raw,12)
    if kind!=0x4e4f534a or 20+size>len(raw):raise ValueError('Invalid GLB JSON chunk')
    data=json.loads(raw[20:20+size])
    primitives=[p for mesh in data.get('meshes',[]) for p in mesh.get('primitives',[])]
    if not primitives:raise ValueError('Missing GLB mesh')
    accessors=data['accessors'];triangles=0;positions=[]
    end=20+size
    if end+8>len(raw):raise ValueError('Missing GLB binary chunk')
    binary_size,binary_kind=struct.unpack_from('<II',raw,end)
    if binary_kind!=0x004e4942 or end+8+binary_size!=len(raw):raise ValueError('Invalid GLB binary chunk')
    binary=raw[end+8:]
    def values(accessor,expected_type):
        a=accessors[accessor]
        if a['type']!=expected_type or a.get('sparse'):raise ValueError('Unsupported GLB accessor')
        view=data['bufferViews'][a['bufferView']]
        if view.get('buffer',0)!=0:raise ValueError('External GLB buffer rejected')
        count=a['count'];width=3 if expected_type=='VEC3' else 1
        formats={5126:('f',4),5125:('I',4),5123:('H',2),5121:('B',1)}
        if a['componentType'] not in formats:raise ValueError('Unsupported GLB component')
        fmt,bytes_per=formats[a['componentType']];stride=view.get('byteStride',width*bytes_per)
        start=view.get('byteOffset',0)+a.get('byteOffset',0)
        limit=view.get('byteOffset',0)+view['byteLength']
        if count<=0 or stride<width*bytes_per or start<0 or start+(count-1)*stride+width*bytes_per>min(limit,len(binary)):raise ValueError('GLB buffer bounds error')
        return [struct.unpack_from('<'+fmt*width,binary,start+i*stride) for i in range(count)]
    # Native exporter emits the verified CAD mm/Z-up -> m/Y-up coordinates.
    for p in primitives:
        a=accessors[p['attributes']['POSITION']]
        if a['count']<=0 or p.get('mode',4)!=4:raise ValueError('Missing GLB triangles')
        vertices=values(p['attributes']['POSITION'],'VEC3')
        if a['componentType']!=5126 or any(not math.isfinite(v) for row in vertices for v in row):raise ValueError('Invalid GLB vertex')
        actual_low=[min(v[i] for v in vertices) for i in range(3)];actual_high=[max(v[i] for v in vertices) for i in range(3)]
        if any(abs(x-y)>1e-7 for x,y in zip(actual_low+actual_high,a['min']+a['max'])):raise ValueError('GLB accessor bounds mismatch')
        if 'indices' in p:
            index_accessor=accessors[p['indices']]
            if index_accessor['componentType']==5126:raise ValueError('Non-integer GLB index')
            indices=[v[0] for v in values(p['indices'],'SCALAR')]
            if any(i>=len(vertices) for i in indices):raise ValueError('GLB index out of bounds')
            count=len(indices)
        else:count=len(vertices)
        if count<3 or count%3:raise ValueError('Invalid triangle index count')
        triangles+=count//3;positions.append(a)
    low=[min(a['min'][i] for a in positions) for i in range(3)]
    high=[max(a['max'][i] for a in positions) for i in range(3)]
    b=shape.BoundBox
    want_low=[b.XMin/1000,b.ZMin/1000,-b.YMax/1000]
    want_high=[b.XMax/1000,b.ZMax/1000,-b.YMin/1000]
    if any(abs(a-b)>0.0001+1e-7 for a,b in zip(low+high,want_low+want_high)):raise ValueError('GLB axis/scale mismatch')
    return dict(triangles=triangles,bounds=[low,high],mapping='(x,z,-y)/1000',meshes=len(data['meshes']))

def verify_saved(directory,progress=lambda stage,status: None):
    directory=Path(directory)
    criteria=json.loads((directory/'criteria.json').read_text())
    progress('reopen','start')
    design=json.loads((directory/'design.json').read_text()) if (directory/'design.json').exists() else None
    if design and design.get('kind') in ('pin_plate_assembly','edit_pin_plate_assembly'):
        from worker.assembly import validate_assembly,export_assembly
        doc=App.openDocument(str(directory/'model.FCStd'))
        if doc is None:raise ValueError('Invalid assembly FCStd')
        try:
            validation=validate_assembly(doc,criteria,design)
            progress('reopen','complete')
            exported=export_assembly(doc,directory,progress)
            validation.update(step=exported['step'],glb=exported['glb'],verifierPid=os.getpid(),meshFeatureId='Assembly')
            write_json(directory/'tree.json',inspect_document(doc));write_json(directory/'validation.json',validation)
            return validation
        finally:App.closeDocument(doc.Name)
    doc=App.openDocument(str(directory/'model.FCStd'))
    if doc is None:raise ValueError('Invalid FCStd')
    imported=None
    try:
        validation=validate_document(doc,criteria)
        if (directory/'design.json').exists():
            from worker.validation import validate_design
            validation.update(validate_design(doc,json.loads((directory/'design.json').read_text())))
        progress('reopen','complete')
        tree=inspect_document(doc)
        body=bodies(doc)[0]
        import Import
        progress('export_step','start')
        Import.export([body],str(directory/'model.step'))
        imported=App.newDocument('StepCheck')
        Import.insert(str(directory/'model.step'),imported.Name);imported.recompute()
        shapes=[o.Shape for o in imported.Objects if hasattr(o,'Shape') and not o.Shape.isNull() and len(o.Shape.Solids)]
        if len(shapes)!=1:raise ValueError('STEP solid count mismatch')
        step=shape_metrics(shapes[0]);compare(step,criteria)
        progress('export_step','complete')
        progress('export_glb','start')
        body.Shape.tessellate(0.1)
        Import.export([body],str(directory/'preview.glb'))
        validation.update(step=step,glb=glb_metrics(directory/'preview.glb',body.Tip.Shape),verifierPid=os.getpid(),meshFeatureId=body.CadFeatureId)
        progress('export_glb','complete')
        write_json(directory/'tree.json',tree);write_json(directory/'validation.json',validation)
        return validation
    finally:
        if imported:App.closeDocument(imported.Name)
        App.closeDocument(doc.Name)

def prepare_revision(doc,directory,criteria,progress=lambda stage,status: None):
    directory=Path(directory)
    (directory/'manifest.json').unlink(missing_ok=True)
    progress('geometry','start')
    design=json.loads((directory/'design.json').read_text()) if (directory/'design.json').exists() else None
    if design and design.get('kind') in ('pin_plate_assembly','edit_pin_plate_assembly'):
        from worker.assembly import validate_assembly
        validate_assembly(doc,criteria,design)
    else:validate_document(doc,criteria)
    progress('geometry','complete')
    write_json(directory/'criteria.json',criteria)
    progress('save','start')
    doc.saveAs(str(directory/'model.FCStd'))
    progress('save','complete')
    # Use the same pinned interpreter, but a fresh native process and document.
    lib=str(Path(App.__file__).resolve().parent)
    root=str(Path(__file__).resolve().parents[1])
    read_fd,write_fd=os.pipe()
    code='import sys,os,json;sys.path[:0]='+repr([lib,root])+';from worker.artifacts import verify_saved;channel=os.fdopen(int(sys.argv[2]),"w");verify_saved(sys.argv[1],lambda stage,status: (channel.write(json.dumps([stage,status])+"\\n"),channel.flush()))'
    progress_errors=[]
    def relay():
        try:
            with os.fdopen(read_fd) as channel:
                for line in channel:
                    stage,status=json.loads(line)
                    progress(stage,status)
        except Exception as exc:
            progress_errors.append(exc)
    reader=threading.Thread(target=relay,daemon=True)
    reader.start()
    process=None
    try:
        process=subprocess.Popen([sys.executable,'-c',code,str(directory),str(write_fd)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(write_fd,))
        os.close(write_fd);write_fd=None
        stdout,stderr=process.communicate()
    except subprocess.TimeoutExpired as exc:raise ValueError('Independent verifier timeout') from exc
    finally:
        if write_fd is not None:os.close(write_fd)
        if process is not None and process.poll() is None:process.kill();process.communicate()
        reader.join(timeout=5)
    if reader.is_alive():raise ValueError('Verifier progress channel did not close')
    if progress_errors:raise progress_errors[0]
    if process.returncode!=0:raise ValueError('Independent verifier failed: '+stderr.decode(errors='replace')[-2000:])
    validation=json.loads((directory/'validation.json').read_text())
    if json.loads((directory/'tree.json').read_text())!=inspect_document(doc):raise ValueError('Saved feature history drift')
    manifest={}
    for name in FILES:
        path=directory/name
        if not path.is_file() or path.is_symlink():raise ValueError('Incomplete candidate package')
        with path.open('rb') as file:os.fsync(file.fileno())
        raw=path.read_bytes();manifest[name]=dict(sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw))
    write_json(directory/'manifest.json',dict(files=manifest))
    fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)
    return dict(manifest=manifest,tree=json.loads((directory/'tree.json').read_text()),validation=validation,verifierPid=validation['verifierPid'])

def verify_package(directory):
    directory=Path(directory)
    files=json.loads((directory/'manifest.json').read_text())['files']
    if set(files)!=set(FILES):raise ValueError('Incomplete manifest')
    for name,entry in files.items():
        path=directory/name
        if path.is_symlink():raise ValueError('Unsafe package')
        raw=path.read_bytes()
        if len(raw)!=entry['bytes'] or hashlib.sha256(raw).hexdigest()!=entry['sha256']:raise ValueError('Artifact hash mismatch')
    return files
