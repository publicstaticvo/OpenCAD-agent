#!/usr/bin/env bash
set -euo pipefail
npm run typecheck
npm run test:unit
npm run test:cad
echo 'Task 8: actual Pi loop, raw guards, cancellation, budgets and deterministic native commits passed; fake only'
