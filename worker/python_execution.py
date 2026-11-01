"""Run untrusted scripts and independent native validation in separate namespaces."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile
from types import SimpleNamespace

from worker.artifacts import glb_metrics, write_json


def execute_script(directory, source, criteria, timeout=0, base=None):
    directory = Path(directory)
    directory.mkdir(parents=True, mode=0o700, exist_ok=False)
    inputs = directory / 'input'
    inputs.mkdir()
    (inputs / 'script.py').write_text(source)
    write_json(inputs / 'criteria.json', criteria)
    if base is not None and Path(base).is_file():shutil.copyfile(base,inputs/'base.FCStd')
    runtime = Path(sys.executable).resolve().parents[2]
    bootstrap = Path(__file__).with_name('python_bootstrap.py').resolve()
    for phase in ('execute', 'verify'):
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
                return dict(status='failed', executionStatus='failed' if phase == 'execute' else 'succeeded', validationStatus='not-run' if phase == 'execute' else 'failed', error=dict(stage=phase, type='Timeout', message='Script execution deadline exceeded', line=None))
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
            return dict(status='failed', executionStatus='failed' if phase == 'execute' else 'succeeded', validationStatus='not-run' if phase == 'execute' else 'failed', error=error, **execution_logs(directory))
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
    write_json(directory / 'validation.json', validation)
    return dict(status='valid', executionStatus='succeeded', validationStatus='passed', validation=validation, tree=json.loads((directory / 'tree.json').read_text()), **execution_logs(directory))


def execution_logs(directory):
    result = {}
    for name in ('stdout', 'stderr'):
        path = directory / 'execute' / f'script.{name}.log'
        if path.is_file():
            with path.open('rb') as stream:
                stream.seek(max(0, path.stat().st_size - 16000))
                result[name] = stream.read().decode(errors='replace')
    return result
