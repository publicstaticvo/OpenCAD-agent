#!/usr/bin/env bash
set -euo pipefail
npm run verify:pi
npm run typecheck
npm run test:unit
python -m unittest discover -s worker/tests -p test_doctor.py -v
python scripts/doctor.py
python docs/probes/freecad_readiness.py --runtime-root "$(python -c 'import json;print(json.load(open("runtime.local.json"))["freecadRuntimeRoot"])')" --output ".superpowers/sdd/2026-10-24-text-to-cad/baseline-$(date +%s)" > .superpowers/sdd/2026-10-24-text-to-cad/baseline-cad.log
echo 'Task 0: source guard, pinned Node/Pi, doctor, real CAD baseline passed'
