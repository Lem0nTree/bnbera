# Full directory backfill

The full backfill reads 8004scan registrations, including inactive ones, for
chains 56 and 97. Discovery, enrichment and embeddings run independently. It
never invokes agents or writes chain transactions.

Discovery uses `directory-full-v1:56` and `directory-full-v1:97` in
`scan_discovery_checkpoints`: 100 records/page, ascending creation time,
transactional page checkpoints, bounded runs and resume after restart.
The provider now caps shallow offsets at 10,000. The adapter follows its
opaque `next_cursor` with identical filters/order and without an offset. To
resume a legacy checkpoint immediately beyond that window, it rereads the
preceding supported page only to obtain the handoff cursor; candidates from
that page are not ingested twice. Cursor checkpoints never revert to offsets.
The 2026-09-09 live cursor was 239 characters; the existing checkpoint column
supports 256. Longer future cursors fail closed pending a forward schema change.
Live provider totals may change between pages without invalidating the cursor.
Full-page requests have a 60-second timeout within the bounded job deadline.
Completion means this source sweep ended, not that enrichment finished or that
later registrations are included. Use a new explicitly named scope for a
subsequent sweep; never delete checkpoints to restart work.

`bnbera-directory-full-v1` membership separates full-scan records from the old
100-profile sample. The new directory reads both memberships; older releases
continue to show their original sample during backfill. History is preserved.

Enrichment reconciles exact finalized identities, resolves public metadata and
records card reachability separately from execution eligibility. Failures get
backoff. Progress keys include namespace, chain, registry and token ID.

Vectors use the standards-locked provider/model/dimension. Stable public text
and bounded advertised skills determine the digest. Retrieval requires a
matching profile digest, provider, model, model version, schema and dimension;
network and other hard filters apply before ranking. Provider/configuration
failures fall back to keyword search. Never set canary flags in production.

From the accepted checkout with the operator-owned environment:

```sh
export BNBERA_ENV_FILE=/home/ubuntu/bnbera-w0-w1/.env
node scripts/run-with-repo-env.mjs -- pnpm ops:marketplace-directory-status
bash ops/marketplace-cron/full-directory.sh scan
bash ops/marketplace-cron/full-directory.sh enrich
bash ops/marketplace-cron/full-directory.sh vectors
```

Run stages as separate supervised services. Process locks and independent
PostgreSQL advisory locks prevent overlap. On this host the initial services
are `bnbera-directory-scan.service` and `bnbera-directory-enrich.service`.
The embedding stage is `bnbera-directory-vectors.service`.
`systemctl --user stop <service>` stops a stage; `disable` prevents its next
boot/login start. Restart preserves cursors, observations and retry state.

Testnet's initial source sweep completed at 2026-09-09 19:45:30 UTC with 2,363
candidates across 24 pages. Mainnet reported 311,807 candidates. These are
source snapshots, not completed enrichment/vectorization totals. The status
command reports current per-network coverage; mainnet is a multi-day backfill
at the initial enrichment pace.

The provider returned a daily quota of 1,000 requests with HTTP 429 and
`Retry-After: 3600`. The scan readiness check persists that cooldown locally;
changing the configured environment file permits an immediate credential
recheck. The old five-minute discovery cron was replaced by the supervised
scan so it cannot consume quota independently.

Full-mode enrichment uses finalized registry URIs directly, so it does not
require one vendor detail request per agent. Existing attributed vendor scores
are retained with their observation timestamps; new primary-source profiles
show unavailable vendor metrics honestly. This keeps registry enrichment and
vectors progressing during an 8004scan cooldown.

The scan service can load a temporary key from the owner-only file
`~/.config/bnbera/full-scan.env` using systemd `EnvironmentFile`. This overrides
only that worker's credential. After rotating this file, remove only
`.runtime/full-directory/provider-cooldown.json` and restart the scan service
to recheck access immediately; preserve database checkpoints.

Cursor contract review: the live [provider OpenAPI](https://api.8004scan.io/openapi.json)
documents cursor traversal for `created_at` ordering, mutually exclusive
cursor/offset parameters, and a maximum offset of 10,000. A live request at
offset 10,100 returned HTTP 422. The September 4 full-document hashes remain
historical pins; this additive pagination behavior was reviewed separately.
