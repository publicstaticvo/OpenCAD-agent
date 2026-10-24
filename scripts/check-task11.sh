#!/usr/bin/env bash
set -euo pipefail
npm run verify:pi
npm run doctor
npm run typecheck
npm run test:unit
npm run test:cad
npm run test:e2e
out=".superpowers/sdd/2026-10-24-text-to-cad/offline-check-$(date +%s)"
CAD_EVAL_OUTPUT="$out" npm run test:eval -- evals/text-to-cad/v1.json
if env -u RUN_LIVE_CAD -u CAD_EVAL_API_KEY -u CAD_EVAL_APPROVAL npm run test:live -- evals/text-to-cad/v1.json; then
 echo 'ERROR: unauthorized live gate unexpectedly passed'; exit 1
fi
echo 'Task 11 preparation: deterministic suite and offline harness passed; live intentionally not authorized or executed'
