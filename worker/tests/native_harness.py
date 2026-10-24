"""Test harness uses the bundled Python; never imports CAD into the host interpreter."""
import json,os,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def runtime():
    configured=os.environ.get('FREECAD_RUNTIME_ROOT')
    if configured is not None:return Path(configured)
    try:return Path(json.loads((ROOT/'runtime.local.json').read_text())['freecadRuntimeRoot'])
    except (OSError,ValueError,KeyError,TypeError) as exc:raise RuntimeError('Configure FREECAD_RUNTIME_ROOT or runtime.local.json with the verified native runtime') from exc
def native(script,*args,timeout=30):
    root=runtime();env=dict(os.environ)
    for k in ('PYTHONHOME','PYTHONPATH','LD_LIBRARY_PATH','DISPLAY','WAYLAND_DISPLAY'):env.pop(k,None)
    env['PYTHONDONTWRITEBYTECODE']='1'
    code='import sys;sys.path[:0]='+repr([str(root/'usr/lib'),str(ROOT)])+';'+script
    p=subprocess.run([str(root/'usr/bin/python'),'-c',code,*map(str,args)],cwd=ROOT,env=env,text=True,capture_output=True,timeout=timeout)
    if p.returncode:raise AssertionError(f'Native exit {p.returncode}\n{p.stdout}\n{p.stderr}')
    return p
