# MVP real-supply qualification report — 2026-09-05

Status: **partial / blocked; no qualifying record**.

This is an evidence-only audit of the four retained BSC testnet identities. It
does not modify PostgreSQL, call a signer, submit a transaction, call the
8004scan API, enable an ingestion gate, or relabel any record as live,
verified, healthy, or published.

## Assignment and checkout

- Worktree: `/home/ubuntu/bnbera-mvp-supply`
- Branch: `codex/mvp-supply-qualification`
- Base SHA: `fb5ca4dc7974f6bd86e2843b1afbc44ec35f3c8c`
- Delivery vertical: Marketplace Data + Web — real-supply qualification
- Task context: T2/T7 follow-up; Core Marketplace gate with QA + Deployment +
  Submission evidence
- Risk tier: R1 for read-only SQL/HTTP/RPC evidence. No R2 action was taken.
- Changed path: this report only; no code, schema, migration, configuration,
  or database row was changed.

## Documentation gate

Before the audit, the following paths were read in full from the shared
checkout (the corresponding files in this worktree have matching content):

- `/home/ubuntu/bnbera-w0-w1/AGENTS.md`
- `/home/ubuntu/bnbera-w0-w1/docs/04-bnbera-master-implementation-plan.md`
- `/home/ubuntu/bnbera-w0-w1/docs/05-subagent-delivery-plan.md`
- `/home/ubuntu/bnbera-w0-w1/docs/07-mvp-live-marketplace-task-plan.md`
- `/home/ubuntu/bnbera-w0-w1/config/standards.lock.json`
- `/home/ubuntu/bnbera-w0-w1/docs/01-marketplace-donor-merge-plan.md`
- `/home/ubuntu/bnbera-w0-w1/docs/06-erc8004-pipeline-integration-plan.md`
- `/home/ubuntu/bnbera-w0-w1/docs/adr/0003-wave1-legacy-migration-repair.md`
- `/home/ubuntu/bnbera-w0-w1/docs/release-evidence/2026-09-05-mvp-t2-handoff.md`
- `/home/ubuntu/bnbera-w0-w1/docs/release-evidence/mvp-t7-preacceptance-2026-09-05.md`
- `/home/ubuntu/bnbera-w0-w1/docs/release-evidence/2026-09-05-mvp-coordination.md`
- `/home/ubuntu/bnbera-w0-w1/docs/release-evidence/mvp-ops-qa-handoff.md`
- `/home/ubuntu/bnbera-w0-w1/docs/release-evidence/2026-09-04-w0-w1-erc8004-handoff.md`
- `/home/ubuntu/bnbera-mvp-supply/packages/domain/src/identity.ts`
- `/home/ubuntu/bnbera-mvp-supply/packages/domain/src/states.ts`
- `/home/ubuntu/bnbera-mvp-supply/packages/domain/src/services.ts`
- `/home/ubuntu/bnbera-mvp-supply/packages/domain/src/canonical.ts`
- `/home/ubuntu/bnbera-mvp-supply/packages/domain/src/events.ts`
- `/home/ubuntu/bnbera-mvp-supply/packages/agent-ingestion/src/types.ts`
- `/home/ubuntu/bnbera-mvp-supply/packages/agent-ingestion/src/normalize.ts`
- `/home/ubuntu/bnbera-mvp-supply/packages/agent-ingestion/src/metadata.ts`
- `/home/ubuntu/bnbera-mvp-supply/packages/agent-ingestion/src/pipeline.ts`
- `/home/ubuntu/bnbera-mvp-supply/packages/agent-ingestion/src/adapters/8004scan.ts`
- `/home/ubuntu/bnbera-mvp-supply/packages/agent-ingestion/src/adapters/erc8004-codec.ts`
- `/home/ubuntu/bnbera-mvp-supply/packages/agent-ingestion/src/probe.ts`
- `/home/ubuntu/bnbera-mvp-supply/packages/agent-ingestion/src/ingestion.ts`
- `/home/ubuntu/bnbera-mvp-supply/packages/marketplace/src/types.ts`
- `/home/ubuntu/bnbera-mvp-supply/packages/marketplace/src/source.ts`
- `/home/ubuntu/bnbera-mvp-supply/packages/marketplace/src/read-model.ts`
- `/home/ubuntu/bnbera-mvp-supply/packages/marketplace/src/eligibility.ts`
- `/home/ubuntu/bnbera-mvp-supply/packages/marketplace/src/publication.ts`
- `/home/ubuntu/bnbera-mvp-supply/packages/db/src/schema.ts`
- `/home/ubuntu/bnbera-mvp-supply/apps/web/src/lib/marketplace-contract.ts`
- `/home/ubuntu/bnbera-mvp-supply/apps/web/src/lib/marketplace-server.ts`

Applicable flags remain fail-closed: `ERC8004_INGESTION_ENABLED=false`,
`ERC8004SCAN_DISCOVERY_ENABLED=false`, and
`MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED=false`. Unresolved locks are the
candidate lock status, chain-56/chain-97 main-track decision, finality and
reorg configuration, rotated 8004scan credential, semantic provider/model/
dimension, ERC-8183/B402 addresses and settlement, Greenfield provider/SDK,
and Altana/Studio addresses and runtime integrity. No unresolved lock was
enabled.

## Retained identity and database evidence

Read-only observation time: 2026-09-05T04:09:45Z. The retained database is
the healthy `bnbera_erc8004_pgvector` container with loopback binding
`127.0.0.1:55432`; PostgreSQL reports pgvector `0.8.6`.

All four rows use the complete identity tuple namespace
`eip155`, chain `97`, and registry
`0x8004a818bfb912233c491871b3d84c89a494bd9e`. They are distinct agent IDs,
not four views of a shortened token or wallet key.

| Agent | Agent URI | Stored read block | Stored block hash | Owner and agentWallet | Source |
|---:|---|---:|---|---|---|
| 2106 | `https://mandate-agents.timjosh507.workers.dev/rebalancing-a.json` | 129186682 | `0x7da93ef4982067cdab339ce6ffa56471f8c5bd35e48e7fc22f9b014a30f80447` | `0xdc5071910e6ca6855d45f96ba28ee0a2e5629299` / same | `8004scan` |
| 2107 | `https://mandate-agents.timjosh507.workers.dev/rebalancing-b.json` | 129186681 | `0x65046bc06596f841e9fbe63d3af90aa5da0dba3a8497e017e55fb5ddbbf25158` | `0xdc5071910e6ca6855d45f96ba28ee0a2e5629299` / same | `8004scan` |
| 2108 | `https://mandate-agents.timjosh507.workers.dev/yield-a.json` | 129186680 | `0x9e6f6fdd6dc215e10d6faa78ec9fbd8efba68fe3b0edd3ae27c6fc60f8cbaebe` | `0xdc5071910e6ca6855d45f96ba28ee0a2e5629299` / same | `8004scan` |
| 2109 | `https://mandate-agents.timjosh507.workers.dev/yield-b.json` | 129186677 | `0x7c858a0a084c2a8ae5509a38e56ab75c6ea1f790dff106b158e0b66c156a251c` | `0xdc5071910e6ca6855d45f96ba28ee0a2e5629299` / same | `8004scan` |

The four source-row digests are retained provenance for the upstream scan
records; they are not a claim that the metadata documents are valid.

Read-only counts at the same observation were:

| Surface | Count |
|---|---:|
| `erc8004_identities` | 4 |
| `agents` | 4 |
| `agent_discovery_sources` | 4 |
| `agent_capability_observations` | 0 |
| `agent_service_observations` | 0 |
| `agent_service_probe_results` | 0 |
| `agent_services` | 0 |
| `agent_versions` | 0 |
| `agent_category_predictions` | 0 |
| `agent_health_snapshots` | 0 |
| `agent_enrichment_observations` | 0 |
| `erc8004_chain_observations` | 0 |

The zero projection/enrichment counts are expected from this evidence-only
run and explain why the current database-backed marketplace remains empty.
No retained row was cleaned, rewritten, or removed.

## Chain read check

Using the public BSC testnet RPC and the locked Identity Registry ABI read
selectors, a read at each stored historical block returned the provider error
`missing trie node`. This prevents a new exact-block finality claim; the
stored rows correctly remain `read_consistency=provisional`.

A separate latest-state read at block `129188686` (hash
`0x79556477384d213d0adab94cc768691b5ce6377ca0b6e783a62b5c3a49c13651`)
returned, for all four IDs, the same public owner, `agentWallet`, and
`tokenURI` recorded above. This is continuity evidence only. It does not
promote the historical observations to finalized, verified, or published
state.

The local ABI snapshot's canonical SHA-256 is
`6d5974b564d266507a53f65951adcd0ab288904d5a716a354ea237176ece8f83`, which
matches the standards lock. No write ABI or signer was used.

## Public metadata and parser result

Each URI returned HTTP 200 with `application/json`. The observed byte lengths
and response SHA-256 digests were:

| Agent | Bytes | Response SHA-256 |
|---:|---:|---|
| 2106 | 2342 | `a9e4b04ce151754179af0e64ed95bc5a0e91377a41a2eba9ec790dc05cf659af` |
| 2107 | 2398 | `c4c10ade3e51a83aea06a9c0b0f1fe0e716126a06278f24eecb08633897973f5` |
| 2108 | 1807 | `ea546931e4e98bf71fe46b9e4b8715d5fe96670f7c9d23151d4761170241498d` |
| 2109 | 1780 | `88be9dbc3400f371003fd5ef752536f4aea24269799a16e4519d0f7b4ac646c8` |

All four documents have the same relevant shape:

- Present: `name`, `description`, A2A-card `protocolVersion`, `url`,
  `preferredTransport`, `capabilities` with only `streaming` and
  `pushNotifications`, one object in `skills`, and a custom `x-mandate`
  policy.
- Missing: ERC-8004 registration `type`, `image`, `services`, and
  `registrations`. `supportedTrust` is also absent, but that field is
  optional and is not the reason for withholding.
- The one skill contains `id`, `name`, `description`, `tags`, `inputModes`,
  and `outputModes`. It does not contain a BNBEra capability manifest,
  `schemaVersion`, `inputSchema`, or `outputSchema`.

The locked ERC-8004 registration-file structure requires the registration
`type`, `name`, `description`, `image`, and a `services` list. Its service
entries advertise a service `name`, `endpoint`, and optionally `version`.
The `agentURI` is required to resolve to this registration file. These four
URIs instead resolve directly to an A2A Agent Card. That is a metadata
publication defect in the supply, not evidence that the resolver should
reinterpret an A2A card as a registration file.

The current resolver/parser therefore has the following conservative result:

1. `parseAgentRegistrationMetadata` can parse the JSON object but emits
   `REGISTRATION_TYPE_MISSING`, returns `services=[]`, and does not treat the
   object-valued A2A `skills` entries as the registration's string skill list.
2. The pipeline only takes a capability manifest from a top-level
   `capabilityManifest`, `capability_manifest`, or a reviewed object shaped as
   `capabilities.schemaVersion + capabilities[]`. The A2A `capabilities`
   object has neither of those fields, so it yields no capability observation.
3. The strict capability contract requires a non-empty `schemaVersion` and at
   least one capability with explicit `id`, `description`, `inputSchema`, and
   `outputSchema`. Mapping A2A `inputModes`/`outputModes` strings into JSON
   Schemas would fabricate semantics and weaken the publication boundary.
4. Because `registration.services` is empty, there is no normalized advertised
   service to probe. The custom card `url` cannot be treated as a service
   descriptor without an ERC-8004 `services` entry.

The card-declared runtime URL (for example,
`https://mandate-agents.timjosh507.workers.dev/rebalancing-a`) returned HTTP
404 to the bounded safe GET observation. A manually known
`/.well-known/agent-card.json` path returned HTTP 200 JSON for each card, but
that path was not advertised in an ERC-8004 service list and the ingestion
policy explicitly forbids deriving universal paths such as `/.well-known`,
`/a2a`, or `/health`. The 200 card fetch therefore does not repair the
registration or prove an advertised marketplace service.

## Exact qualification disposition

The T2 composition evidence reported four exact registry reads and four
metadata resolutions, with all four withheld at capability/service stages.
The retained DB confirms no capability, service, probe, version, category, or
health rows were produced. The exact reasons are:

- `CAPABILITY_MISSING` / publication `CAPABILITY_INVALID`: no explicit
  BNBEra capability manifest or JSON input/output schemas are present.
- `SERVICE_MISSING`: no ERC-8004 `services` list is present; the A2A card is
  published in the registration URI slot and its runtime URL is not a safe,
  advertised service contract.
- `REGISTRATION_TYPE_MISSING` and missing `image`: the URI is not an
  ERC-8004 registration file even though name/description are available.
- `IDENTITY_READ_NOT_FINALIZED`: the standards lock leaves finality unresolved
  and the available historical RPC read is pruned. Even repaired metadata
  would remain withheld until a reviewed finalized read is available.

No parser weakening is justified for these four records. A field-alias repair
could help a different record that actually contains an ERC-8004 `services`
array, but it cannot create the absent array, capability schemas, or finality
evidence here. No code change was made in this lane.

## Safest path to one qualifying agent

The least-expansive recovery path is to use one known tuple (2106 is a
reasonable first candidate) through the existing manual-import boundary after
the owner/operator has repaired its public publication:

1. Do not use the exposed or rotation-required 8004scan credential. Rotate it
   in the release-owner secret channel before any vendor discovery. Manual
   tuple import is independent of that vendor.
2. Have the identity owner publish a new JSON document at the existing
   `agentURI` (or explicitly approve an onchain `setAgentURI` to a new public
   URL). The document should include the locked ERC-8004 registration `type`,
   name, description, image, and a service entry such as:

   ```json
   {
     "name": "A2A",
     "endpoint": "https://mandate-agents.timjosh507.workers.dev/rebalancing-a/.well-known/agent-card.json",
     "version": "0.3.0"
   }
   ```

   It should also include a registration entry binding agent `2106` to
   `eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e`. The endpoint must be
   the real advertised card URL, not an inferred path, and must remain public
   HTTPS without credentials.
3. Add a top-level BNBEra capability manifest with a schema version and one or
   more capabilities containing explicit JSON `inputSchema` and
   `outputSchema`, required protocols, allowed actions, and bounded task
   limits. Do not derive those schemas from A2A modes or the custom policy;
   the owner must document the actual request/response contract.
4. Ensure a bounded safe GET of the advertised A2A card succeeds and that its
   card fields/skills satisfy the current read-only A2A probe. A card GET is
   service evidence only after the registration advertises that URL.
5. Resolve and record the reviewed BSC testnet finality/checkpoint policy, or
   retain the record as provisional and withheld. Do not mark it published
   solely because the latest RPC read agrees.
6. Import only the exact tuple manually, rerun the bounded read-only
   enrichment/publication workflow with semantic and vendor discovery gates
   still off, and retain the stage counts and any remaining reason codes. A
   single record qualifies only after identity, finalized read, metadata,
   capability, advertised service, healthy probe, version/publication policy,
   and category/detail requirements all pass.

No private key, passkey, session material, API key, or credential is required
for this recovery path. It requires owner-controlled public metadata (and an
owner-approved URI write only if the URI itself must change), plus the
coordinator's unresolved finality decision.

## Commands and evidence level

Read-only commands run during this audit included:

```text
git status --short --branch
git rev-parse HEAD
git branch --show-current
sudo -n docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
sudo -n docker exec bnbera_erc8004_pgvector psql ...
curl -fsSL --max-time 20 -H 'accept: application/json' <public-agent-uri>
curl -sS --max-time 15 -H 'accept: application/json' <public-card-or-runtime-uri>
read-only eth_getBlockByNumber / eth_call against the BSC testnet RPC
```

Evidence levels are retained-live PostgreSQL read, public metadata HTTP read,
public latest-state RPC read, and static parser/schema comparison. The
historical exact-block RPC result is blocked by provider pruning. No
installation, build, test, deployment, payment, signing, or database write
was performed for this evidence-only lane.

## Feature gates and rollback

Keep all three ERC-8004/semantic flags false until their independent gates
pass. Ingestion can be disabled without deleting the retained identity/source
history. If this report is rejected, revert only its documentation commit;
there is no database or runtime rollback. Do not drop the PostgreSQL volume,
delete identity rows, or bypass publication diagnostics to make the preview
non-empty.
