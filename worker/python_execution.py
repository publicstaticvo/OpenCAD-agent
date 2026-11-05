"""Run untrusted scripts and independent native validation in separate namespaces."""
import json
import base64
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile
import re
from types import SimpleNamespace

from worker.artifacts import glb_metrics, write_json


def _write_project(inputs, project, expected_hash):
    if not isinstance(project, dict) or set(project) not in ({'files', 'directories', 'entrypoint'}, {'files', 'assets', 'directories', 'entrypoint'}):
        raise ValueError('Invalid project snapshot')
    files, assets, directories, entrypoint = project['files'], project.get('assets', {}), project['directories'], project['entrypoint']
    if not isinstance(files, dict) or not isinstance(assets, dict) or not isinstance(directories, list) or len(files) + len(assets) > 256 or len(directories) > 256:
        raise ValueError('Invalid project file tree')
    if not isinstance(entrypoint, str) or not entrypoint or entrypoint not in files or not re.search(r'\.(py|FCMacro)$', entrypoint, re.I):
        raise ValueError('Project entrypoint must select an existing Python source file')
    canonical = json.dumps(project, ensure_ascii=False, separators=(',', ':'))
    legacy = entrypoint == 'script.py' and directories == [] and list(files) == ['script.py'] and not assets
    actual_hash = hashlib.sha256(files['script.py'].encode() if legacy else canonical.encode()).hexdigest()
    if actual_hash != expected_hash:
        raise ValueError('Project source hash mismatch')
    root = inputs / 'project'
    root.mkdir(mode=0o700)
    names = set()
    total = 0
    for name in directories + list(files) + list(assets):
        if not isinstance(name, str) or len(name) > 240 or name.startswith('/') or '\\' in name or any(ord(char) < 32 or ord(char) == 127 for char in name) or any(part in ('', '.', '..') for part in name.split('/')):
            raise ValueError('Invalid project relative path')
        if name in names:
            raise ValueError('Duplicate project path')
        names.add(name)
    for name in list(files) + list(assets):
        parent = Path(name).parent
        while str(parent) != '.':
            if str(parent) in files or str(parent) in assets:
                raise ValueError('Project file and directory collision')
            parent = parent.parent
    for name in directories:
        path = root.joinpath(*name.split('/'))
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name, value in files.items():
        if not isinstance(value, str):
            raise ValueError('Project source files must be UTF-8 text')
        raw = value.encode('utf-8')
        total += len(raw)
        if len(raw) > 1024 * 1024 or total > 4 * 1024 * 1024:
            raise ValueError('Project source size limit exceeded')
        path = root.joinpath(*name.split('/'))
        path.parent.mkdir(mode=0o500, parents=True, exist_ok=True)
        path.write_bytes(raw)
        path.chmod(0o400)
    for name, value in assets.items():
        if not isinstance(value, str):
            raise ValueError('Project assets must be base64 text')
        raw = base64.b64decode(value, validate=True)
        if base64.b64encode(raw).decode() != value or len(raw) > 1024 * 1024:
            raise ValueError('Invalid project asset')
        total += len(raw)
        if total > 4 * 1024 * 1024:
            raise ValueError('Project asset size limit exceeded')
        path = root.joinpath(*name.split('/'))
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        path.write_bytes(raw)
        path.chmod(0o400)
    for path in sorted((value for value in root.rglob('*') if value.is_dir()), key=lambda item: len(item.parts), reverse=True):
        path.chmod(0o500)
    root.chmod(0o500)
    return root


def execute_script(directory, source, criteria, timeout=0, base=None):
    return _execute(directory, source, criteria, timeout, base, None)


def execute_project(directory, project, criteria, timeout=0, base=None, expected_hash=None, progress=None):
    return _execute(directory, '', criteria, timeout, base, project, expected_hash, progress)


def _execute(directory, source, criteria, timeout=0, base=None, project=None, expected_hash=None, progress=None):
    directory = Path(directory)
    directory.mkdir(parents=True, mode=0o700, exist_ok=False)
    inputs = directory / 'input'
    inputs.mkdir()
    if project is None:
        (inputs / 'script.py').write_text(source)
    else:
        _write_project(inputs, project, expected_hash)
        (inputs / 'project.json').write_text(json.dumps(project, ensure_ascii=False, separators=(',', ':')))
    write_json(inputs / 'criteria.json', criteria)
    if base is not None and Path(base).is_file():shutil.copyfile(base,inputs/'base.FCStd')
    runtime = Path(sys.executable).resolve().parents[2]
    bootstrap = Path(__file__).with_name('python_bootstrap.py').resolve()
    for phase in ('execute', 'verify'):
        if progress is not None:progress('python_'+phase, 'start')
        output = directory / phase
        output.mkdir()
        arguments = ['/usr/bin/bwrap', '--unshare-all', '--uid', '0', '--gid', '0', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--cap-add', 'CAP_SYS_ADMIN',
                     '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64',
                     '--ro-bind', '/etc/passwd', '/etc/passwd', '--ro-bind', '/etc/group', '/etc/group',
                     '--ro-bind', str(runtime), '/runtime', '--ro-bind', str(bootstrap), '/bootstrap.py',
                     '--ro-bind', str(inputs), '/input', '--tmpfs', '/out',
                     '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/work', '--chdir', '/work',
                     '--remount-ro', '/', '--remount-ro', '/dev',
                     '--clearenv', '--setenv', 'HOME', '/work', '--setenv', 'OMP_NUM_THREADS', '1',
                     '--setenv', 'PYTHONDONTWRITEBYTECODE', '1', '/runtime/usr/bin/python', '/bootstrap.py', phase]
        with (directory / f'{phase}.stdout.log').open('wb') as stdout, (directory / f'{phase}.stderr.log').open('wb') as stderr:
            process = subprocess.Popen(arguments, stdout=stdout, stderr=stderr)
            write_json(directory / f'{phase}.process.json', dict(pid=process.pid, phase=phase))
            try:
                process.wait(timeout=timeout if timeout > 0 else None)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
                return dict(status='failed', executionStatus='failed' if phase == 'execute' else 'succeeded', healthStatus='not-run' if phase == 'execute' else 'incomplete', acceptanceStatus='not-run', deliveryStatus='not-run', commitEligible=False, validationStatus='not-run' if phase == 'execute' else 'failed', error=dict(stage=phase, type='Timeout', message='Script execution deadline exceeded', line=None), **execution_logs(directory))
        transport = directory / f'{phase}.stdout.log'
        if transport.stat().st_size <= 64 * 1024**2 and zipfile.is_zipfile(transport):
            with zipfile.ZipFile(transport) as archive:
                allowed = {'error.json', 'model.FCStd', 'script.stdout.log', 'script.stderr.log'} if phase == 'execute' else {
                    'error.json', 'model.FCStd', 'model.step', 'preview.glb', 'observation.png', 'tree.json', 'validation.json'}
                entries = archive.infolist()
                if len(entries) > len(allowed) or len({item.filename for item in entries}) != len(entries) or sum(item.file_size for item in entries) > 256 * 1024**2:
                    raise ValueError('Invalid sandbox output archive')
                for item in entries:
                    if item.filename not in allowed or item.file_size > 64 * 1024**2:
                        raise ValueError('Unexpected sandbox output')
                    (output / item.filename).write_bytes(archive.read(item))
        if process.returncode != 0:
            path = output / 'error.json'
            error = json.loads(path.read_text()) if path.is_file() and not path.is_symlink() else dict(
                stage=phase, type='ProcessExit', message=(directory / f'{phase}.stderr.log').read_text(errors='replace')[-4000:], line=None, exitCode=process.returncode)
            return dict(status='failed', executionStatus='failed' if phase == 'execute' else 'succeeded',
                        healthStatus='not-run' if phase == 'execute' else 'passed' if error.get('checkStage') == 'delivery' else 'failed',
                        acceptanceStatus='not-run', deliveryStatus='failed' if error.get('checkStage') == 'delivery' else 'not-run', commitEligible=False,
                        validationStatus='not-run' if phase == 'execute' else 'failed', error=error, **execution_logs(directory))
        if progress is not None:progress('python_'+phase, 'complete')
        if phase == 'execute':
            model = output / 'model.FCStd'
            if not model.is_file() or model.is_symlink() or model.stat().st_size > 64 * 1024**2:
                raise ValueError('Invalid script output file')
            shutil.copyfile(model, inputs / 'model.FCStd')
    for name in ('model.FCStd', 'model.step', 'preview.glb', 'observation.png', 'tree.json', 'validation.json'):
        path = directory / 'verify' / name
        if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= 64 * 1024**2:
            raise ValueError('Invalid verified artifact: ' + name)
        shutil.copyfile(path, directory / name)
    validation = json.loads((directory / 'validation.json').read_text())
    # Existing native GLB checker validates coordinates, triangles and units.
    validation['glb'] = glb_metrics(directory / 'preview.glb', SimpleNamespace(BoundBox=SimpleNamespace(**validation['bounds'])))
    validation['healthStatus'] = 'passed'
    validation['deliveryStatus'] = 'passed'
    write_json(directory / 'validation.json', validation)
    accepted = validation['acceptance']
    acceptable = criteria is None or accepted
    result = dict(status='valid' if acceptable else 'diagnostic', executionStatus='succeeded', healthStatus='passed',
                  acceptanceStatus=validation['acceptanceStatus'], deliveryStatus='passed', commitEligible=accepted,
                  validationStatus='passed' if accepted else validation['acceptanceStatus'], validation=validation,
                  tree=json.loads((directory / 'tree.json').read_text()), **execution_logs(directory))
    if validation['acceptanceErrors']:
        result['error'] = dict(stage='acceptance', type='AcceptanceMismatch', message='; '.join(validation['acceptanceErrors']), line=None)
    return result


def execution_logs(directory):
    result = {}
    for name in ('stdout', 'stderr'):
        path = directory / 'execute' / f'script.{name}.log'
        if path.is_file():
            with path.open('rb') as stream:
                stream.seek(max(0, path.stat().st_size - 16000))
                result[name] = stream.read().decode(errors='replace')
    return result
