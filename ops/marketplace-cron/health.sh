#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_root="${repo_root}/.runtime/marketplace"
mkdir -p "${runtime_root}/locks" "${runtime_root}/logs"

node_bin="${BNBERA_NODE_BIN:-}"
pnpm_bin="${BNBERA_PNPM_BIN:-}"
if [[ -z "${node_bin}" ]]; then node_bin="$(command -v node || true)"; fi
if [[ -z "${pnpm_bin}" ]]; then pnpm_bin="$(command -v pnpm || true)"; fi
if [[ -z "${node_bin}" || -z "${pnpm_bin}" ]]; then
  printf '%s\n' '{"errorCode":"MARKETPLACE_RUNTIME_BIN_MISSING"}' >&2
  exit 1
fi

cd "${repo_root}"
exec /usr/bin/flock -n "${runtime_root}/locks/health.lock" \
  /usr/bin/timeout --kill-after=10s 50s \
  env ERC8004_INGESTION_ENABLED=true ERC8004SCAN_DISCOVERY_ENABLED=false \
    "${node_bin}" scripts/run-with-repo-env.mjs -- "${pnpm_bin}" ops:marketplace-health \
    >> "${runtime_root}/logs/health.log" 2>&1
