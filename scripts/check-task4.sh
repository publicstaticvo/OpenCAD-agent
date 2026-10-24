#!/usr/bin/env bash
set -euo pipefail
npm run typecheck
npm run test:unit
npm run test:cad
echo 'Task 4: independent native FCStd/STEP/GLB verification and sealed package passed'
