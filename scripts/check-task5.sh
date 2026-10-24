#!/usr/bin/env bash
set -euo pipefail
npm run typecheck
npm run test:unit
npm run test:cad
echo 'Task 5: native packages, SQLite CAS/idempotency, fault processes and recovery passed'
