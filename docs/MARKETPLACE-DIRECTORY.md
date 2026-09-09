# Registered marketplace directory

Implemented 2026-09-09 for the bounded mainnet/testnet marketplace review. This is a read-only-chain discovery surface, not acceptance of a payment, Creator or Greenfield gate.

## Why the old marketplace showed zero

The retained database contained 2,211 identities on chain 97 and no mainnet identities. The existing ingestion runner defaulted to the configured testnet and a 20-candidate batch. Its publication-oriented projection omitted 2,174 identities without a complete executable metadata/capability projection; the remaining 37 were excluded by its callable-service gate. An unknown/stale probe was presented under the same `ENDPOINT_UNHEALTHY` reason as a recent failed probe. Those counts were not a measurement of all ERC-8004 registrations on BSC.

The authenticated 8004scan directory reported more than 310,000 mainnet registrations during this review. Our 100-profile collection is a bounded sample, never the chain-wide total. The collection uses sorted pages across overall score, quality, activity and recent registration, deduplicated by full identity, plus the explicitly requested mainnet reference 341628 and retained testnet references 2206/2283.

## Independent facts

- **Registered:** owner and identity were read at a finalized BSC block. The full `(namespace, chainId, identityRegistry, agentId)` tuple is retained.
- **Enriched:** a small allowlist of attributed 8004scan fields, optionally resolved registration JSON, advertised services/skills and public feedback. Vendor descriptions are claims, not tested capabilities.
- **Card reachable:** a bounded read-only Agent Card JSON fetch succeeded at its displayed observation time. This is not an invocation, uptime percentage or successful task.
- **Hire-eligible:** requires the existing independent execution, quote, authority and payment acceptance checks. No directory observation enables this gate. Current directory Hire controls remain disabled.

8004scan overall/dimension scores are labelled vendor scores out of 100. Permissionless feedback is separate from BNBEra reviews bound to canonical settled jobs; it is not converted to buyer-review stars. Missing values remain unknown. `ENDPOINT_UNVERIFIED`, `ENDPOINT_STALE` and `ENDPOINT_UNHEALTHY` now distinguish the execution gate's observation states.

## Safe local operation

Use Node 22 and the retained environment through `scripts/run-with-repo-env.mjs`. Never print the environment. The reviewed worktree uses a mode-0600, gitignored exact copy of the retained `.env`; browser-public WalletConnect configuration is separately in gitignored `apps/web/.env.local`.

```sh
# One bounded refresh; existing membership is reused, never expanded beyond 100.
MARKETPLACE_DIRECTORY_SYNC_ENABLED=true \
  node scripts/run-with-repo-env.mjs -- pnpm ops:marketplace-directory

# Crash/retry continuation: only members without a completed snapshot.
MARKETPLACE_DIRECTORY_SYNC_ENABLED=true MARKETPLACE_DIRECTORY_ONLY_MISSING=true \
  node scripts/run-with-repo-env.mjs -- pnpm ops:marketplace-directory

# Serve the built app with the registered-directory reader.
NODE_ENV=production MARKETPLACE_DATA_MODE=live MARKETPLACE_API_URL=/api \
  MARKETPLACE_DIRECTORY_ENABLED=true MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED=false \
  ERC8183_BROWSER_BUYER_ENABLED=false \
  GREENFIELD_READ_URL_ALLOWLIST=https://gnfd-testnet-sp1.bnbchain.org \
  GREENFIELD_READ_URL_BASE=https://gnfd-testnet-sp1.bnbchain.org/view/ \
  node scripts/run-with-repo-env.mjs -- pnpm --filter @bnbera/web start --port 3022 --hostname 0.0.0.0
```

`MARKETPLACE_DIRECTORY_LIMIT` is bounded to 100 (default 100). The initial allocation is 80% mainnet/20% testnet. No cron was installed: invoke another bounded refresh explicitly when needed. The normal refresh refreshes existing members; missing-only mode is a no-op after success. A PostgreSQL advisory lock prevents concurrent syncs. Source membership survives a crash before metadata completion. Per-profile writes are transactional and idempotent by digest. Existing versions are reused; new metadata-only versions have no invented executable capabilities and do not change a published current-version pointer.

Read projection returns at most 100 valid, finalized, identity-bound profiles and respects delisted/suspended/rejected states. Page/API reads coalesce for 15 seconds and read commerce projections in batches of eight. Browser result pagination shows 20 at a time, with explicit Load more. Filters apply to the whole selected collection.

## Wallet and AI

Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` before building the web app. The shared provider wraps the global shell and supports BSC mainnet/testnet. Its browser storage is not initialized during server rendering. Connecting is not SIWE authentication or payment approval. The QR chooser can be tested without signing or sending transactions.

`CHEAPERINFERENCE_API_KEY` (or the retained legacy spelling `CHEAPERINFERECE_KEY`) enables the read-only profile assistant. The key stays server-side. The route calls only the fixed CheaperInference endpoint/model, passes allowlisted public profile evidence, uses no tools, caps input at 4 KiB/600 question characters and output at 500 tokens, and limits concurrency to two and requests to 100 per process per UTC day. Missing configuration produces an explicit unavailable response. This in-memory preview budget is not a distributed production quota. No bulk generative summaries or inferred uptime are persisted.

Non-thinking generation is explicit so the bounded answer budget is not consumed by hidden reasoning. The parameter follows the [official DeepSeek thinking-mode contract](https://api-docs.deepseek.com/guides/thinking_mode/) and was independently accepted by the configured gateway with a nonempty answer and zero reasoning tokens. Provider failures remain explicit, with no fabricated fallback answer or automatic paid retry.

Detail pages also retain existing identity-bound Greenfield profile/run artifacts, including historical-version labels and verified-readback links. These are loaded only on an opened detail and do not gate the directory. The retained testnet 2206 profile exposes its existing confirmed settled hire and 5/5 verified buyer review; no new hire was performed for this review.

## Retained-data audit

The completed collection has 80 mainnet and 20 testnet profiles. Of those, 78 registration documents resolved, 28 card fetches passed, five failed and 67 were not probed because no A2A card was advertised. Fifty-two profiles have fetched public feedback entries. All 100 have allowlisted vendor enrichment plus a finalized registry identity read.

Six initial failures were recovered by a missing-only rerun: two vendor rate limits and four valid inline JSON registrations rejected by a legacy 2,048-character web-URL bound. Inline data URIs now have a separate 1.5-million-character ceiling and still pass the resolver's decoded-byte, JSON-depth/key-count and safety bounds. HTTPS/IPFS URL lengths remain bounded. The following missing-only restart enriched zero profiles and left membership at 100.

No migration or deletion was required. Retained totals after the sync: 2,292 identities/agents, 171 versions and 101 directory observations (one repeated initial smoke observation retained as history). The pre-change custom-format PostgreSQL backup is local under `.runtime/mainnet-directory-review/before-directory.dump`.

## Disable and rollback

Stop only the target preview process, unset/set `MARKETPLACE_DIRECTORY_ENABLED=false`, then restart using the previous read surface. `MARKETPLACE_DIRECTORY_SYNC_ENABLED=false` prevents the bounded sync. Existing observations remain retained and inert when the directory flag is off. No database rollback is needed to disable the feature. Do not restore the backup over the retained database or delete observations without a separately reviewed recovery decision. Keep the existing Cloudflare tunnel process and retained runtime intact.
