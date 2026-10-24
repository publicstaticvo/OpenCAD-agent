"""Verify the actual native runtime and local service capabilities; fail closed."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile

def main():
    config = Path(__file__).resolve().parents[1] / 'runtime.local.json'
    local = json.loads(config.read_text()) if config.exists() else {}
    runtime = Path(os.environ.get('FREECAD_RUNTIME_ROOT', local.get('freecadRuntimeRoot', '')))
    python = runtime / 'usr/bin/python'
    if not runtime.is_absolute() or not python.is_file():
        raise RuntimeError('Set FREECAD_RUNTIME_ROOT to the extracted, pinned FreeCAD runtime')
    env = dict(os.environ)
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_LIBRARY_PATH', 'DISPLAY', 'WAYLAND_DISPLAY'):
        env.pop(key, None)
    env['PYTHONDONTWRITEBYTECODE'] = '1'
    command = [str(python), '-c', 'import sys,json;sys.path.insert(0,sys.argv[1]);import FreeCAD,Part,Sketcher;print(json.dumps({"freecad":".".join(FreeCAD.Version()[:3]),"python":sys.version.split()[0],"occt":Part.OCC_VERSION,"gui":FreeCAD.GuiUp}))', str(runtime / 'usr/lib')]
    info = json.loads(subprocess.check_output(command, env=env, text=True, timeout=15).strip().splitlines()[-1])
    wanted = {'freecad': '1.1.3', 'python': '3.11.14', 'occt': '7.8.1', 'gui': 0}
    if info != wanted:
        raise RuntimeError(f'Runtime drift: expected {wanted}, got {info}')
    with tempfile.TemporaryDirectory(prefix='cad-doctor-') as directory:
        test = Path(directory) / 'write'
        test.write_text('staging writable')
        with socket.socket(socket.AF_UNIX) as sock:
            sock.bind(str(Path(directory) / 'worker.sock'))
    print(json.dumps(dict(info, uds=True, staging=True)))

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Doctor failed: {error}', file=sys.stderr)
        sys.exit(1)
