#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${repo_root}"
mkdir -p .runtime/marketplace/locks .runtime/marketplace/logs
exec /usr/bin/flock -n .runtime/marketplace/locks/protocol-services.lock \
  /usr/bin/timeout --kill-after=10s 110s \
  env MARKETPLACE_SERVICE_REFRESH_ENABLED=true \
  node scripts/run-with-repo-env.mjs -- pnpm ops:marketplace-services \
  >> .runtime/marketplace/logs/protocol-services.log 2>&1
