import unittest
from native_harness import native


class PythonExecutionTests(unittest.TestCase):
    def test_real_execution_observation_and_isolation(self):
        native('''
import tempfile,json
from pathlib import Path
from worker.python_execution import execute_script
with tempfile.TemporaryDirectory(dir=Path.cwd()/'.work') as folder:
    root=Path(folder)
    source="import FreeCAD as App, Part\\ndoc=App.newDocument('Model')\\nobj=doc.addObject('PartDesign::Body','Body')\\nfeature=obj.newObject('PartDesign::AdditiveBox','Box')\\nfeature.Length=40;feature.Width=30;feature.Height=10\\ndoc.recompute()\\n"
    result=execute_script(root/'ok',source+"\\nprint('native stdout evidence')\\n",dict(bbox=[40,30,10],volume=12000),10)
    assert result['status']=='valid',result
    assert (root/'ok'/'preview.glb').stat().st_size>0
    assert (root/'ok'/'observation.png').stat().st_size>0
    assert result['validation']['step']['solids']==1
    assert result['stdout'].strip()=='native stdout evidence',result
    failed=execute_script(root/'bad','raise RuntimeError("failure evidence")',dict(bbox=[40,30,10],volume=12000),10)
    assert failed['status']=='failed' and failed['error']['type']=='RuntimeError',failed
    assert failed['error']['line']==1
    syntax=execute_script(root/'syntax','def broken(:',dict(bbox=[40,30,10],volume=12000),10)
    assert syntax['error']['type']=='SyntaxError' and syntax['error']['line']==1,syntax
    probe=source+"\\nimport os,socket,subprocess\\nassert 'CAD_ACCESS_TOKEN' not in os.environ\\nassert not os.path.exists('/home/lenovo/ai4s/cad-web/data')\\nfor attempt in [lambda:socket.socket(),lambda:subprocess.run(['/usr/bin/true'])]:\\n try:attempt()\\n except PermissionError:pass\\n else:raise AssertionError('sandbox escape')\\n"
    secure=execute_script(root/'secure',probe,dict(bbox=[40,30,10],volume=12000),10)
    assert secure['status']=='valid',secure
    limits=execute_script(root/'limits',source+"\\nimport os\\nassert os.statvfs('/out').f_blocks*os.statvfs('/out').f_frsize<=256*1024**2\\nassert os.statvfs('/work').f_blocks*os.statvfs('/work').f_frsize<=64*1024**2\\nassert int([line.split()[1] for line in open('/proc/self/status') if line.startswith('CapEff:')][0],16)==0\\n",dict(bbox=[40,30,10],volume=12000),10)
    assert limits['status']=='valid',limits
    readonly=execute_script(root/'readonly',source+"\\nopen('/input/base.FCStd','wb').write(b'changed')\\n",dict(bbox=[40,30,10],volume=12000),10,root/'ok'/'model.FCStd')
    assert readonly['status']=='failed' and readonly['error']['type']=='OSError',readonly
    empty=execute_script(root/'empty','import FreeCAD as App; App.newDocument("Empty")',dict(bbox=[1,1,1],volume=1),10)
    assert empty['status']=='failed' and empty['error']['stage']=='verify',empty
    wrong=execute_script(root/'wrong',source,dict(bbox=[40,30,12],volume=14400),10)
    assert wrong['status']=='failed' and 'acceptance' in wrong['error']['message'],wrong
    circle="import FreeCAD as App, Part, Sketcher, math\\ndoc=App.newDocument('Model')\\nbody=doc.addObject('PartDesign::Body','Body')\\nsketch=body.newObject('Sketcher::SketchObject','Sketch')\\nsketch.addGeometry(Part.Circle(App.Vector(0,0,0),App.Vector(0,0,1),3),False)\\nindex=sketch.addConstraint(Sketcher.Constraint('Radius',0,3))\\nsketch.renameConstraint(index,'designRadius')\\npad=body.newObject('PartDesign::Pad','Pad')\\npad.Profile=sketch;pad.Length=10\\npad.addProperty('App::PropertyLength','customLength');pad.customLength=17\\ndoc.recompute()\\n"
    import math
    parametric=execute_script(root/'parametric',circle,dict(bbox=[6,6,10],volume=90*math.pi,parameters=[dict(feature='Sketch',parameter='designRadius',value=3),dict(feature='Pad',parameter='customLength',value=17)]),10)
    assert parametric['status']=='valid',parametric
    thread_source=source+"\\nimport threading\\nevent=threading.Event()\\nthreads=[]\\nlimited=False\\nfor index in range(128):\\n try:\\n  thread=threading.Thread(target=event.wait);thread.start();threads.append(thread)\\n except RuntimeError:\\n  limited=True;break\\nevent.set()\\nfor thread in threads:thread.join()\\nassert limited and len(threads)<64\\n"
    threads=execute_script(root/'threads',thread_source,dict(bbox=[40,30,10],volume=12000),10)
    assert threads['status']=='valid',threads
    callback=execute_script(root/'callback',source+"\\nfeature.addProperty('App::PropertyPythonObject','Payload');feature.Payload={'value':17}\\n",dict(bbox=[40,30,10],volume=12000),10)
    assert callback['status']=='failed' and 'Persistent Python' in callback['error']['message'],callback
    timed=execute_script(root/'timeout','while True: pass',dict(bbox=[1,1,1],volume=1),0.2)
    assert timed['error']['type']=='Timeout',timed
''',timeout=60)
