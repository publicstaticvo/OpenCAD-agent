#!/usr/bin/env bash
set -euo pipefail
npm run typecheck
npm run test:unit
npm run test:cad
echo 'Task 6: real supervised kill/hang/cancel/restart and formal revision protection passed'
