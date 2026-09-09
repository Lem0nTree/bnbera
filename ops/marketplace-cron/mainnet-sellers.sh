#!/usr/bin/env bash
# Dormant until installed by the release coordinator. No quotes or paid calls.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${repo_root}"
# Load the operator-owned shell environment so DATABASE_URL interpolation is
# resolved before Node starts. Never enable shell tracing for this wrapper.
set -a
source "${BNBERA_ENV_FILE:-.env}"
set +a
mkdir -p .runtime/marketplace/locks .runtime/marketplace/logs
exec /usr/bin/flock -n .runtime/marketplace/locks/mainnet-sellers.lock \
  /usr/bin/timeout --kill-after=10s 110s \
  env EXTERNAL_ERC8183_MAINNET_ENABLED=true MAINNET_SELLER_SYNC_ENABLED=true MAINNET_SELLER_REFRESH_ONLY=true \
  node scripts/run-with-repo-env.mjs -- pnpm exec tsx scripts/marketplace-mainnet-release-sync.ts \
  >> .runtime/marketplace/logs/mainnet-sellers.log 2>&1
