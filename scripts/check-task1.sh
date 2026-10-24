#!/usr/bin/env bash
set -euo pipefail
npm run typecheck
npm run test:unit
python -m unittest discover -s worker/tests -p test_contracts.py -v
echo 'Task 1: shared strict fixtures pass in TypeScript and Python'
