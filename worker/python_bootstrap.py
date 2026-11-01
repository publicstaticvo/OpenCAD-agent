"""Trusted entry point inside Bubblewrap; never receives host credentials."""
import ctypes
import contextlib
import errno
import json
import math
import os
from pathlib import Path
import resource
import sys
import traceback
import zipfile
from xml.etree import ElementTree

sys.path.insert(0, '/runtime/usr/lib')


def restrict_process():
    libc = ctypes.CDLL(None, use_errno=True)
    libc.mount.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_ulong, ctypes.c_char_p]
    for target, size in ((b'/out', b'size=256m,nr_inodes=4096'), (b'/work', b'size=64m,nr_inodes=1024')):
        if libc.mount(None, target, None, 32 | 2 | 4, size) != 0:
            raise OSError(ctypes.get_errno(), 'Cannot limit private filesystem')
    class CapHeader(ctypes.Structure):
        _fields_ = [('version', ctypes.c_uint32), ('pid', ctypes.c_int)]
    class CapData(ctypes.Structure):
        _fields_ = [('effective', ctypes.c_uint32), ('permitted', ctypes.c_uint32), ('inheritable', ctypes.c_uint32)]
    header, capabilities = CapHeader(0x20080522, 0), (CapData * 2)()
    if libc.capset(ctypes.byref(header), ctypes.byref(capabilities)) != 0:
        raise OSError(ctypes.get_errno(), 'Cannot drop setup capabilities')
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_AS, (4 * 1024**3, 4 * 1024**3))
    resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024**2, 64 * 1024**2))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
    resource.setrlimit(resource.RLIMIT_CPU, (300, 300))
    lib = ctypes.CDLL('libseccomp.so.2', use_errno=True)
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    lib.seccomp_load.argtypes = [ctypes.c_void_p]
    lib.seccomp_attr_set.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_uint32]
    lib.seccomp_release.argtypes = [ctypes.c_void_p]
    context = lib.seccomp_init(0x7fff0000)
    if not context:
        raise RuntimeError('seccomp initialization failed')
    for name in ('fork', 'vfork', 'execve', 'execveat', 'socket', 'socketpair',
                 'connect', 'ptrace', 'process_vm_writev', 'mount', 'umount2', 'unshare',
                 'setns', 'bpf', 'userfaultfd', 'io_uring_setup', 'open_by_handle_at'):
        number = lib.seccomp_syscall_resolve_name(name.encode())
        if number >= 0 and lib.seccomp_rule_add(context, 0x00050000 | errno.EPERM, number, 0) != 0:
            raise RuntimeError('seccomp rule failed: ' + name)
    class Comparison(ctypes.Structure):
        _fields_ = [('arg', ctypes.c_uint), ('op', ctypes.c_uint), ('mask', ctypes.c_uint64), ('value', ctypes.c_uint64)]
    lib.seccomp_rule_add_array.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint, ctypes.POINTER(Comparison)]
    # OCCT requires native threads. Reject clone without CLONE_THREAD; clone3 uses
    # an indirect argument structure, so force libc's checked clone fallback.
    comparison = Comparison(0, 7, 0x10000, 0)
    if lib.seccomp_rule_add_array(context, 0x00050000 | errno.EPERM,
                                 lib.seccomp_syscall_resolve_name(b'clone'), 1, ctypes.byref(comparison)) != 0:
        raise RuntimeError('seccomp clone rule failed')
    if lib.seccomp_rule_add(context, 0x00050000 | errno.ENOSYS,
                            lib.seccomp_syscall_resolve_name(b'clone3'), 0) != 0:
        raise RuntimeError('seccomp clone3 rule failed')
    if lib.seccomp_attr_set(context, 4, 1) != 0 or lib.seccomp_load(context) != 0:
        raise RuntimeError('seccomp loading failed')
    lib.seccomp_release(context)


def metrics(shape):
    if shape.isNull() or not shape.isValid() or not shape.Solids or not math.isfinite(shape.Volume) or shape.Volume <= 0:
        raise ValueError('Document has no valid positive-volume solid')
    box = shape.BoundBox
    return dict(solids=len(shape.Solids), volume=shape.Volume,
                bbox=[box.XLength, box.YLength, box.ZLength])


def check_saved_document(path):
    # Persistent Python callbacks would run again during reopen, compromising
    # independent acceptance and the safety of files opened outside this sandbox.
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 4096 or sum(item.file_size for item in entries) > 256 * 1024**2:
            raise ValueError('FCStd archive exceeds validation limits')
        if len([item for item in entries if item.filename == 'Document.xml']) != 1:
            raise ValueError('FCStd requires exactly one Document.xml')
        for item in entries:
            if not item.filename.endswith('.xml'):
                continue
            if item.file_size > 16 * 1024**2:
                raise ValueError('FCStd XML exceeds validation limits')
            document = ElementTree.fromstring(archive.read(item))
            if any('Python' in element.get('type', '') for element in document.iter()):
                raise ValueError('Persistent Python objects are not allowed in deliverable FCStd')


def observe_document(doc):
    rows = []
    for obj in doc.Objects:
        parameters = {}
        for key in obj.PropertiesList:
            value = getattr(obj, key)
            number = value.Value if hasattr(value, 'Value') else value
            if type(number) in (float, int) and math.isfinite(number):
                parameters[key] = number
        if obj.TypeId == 'Sketcher::SketchObject':
            for index, constraint in enumerate(obj.Constraints):
                if constraint.Name and constraint.Type in ('Distance', 'DistanceX', 'DistanceY', 'Diameter', 'Radius', 'Angle'):
                    if constraint.Name in parameters:
                        raise ValueError('Ambiguous parameter name: ' + constraint.Name)
                    parameters[constraint.Name] = obj.getDatum(index).Value
        parent = next((p.Name for p in obj.InList if p.TypeId == 'PartDesign::Body'), None)
        rows.append(dict(id=obj.Name, label=obj.Label, type=obj.TypeId, parent=parent,
                         parameters=parameters, dependencies=[o.Name for o in obj.OutList], state=list(obj.State)))
    return rows


def render(shape, destination):
    vertices, facets = shape.tessellate(0.1)
    projected = [(v.x - v.y, (v.x + v.y) * 0.5 - v.z) for v in vertices]
    low = [min(p[i] for p in projected) for i in range(2)]
    high = [max(p[i] for p in projected) for i in range(2)]
    scale = 560 / max(high[0] - low[0], high[1] - low[1], 1e-9)
    image = Image.new('RGB', (640, 640), '#f2f5f7')
    draw = ImageDraw.Draw(image)
    for triangle in sorted(facets, key=lambda t: sum(vertices[i].x + vertices[i].y + vertices[i].z for i in t)):
        polygon = [(40 + (projected[i][0] - low[0]) * scale,
                    40 + (projected[i][1] - low[1]) * scale) for i in triangle]
        normal = (vertices[triangle[1]] - vertices[triangle[0]]).cross(vertices[triangle[2]] - vertices[triangle[0]])
        shade = int(125 + 65 * abs(normal.z) / max(normal.Length, 1e-9))
        draw.polygon(polygon, fill=(shade - 25, shade, min(255, shade + 20)))
    image.save(destination)


def main():
    global App, Part, Import, Image, ImageDraw
    phase = sys.argv[1]
    restrict_process()
    import FreeCAD as App
    import Part
    import Import
    from PIL import Image, ImageDraw
    if phase == 'execute':
        source = Path('/input/script.py').read_text()
        code = compile(source, 'script.py', 'exec')
        with open('/out/script.stdout.log', 'w') as stdout, open('/out/script.stderr.log', 'w') as stderr:
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                exec(code, {'__name__': '__main__', '__file__': '/input/script.py'})
        documents = list(App.listDocuments().values())
        if len(documents) != 1:
            raise ValueError('Script must leave exactly one output document')
        doc = documents[0]
        doc.recompute()
        doc.saveAs('/out/model.FCStd')
        return
    criteria = json.loads(Path('/input/criteria.json').read_text())
    check_saved_document('/input/model.FCStd')
    doc = App.openDocument('/input/model.FCStd')
    if doc is None:
        raise ValueError('FCStd failed to reopen')
    doc.recompute()
    if any('Invalid' in obj.State or 'Error' in obj.State for obj in doc.Objects):
        raise ValueError('FreeCAD recompute error')
    objects = [o for o in doc.Objects if hasattr(o, 'Shape') and not o.Shape.isNull()
               and o.Shape.Solids and not any(hasattr(p, 'Shape') and not p.Shape.isNull() and p.Shape.Solids for p in o.InList)]
    if not objects:
        raise ValueError('No exportable solids')
    shape = Part.makeCompound([o.Shape for o in objects])
    actual = metrics(shape)
    if any(abs(a - b) > 1e-6 for a, b in zip(actual['bbox'], criteria['bbox'])):
        raise ValueError('Bounding box acceptance mismatch')
    if abs(actual['volume'] - criteria['volume']) > max(1e-6, criteria['volume'] * 1e-9):
        raise ValueError('Volume acceptance mismatch')
    rows = observe_document(doc)
    for parameter in criteria.get('parameters', []):
        value = next((r['parameters'].get(parameter['parameter']) for r in rows if r['id'] == parameter['feature']), None)
        if value is None or abs(value - parameter['value']) > 1e-6:
            raise ValueError('Parameter acceptance mismatch')
    Import.export(objects, '/out/model.step')
    reopened = App.newDocument('StepCheck')
    Import.insert('/out/model.step', reopened.Name)
    reopened.recompute()
    shapes = [o.Shape for o in reopened.Objects if hasattr(o, 'Shape') and not o.Shape.isNull() and o.Shape.Solids]
    exported = Part.makeCompound(shapes)
    step = metrics(exported)
    tolerance = max(1e-6, actual['volume'] * 1e-9)
    if shape.cut(exported).Volume > tolerance or exported.cut(shape).Volume > tolerance:
        raise ValueError('STEP geometry differs from FCStd')
    for obj in objects:
        obj.Shape.tessellate(0.1)
    Import.export(objects, '/out/preview.glb')
    render(shape, '/out/observation.png')
    # The trusted verifier writes a fresh saved document and independent report.
    doc.saveAs('/out/model.FCStd')
    validation = dict(actual, step=step, healthy=True, acceptance=True, reopened=True,
                      python=True, verifierPid=os.getpid(), meshFeatureId=objects[0].Name,
                      bounds=dict(XMin=shape.BoundBox.XMin, XMax=shape.BoundBox.XMax,
                                  YMin=shape.BoundBox.YMin, YMax=shape.BoundBox.YMax,
                                  ZMin=shape.BoundBox.ZMin, ZMax=shape.BoundBox.ZMax))
    Path('/out/tree.json').write_text(json.dumps(rows))
    Path('/out/validation.json').write_text(json.dumps(validation))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        frames = traceback.extract_tb(error.__traceback__)
        position = next((frame for frame in reversed(frames) if frame.filename == 'script.py'), frames[-1])
        record = dict(stage=sys.argv[1], type=type(error).__name__, message=str(error),
                      file=getattr(error, 'filename', None) or position.filename,
                      line=getattr(error, 'lineno', None) or position.lineno, traceback=traceback.format_exc())
        Path('/out/error.json').write_text(json.dumps(record))
        raise
    finally:
        # Only bounded files cross the namespace boundary. The host validates
        # this archive and independently opens CAD output in another sandbox.
        names = ('error.json', 'model.FCStd', 'script.stdout.log', 'script.stderr.log') if sys.argv[1] == 'execute' else (
            'error.json', 'model.FCStd', 'model.step', 'preview.glb', 'observation.png', 'tree.json', 'validation.json')
        with zipfile.ZipFile(sys.stdout.buffer, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for name in names:
                path = Path('/out') / name
                if path.is_file() and not path.is_symlink():
                    archive.write(path, name)
