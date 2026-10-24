import os
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]

class DoctorTests(unittest.TestCase):
    def test_missing_runtime_fails_with_actionable_error(self):
        env = dict(os.environ, FREECAD_RUNTIME_ROOT='/not/a/runtime')
        p = subprocess.run([sys.executable, 'scripts/doctor.py'], cwd=ROOT, env=env, capture_output=True, text=True)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('FREECAD_RUNTIME_ROOT', p.stderr)

    def test_real_runtime_reports_verified_versions_and_uds(self):
        p = subprocess.run([sys.executable, 'scripts/doctor.py'], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn('1.1.3', p.stdout)
        self.assertIn('7.8.1', p.stdout)
        self.assertIn('"uds": true', p.stdout)

        self.assertIn('\"flock\": true', p.stdout)
