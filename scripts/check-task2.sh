#!/usr/bin/env bash
set -euo pipefail
npm run typecheck
npm run test:unit
python -m unittest discover -s worker/tests -v
echo 'Task 2: actual native UDS lifecycle and complete baseline passed'
