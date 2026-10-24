#!/usr/bin/env bash
set -euo pipefail
npm run typecheck
npm run test:unit
npm run test:cad
echo 'Task 3: real parametric plate/ring/step, named edits, strict RPC, replay and negative cases passed'
