#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${repo_root}"
runtime_config="${BNBERA_REFERENCE_RUNTIME_CONFIG:-.runtime/protocol-commerce-review/preview.env}"
[[ -f "${runtime_config}" ]] || exit 0
mkdir -p .runtime/marketplace/locks .runtime/marketplace/logs
exec /usr/bin/flock -n .runtime/marketplace/locks/reference-health.lock \
  /usr/bin/timeout --kill-after=5s 35s \
  env ERC8004_HEALTH_MAX_AGENTS=1 ERC8004_HEALTH_MAX_SERVICES=1 \
    ERC8004_HEALTH_REFERENCE_ONLY=true \
  node --env-file="${runtime_config}" scripts/run-with-repo-env.mjs -- pnpm ops:marketplace-health \
  >> .runtime/marketplace/logs/reference-health.log 2>&1
