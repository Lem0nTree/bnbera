#!/usr/bin/env bash
set -euo pipefail

# Read-only W0/W1 browser probe. It never saves or loads authenticated state.
# The route list comes from the approved marketplace plan. UI copy for state
# labels is supplied by the integrated web owner so this harness cannot invent
# a listing or API contract.

preview_url="${BNBERA_PREVIEW_URL:-}"
require_state_markers="${BNBERA_REQUIRE_STATE_MARKERS:-1}"
detail_slug="${BNBERA_AGENT_SLUG:-}"

if [[ -z "$preview_url" ]]; then
  echo "[DEFECT] BNBERA_PREVIEW_URL is not set; no browser-visible W0/W1 app is available to verify." >&2
  exit 2
fi

case "$preview_url" in
  http://*|https://*) ;;
  *)
    echo "[FAIL] BNBERA_PREVIEW_URL must be an HTTP(S) URL." >&2
    exit 1
    ;;
esac

if [[ "$preview_url" =~ [[:space:]] || "$preview_url" == *'?'* || "$preview_url" == *'#'* || "$preview_url" == *'@'* ]]; then
  echo "[FAIL] BNBERA_PREVIEW_URL must not contain whitespace, query credentials, fragments, or user-info." >&2
  exit 1
fi

if [[ -n "$detail_slug" && ! "$detail_slug" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "[FAIL] BNBERA_AGENT_SLUG must be a normalized marketplace slug." >&2
  exit 1
fi

if ! command -v agent-browser >/dev/null 2>&1; then
  echo "[LIMITATION] agent-browser is not installed in this sandbox; browser evidence was not produced." >&2
  exit 2
fi

preview_url="${preview_url%/}"
routes=(
  "/marketplace"
  "/marketplace/rebalancing"
  "/marketplace/grid-trading"
  "/marketplace/yield-optimisation"
  "/marketplace/health-factor"
  "/compare"
)

if [[ -n "$detail_slug" ]]; then
  routes+=("/agents/$detail_slug")
else
  echo "[DEFECT] BNBERA_AGENT_SLUG is not set; agent-detail browser evidence is unproven." >&2
fi

if [[ "$require_state_markers" == "1" ]]; then
  routes+=(
    "/marketplace?preview=loading"
    "/marketplace?preview=empty"
    "/marketplace?preview=degraded"
    "/marketplace?preview=error"
  )
fi

declare -a visited_bodies=()
browser_failed=0

cleanup() {
  agent-browser close >/dev/null 2>&1 || true
}
trap cleanup EXIT

for route in "${routes[@]}"; do
  url="$preview_url$route"
  echo "[CHECK] $route"
  if ! agent-browser open "$url" >/dev/null 2>&1; then
    echo "[FAIL] Could not open $route." >&2
    browser_failed=1
    continue
  fi
  if ! agent-browser wait --load networkidle >/dev/null 2>&1; then
    echo "[FAIL] $route did not reach network idle." >&2
    browser_failed=1
    continue
  fi
  body="$(agent-browser eval 'document.body?.innerText ?? ""' 2>/dev/null || true)"
  if [[ -z "$body" ]]; then
    echo "[FAIL] $route rendered no readable body text." >&2
    browser_failed=1
    continue
  fi
  body_lower="${body,,}"
  if [[ "$body_lower" == *"application error"* || "$body_lower" == *"internal server error"* || "$body_lower" == *"unexpected token '<'"* ]]; then
    echo "[FAIL] $route contains an application/HTML error signal." >&2
    browser_failed=1
  fi
  visited_bodies+=("$body")
done

contains_marker() {
  local marker="$1"
  local marker_lower="${marker,,}"
  for body in "${visited_bodies[@]}"; do
    if [[ "${body,,}" == *"$marker_lower"* ]]; then
      return 0
    fi
  done
  return 1
}

declare -a marker_names=(
  "EMPTY:BNBERA_EMPTY_STATE_MARKER"
  "FIXTURE:BNBERA_FIXTURE_STATE_MARKER"
  "LOADING:BNBERA_LOADING_STATE_MARKER"
  "ERROR:BNBERA_ERROR_STATE_MARKER"
  "DEGRADED:BNBERA_DEGRADED_STATE_MARKER"
  "ACTIVATION_UNAVAILABLE:BNBERA_ACTIVATION_UNAVAILABLE_MARKER"
)
state_failed=0
for entry in "${marker_names[@]}"; do
  name="${entry%%:*}"
  variable="${entry#*:}"
  marker="${!variable:-}"
  if [[ -z "$marker" ]]; then
    echo "[DEFECT] $variable is not configured; $name state evidence is unproven." >&2
    state_failed=1
  elif ! contains_marker "$marker"; then
    echo "[FAIL] $name marker was not found in the verified browser routes." >&2
    state_failed=1
  else
    echo "[PASS] $name state marker observed."
  fi
done

if [[ "$require_state_markers" != "1" ]]; then
  state_failed=0
  echo "[WARN] BNBERA_REQUIRE_STATE_MARKERS is not 1; state coverage is advisory only." >&2
fi

if [[ "$browser_failed" -ne 0 ]]; then
  exit 1
fi
if [[ -z "$detail_slug" || "$state_failed" -ne 0 ]]; then
  exit 2
fi

echo "[PASS] W0/W1 public route smoke and configured state markers passed."
