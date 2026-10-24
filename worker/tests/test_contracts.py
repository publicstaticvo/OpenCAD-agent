import json
from pathlib import Path
import sys
import unittest
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from worker.contracts import assert_contract

class ContractTests(unittest.TestCase):
    def test_shared_fixtures(self):
        cases = json.loads((ROOT / 'tests/fixtures/contracts/cases.json').read_text())
        for case in cases:
            with self.subTest(case=case['name']):
                if case['valid']:
                    assert_contract(case['kind'], case['input'])
                else:
                    with self.assertRaises(ValueError):
                        assert_contract(case['kind'], case['input'])

    def test_nonfinite(self):
        for number in (float('nan'), float('inf'), float('-inf')):
            with self.assertRaises(ValueError):
                assert_contract('operation', dict(op='pad', id='p', sketch='s', length=number))
