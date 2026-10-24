#!/usr/bin/env bash
set -euo pipefail
npm run typecheck
npm run test:unit
npm run test:cad
npm run test:e2e -- tests/e2e/viewer.spec.ts
echo 'Task 9: real software-WebGL geometry, full-revision switching, races, missing artifact and socket recovery passed; hardware GPU untested'
