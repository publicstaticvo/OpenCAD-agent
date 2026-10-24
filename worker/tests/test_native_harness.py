import json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import native_harness
class NativeHarnessConfigurationTests(unittest.TestCase):
 def test_environment_configuration_does_not_read_ignored_file(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(native_harness,'ROOT',Path(tmp)),patch.dict(os.environ,{'FREECAD_RUNTIME_ROOT':'/explicit/verified/runtime'}):
   self.assertEqual(native_harness.runtime(),Path('/explicit/verified/runtime'))
 def test_local_fallback_and_missing_configuration_diagnostic(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(native_harness,'ROOT',Path(tmp)),patch.dict(os.environ,{},clear=True):
   with self.assertRaisesRegex(RuntimeError,'FREECAD_RUNTIME_ROOT'):native_harness.runtime()
   Path(tmp,'runtime.local.json').write_text(json.dumps({'freecadRuntimeRoot':'/configured/runtime'}))
   self.assertEqual(native_harness.runtime(),Path('/configured/runtime'))
