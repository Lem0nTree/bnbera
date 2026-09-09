#!/bin/bash
set -euo pipefail
umask 077
cd /home/ubuntu/bnbera-ui-light
exec /usr/bin/flock --nonblock .runtime/protocol-commerce-review/reference-service.lock /usr/bin/node --env-file=.runtime/protocol-commerce-review/preview.env scripts/run-with-repo-env.mjs -- /usr/bin/pnpm exec tsx scripts/t5-reference-service.ts
