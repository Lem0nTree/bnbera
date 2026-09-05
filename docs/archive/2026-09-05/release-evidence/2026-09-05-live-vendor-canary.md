# 8004scan authenticated live-vendor canary

Date: 2026-09-05  
Checkout: `/home/ubuntu/bnbera-live-vendor`  
Branch: `codex/live-vendor-canary`  
Base/head before this evidence commit: `5affd623c47ed37203911239266a2ae172f4e42d`  
Delivery: W1 Marketplace Data + Web / A3 identity-discovery canary  
Gate: Core Marketplace; vendor discovery remains independently feature-gated  
Risk: R1 stateful application (live provider reads and authorized development-DB enrichment)

## Documentation and contract gate

Read before this report/edit:

- `AGENTS.md`
- `docs/04-bnbera-master-implementation-plan.md`
- `docs/05-subagent-delivery-plan.md`
- `docs/06-erc8004-pipeline-integration-plan.md`
- `docs/07-mvp-live-marketplace-task-plan.md`
- `config/standards.lock.json`
- `docs/01-marketplace-donor-merge-plan.md`
- `docs/adr/0001-altana-studio-custody-bootstrap.md`
- `docs/adr/0003-wave1-legacy-migration-repair.md`
- `packages/agent-ingestion/README.md`
- `packages/agent-ingestion/src/types.ts`
- `packages/agent-ingestion/src/adapters/8004scan.ts`
- `packages/agent-ingestion/src/semantic-discovery.ts`
- `packages/agent-ingestion/src/scan-job.ts`
- `packages/agent-ingestion/src/normalize.ts`
- `packages/agent-ingestion/src/metadata.ts`
- `packages/agent-ingestion/src/ingestion.ts`
- `packages/agent-ingestion/src/composition.ts`
- `packages/agent-ingestion/src/pipeline.ts`
- `packages/agent-ingestion/src/probe.ts`
- `packages/agent-ingestion/src/repository-mapping.ts`
- `packages/domain/src/identity.ts`
- `packages/domain/src/constants.ts`
- `packages/domain/src/states.ts`
- `packages/domain/src/services.ts`
- `packages/domain/src/events.ts`
- `packages/db/src/schema.ts`
- `scripts/erc8004-marketplace-ingestion.ts`

The unresolved lock entries affecting this canary are unchanged: standards lock
status is `candidate`; the BSC 56/97 main-track decision, finality threshold,
ERC-8183/B402 addresses and paid canary, Greenfield provider/SDK, and Altana
addresses remain unresolved or disabled. Semantic embedding release remains
disabled. No finality/publication rule, onchain write, payment, deployment, or
feature-gate default was changed.

## Bounded authenticated provider observations

The API key was loaded server-side from the authorized
`/home/ubuntu/bnbera-w0-w1/.env` file and was not printed, persisted, or added
to this report. Requests used `limit` values no greater than 20, offset 0, a
12–15 second request deadline, and no raw response body was retained.

- `GET https://api.8004scan.io/openapi.json`: HTTP 200, 426,107 bytes,
  OpenAPI `3.1.0`, `info.version=0.4.363`; the pinned agent, latest, semantic,
  and both detail routes are present. This matches the checked-in contract pin.
- Primary `GET /api/v1/agents?limit=20&offset=0&chain_id=97`: HTTP 500 after
  about 10.5 seconds. The bounded JSON error had root keys `success,error` and
  provider code `DATABASE_ERROR`.
- Fallback `GET /api/v1/agents/latest?limit=5&offset=0&is_registered=true&chain_id=97&is_testnet=true`:
  one attempt returned HTTP 200 in about 0.6 seconds with the expected root
  envelope `{items,total,limit,offset}`, five items, and `total=2115`. A later
  bounded attempt returned HTTP 500 (`INTERNAL_SERVER_ERROR`), confirming
  provider intermittency rather than a mapper shape mismatch.
- Semantic queries `trading`, `liquidity`, `yield`, and `health-factor`, each
  with `limit=5`, `offset=0`, `chain_id=97`, `semantic_weight=0.5`, and
  `similarity_threshold=0.5`, each returned HTTP 500 in about 10.2 seconds
  with the bounded `{success,error}` error shape. No successful semantic
  candidate was erased by the collector; its existing category-isolation
  tests cover successful candidates surviving another category failure.
- Full identity detail `GET /api/v1/agents/97/<registry>/2154` returned HTTP
  500 after about 10.4 seconds with bounded `DATABASE_ERROR`. The documented
  short detail route `GET /api/v1/agents/97/2154` returned HTTP 200 in about
  1.4 seconds with a single-agent object. This is a vendor-side full-detail
  failure; no mapper or identity contract was changed to hide it.

The existing adapter fallback is exercised by the retained HTTP/adapter tests:
retriable primary failures (including 5xx classification as
`SCAN_UNAVAILABLE`) use `/agents/latest`, and route-scoped circuit state means
an open `/agents` circuit does not block `/agents/latest`. The strict mapper
accepts the live latest root envelope and preserves the complete ERC-8004
identity tuple.

## Integrated retained-DB run

Command (flags were injected for this bounded run; the API key remained in the
server environment and was never emitted):

```text
ERC8004_INGESTION_ENABLED=true
ERC8004SCAN_DISCOVERY_ENABLED=true
MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED=false
ERC8004_MARKETPLACE_MAX_CANDIDATES=20
ERC8004SCAN_MAX_PAGES=1
ERC8004SCAN_MAX_CANDIDATES=20
ERC8004SCAN_PAGE_SIZE=20
ERC8004SCAN_SEMANTIC_PAGE_SIZE=1
ERC8004SCAN_SEMANTIC_MAX_RUN_MS=30000
node --env-file=/home/ubuntu/bnbera-w0-w1/.env --import tsx scripts/erc8004-marketplace-ingestion.ts
```

Sanitized result:

```json
{
  "status": "degraded",
  "registry": {"configured": true, "readConsistency": "provisional", "reason": null},
  "scan": {
    "status": "partial",
    "pagesFetched": 1,
    "candidatesFetched": 20,
    "candidatesCommitted": 20,
    "checkpoint": {"pagesProcessed": 1, "candidatesProcessed": 20, "cursorVersion": 1, "completedAt": null}
  },
  "semanticDiscovery": {
    "status": "degraded",
    "candidates": 0,
    "diagnostics": ["RUN_CANCELLED"],
    "categories": [
      {"category": "trading", "status": "cancelled", "diagnostic": "RUN_CANCELLED"},
      {"category": "liquidity", "status": "cancelled", "diagnostic": "RUN_CANCELLED"},
      {"category": "yield", "status": "cancelled", "diagnostic": "RUN_CANCELLED"},
      {"category": "health-factor", "status": "cancelled", "diagnostic": "RUN_CANCELLED"}
    ]
  },
  "composition": {
    "candidateCount": 20,
    "completedCount": 20,
    "failedCount": 0,
    "stageCounts": {
      "discovered": 20,
      "chainRead": 20,
      "metadataResolved": 20,
      "capabilityComplete": 0,
      "servicesObserved": 0,
      "serviceHealthy": 0,
      "versioned": 0,
      "published": 0,
      "withheld": 20,
      "categoriesPersisted": 0,
      "failed": 0
    },
    "reasons": {
      "CAPABILITY_INVALID": 20,
      "CAPABILITY_MISSING": 20,
      "CATEGORY_VERSION_UNAVAILABLE": 20,
      "SERVICE_MISSING": 20,
      "VERSION_UNAVAILABLE": 20
    }
  }
}
```

The run wrote authorized development discovery/enrichment observations only.
Post-run counts were 24 identities, 24 agent projections, 0 versions, 44
discovery-source rows, 0 service observations, 0 capability observations, and
2 scan checkpoints. No candidate was published or represented as live.

## Verification and disposition

`pnpm --filter @bnbera/agent-ingestion test -- --runInBand` passed: 15 test
files, 93 tests.

No source contract, mapper, or semantic-isolation defect was demonstrated by
the live run. The provider's 500 responses are retained as degraded evidence;
the primary/latest fallback and category-isolation behavior already have
focused tests and were not broadened to mask a failing full-detail vendor
route. This commit adds evidence only. Disable either discovery flag to stop
future provider/DB synchronization while retaining the observed rows; remove
this evidence commit to roll back the report without changing application or
database state.
