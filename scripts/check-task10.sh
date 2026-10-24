#!/usr/bin/env bash
set -euo pipefail
npm run typecheck
npm run test:unit
npm run test:cad
npm run test:e2e
echo 'Task 10: chat/property/cancel/CAS/download native reopen, real browser and complete deterministic suite passed; fake provider only'
