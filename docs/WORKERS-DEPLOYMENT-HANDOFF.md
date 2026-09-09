# Cloudflare Workers production handoff — 2026-09-09

Status: configuration prepared, not deployed. Root's read-only Wrangler check found no authenticated account, named-tunnel credentials or Cloudflare environment credentials. Do not claim DNS/TLS acceptance until authenticated deployment and public checks complete. No secret belongs in Git, logs, this document or browser assets.

## Accepted architecture to validate

Use the small edge-only Worker in `deploy/cloudflare/` in front of a stable HTTPS origin backed by a named Cloudflare Tunnel, Cloudflare Access service-token policy, and the existing supervised Node application and retained PostgreSQL database. Do not point it at a quick tunnel. The origin must reject direct unauthenticated requests. Configure its reverse proxy to send `Host: bnbera.ritarda.to` and `X-Forwarded-Proto: https` to Next; set server/browser `APP_URL` to the same public origin. Test SIWE audience, CSRF, host-only secure cookies, WalletConnect metadata and redirects end to end.

The template has no database credentials. It fails closed without a stable HTTPS origin plus Access credentials, replaces spoofable proxy/Access request headers, disables caching, preserves request/response streams and cookies, and rewrites same-origin redirects back to the public host. Authentication to the origin is performed by Access, not by trusting a public `CF-Worker` header. Access secrets must be installed with Wrangler secret management by the authenticated operator. Replace only the placeholder upstream hostname; do not place credentials in that URL. The placeholder configuration is deliberately not deployment acceptance.

Cloudflare documents [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) and [Worker fetch forwarding](https://developers.cloudflare.com/workers/runtime-apis/fetch/). Preserve the current deployed version, origin process/build and DNS record values before deploying; roll back the Worker version and previous DNS routing if public acceptance fails. Do not delete retained database or older build/evidence directories.

## Why not directly migrate this release to OpenNext

Dynamic Next routes can run on Workers through an adapter, and `pg` is supported with Hyperdrive and Node compatibility. This does **not** establish this application's compatibility. Current code opens process-level PostgreSQL pools, reads the standards lock from the filesystem, uses Node DNS/HTTPS transport for SSRF-bounded external service calls, and relies on independent bounded cron jobs. A direct migration needs a packaged immutable standards lock, reviewed driver/pooling changes, explicit network-policy equivalence, durable cron execution and a full auth/payment/restart suite under `workerd`. No such acceptance has been performed, and no database migration or replacement platform is justified for this release.

Primary references: [Cloudflare Next/OpenNext adapter](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/), [node-postgres with Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/), [PostgreSQL setup](https://developers.cloudflare.com/workers/tutorials/postgres/). Current framework recommendations can change; pin and test the selected adapter rather than assuming compatibility from a Node build.

## Operator acceptance

1. Authenticate the intended Cloudflare account/zone; inspect existing records without changing unrelated hostnames. Preserve rollback identifiers privately.
2. Create or reuse a named tunnel/stable origin and Access service-token policy. Require TLS and deny direct public bypass. Keep PostgreSQL private.
3. Install `ORIGIN_ACCESS_CLIENT_ID` and `ORIGIN_ACCESS_CLIENT_SECRET` as Worker secrets; configure `UPSTREAM_ORIGIN`; deploy the provided config only after the upstream health/auth checks pass.
4. Confirm DNS, certificate hostname/chain, HTTP-to-HTTPS behavior, homepage, marketplace, ten seller profiles, wallet login/logout, CSRF denial, My Hires and safe failed-origin behavior. No operator mainnet spend is authorized.
5. Run bounded seller health refresh about once per minute using `bash ops/marketplace-cron/mainnet-sellers.sh`; this dormant wrapper is not installed into cron by this handoff. It uses a local process lock, the script's PostgreSQL advisory lock, and a 110-second timeout. It reads finalized identities and cards, never negotiates, notifies or invokes paid work. Observe the two-minute service expiry instead of inventing uptime. Disabling/removing only this schedule leaves retained data intact; it does not replace the independent new-hire release flag.
6. Keep user transactions explicit browser-wallet operations and test unknown-outcome recovery without resend. Record any unavailable Cloudflare or real-wallet acceptance gate honestly.
