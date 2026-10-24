#!/usr/bin/env bash
set -euo pipefail
npm run typecheck
npm run test:unit
npm run test:cad
echo 'Task 7: authenticated real HTTP/WS, versioned artifacts, replay and restart passed'
