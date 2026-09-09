#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"
export MARKETPLACE_DIRECTORY_FULL_SCAN=true
export BNBERA_ENV_FILE="${BNBERA_ENV_FILE:?BNBERA_ENV_FILE is required}"
stage="${1:?stage required}"
mkdir -p .runtime/full-directory
exec 9>".runtime/full-directory/${stage}.lock"
flock -n 9 || exit 0
while true; do
  if [[ "$stage" == scan ]] && ! node scripts/run-with-repo-env.mjs -- node scripts/marketplace-provider-ready.mjs; then
    sleep 60
    continue
  fi
  if [[ "$stage" == scan ]]; then
    for network in 97 56; do
      export ERC8004_SCAN_CHAIN_ID="$network"
      export ERC8004_SCAN_IS_TESTNET=false
      [[ "$network" != 97 ]] || export ERC8004_SCAN_IS_TESTNET=true
      ERC8004_INGESTION_ENABLED=true ERC8004SCAN_DISCOVERY_ENABLED=true \
        ERC8004SCAN_JOB_SCOPE="directory-full-v1:$network" ERC8004SCAN_PAGE_SIZE=100 \
        ERC8004SCAN_MAX_PAGES=100 ERC8004SCAN_MAX_CANDIDATES=10000 ERC8004SCAN_MAX_RUN_MS=600000 \
        node scripts/run-with-repo-env.mjs -- pnpm exec tsx scripts/erc8004scan-ingestion.ts || true
    done
  elif [[ "$stage" == enrich ]]; then
    for network in 97 56; do
      ERC8004_SCAN_CHAIN_ID="$network" MARKETPLACE_DIRECTORY_SYNC_ENABLED=true \
        MARKETPLACE_DIRECTORY_ONLY_MISSING=true MARKETPLACE_DIRECTORY_MAX_REFRESH=30 \
        timeout --kill-after=15s 300s node scripts/run-with-repo-env.mjs -- pnpm exec tsx scripts/marketplace-directory-sync.ts || true
    done
  elif [[ "$stage" == vectors ]]; then
    MARKETPLACE_DIRECTORY_VECTORS_ENABLED=true timeout --kill-after=15s 300s node scripts/run-with-repo-env.mjs -- pnpm exec tsx scripts/marketplace-directory-vectors.ts || true
  else
    exit 2
  fi
  sleep 30
done
