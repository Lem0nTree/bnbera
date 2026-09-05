# Live ERC-8004 supply hunt — 2026-09-05

Status: **partial / blocked; zero qualifying records**.

This handoff records a bounded authenticated 8004scan search and read-only
identity/metadata/service audit. It does not claim a published listing,
finalized identity, capability execution, payment, deployment, or onchain
write. The API credential was loaded server-side and is not recorded here.

## Assignment and documentation gate

- Checkout: `/home/ubuntu/bnbera-live-supply`
- Branch: `codex/live-supply-hunt`
- Base SHA: `613d6856dbeabdf50ca26918e641d40146817f08`
- Delivery vertical: W1 Marketplace Data + Web — live-supply qualification
- Feature gate: Core Marketplace; vendor discovery and ingestion remain
  explicitly runtime-gated
- Risk tier: R1 read-only provider/RPC/metadata evidence
- No paid call, wallet access, signer, deployment, or onchain write was used.

Before this evidence edit, the checkout read `AGENTS.md`; plans
`docs/01-marketplace-donor-merge-plan.md`,
`docs/04-bnbera-master-implementation-plan.md`,
`docs/05-subagent-delivery-plan.md`,
`docs/06-erc8004-pipeline-integration-plan.md`, and
`docs/07-mvp-live-marketplace-task-plan.md`; `config/standards.lock.json`;
ADRs `docs/adr/0001-altana-studio-custody-bootstrap.md` and
`docs/adr/0003-wave1-legacy-migration-repair.md`; current W0/W1, vendor,
discovery-runner, pipeline, and supply handoffs; and the consumed identity,
state, service, canonical, event, ingestion, metadata, probe, pipeline,
composition, scan, registry, marketplace, database, runtime, and ingestion
script contracts.

Unresolved locks remain fail-closed: BSC 56/97 main-track decision, registry
confirmation/finality thresholds, semantic release, ERC-8183/B402, Greenfield,
Altana/Studio integrity, and production credential/topology. Read-only chain
reads below are therefore provisional.

## Bounded discovery search

The current 8004scan contract was used with page size `20`, `/agents/latest`,
`is_registered=true`, explicit `chain_id`, `is_testnet`, and offsets
`0,20,40,60,80`. The primary `/agents` route was not treated as the only
source. Four-category semantic discovery was attempted intermittently by the
existing bounded collector; no semantic result was allowed to override the
identity, metadata, capability, service, or health gates.

| Chain | Successful latest pages | Items observed | Provider failures |
|---:|---:|---:|---:|
| 97 | 5 / 5 sampled offsets (some retried) | 100 | timeout/unavailable on an initial attempt at offsets 0/40/60 |
| 56 | 4 / 5 sampled offsets | 80 | HTTP 500 at offset 40 |
| **Total** | **9 / 10 unique sampled offsets** | **180** | **1 unresolved offset after bounded retries** |

The 180 rows are discovery observations, not qualifying listings. To stay
within the 100-candidate audit bound, detailed follow-up was limited to 19
unique identity tuples selected for A2A/MCP/x402 and category signals:

- Chain 97: `2055`, `2066`, `2076`, `2095`, `2097`, `2102`, `2114`,
  `2115`, `2117`, `2121`.
- Chain 56: `334971`, `334980`, `335045`, `335046`, `335047`, `335048`,
  `335049`, `335053`, `335061`.

Short detail responses were preferred. A full-identity detail fallback was
available when the short route failed; bounded provider timeouts and 429s were
retained as failures rather than hidden. Unique short-detail outcomes were:

| Outcome | Count | IDs |
|---|---:|---|
| HTTP 200 | 4 | 97:`2115`,`2117`; 56:`335048`,`335049` |
| timeout | 8 | 97:`2055`,`2066`,`2095`,`2097`,`2102`,`2114`,`2076`,`2121` |
| HTTP 429 | 7 | 56:`334971`,`334980`,`335045`,`335046`,`335047`,`335053`,`335061` |

Duplicate detail attempts were deduplicated by the complete
`(namespace, chainId, identityRegistry, agentId)` tuple. No shortened token,
wallet, name, or endpoint key was used.

## Read-only enrichment results

Seven candidates received direct Identity Registry reads using the locked
ABI/address and current chain block/hash. All seven reads returned owner,
`agentWallet`, and `agentURI`; all remain `readConsistency=provisional` because
the lock has no accepted confirmation threshold.

| Chain | Agent IDs | Registry |
|---:|---|---|
| 97 | `2076`, `2097`, `2106`, `2114` | `0x8004a818bfb912233c491871b3d84c89a494bd9e` |
| 56 | `334971`, `335048`, `335053` | `0x8004a169fb4a3325136eb29fa0ceb6d2e539a432` |

Three actual registration documents were inspected without rewriting them:

1. **97:2097 — B8X Health Factor Agent.** The onchain `agentURI` is a valid
   ERC-8004 registration data URI with a real A2A service endpoint. That
   endpoint returned HTTP 200 and a valid A2A 0.3 card. The card digest was
   `e15d9f2febc731368a5e8555fb9bf8af2adef8329d8762d3a7a81a739b905bcb`.
   The registration has no explicit BNBEra capability manifest. Its A2A
   skills advertise `inputModes`/`outputModes` only; no JSON input/output
   schemas are present.
2. **56:334971 — Q402 Agent (by Quack AI).** The actual HTTPS `agentURI`
   returned a valid ERC-8004 registration (`b92fba36485223326f377e1d01e26bdfe3880666245d8a655d0553469520badc`).
   It advertises Q402 and MCP service descriptors. No capability manifest or
   input/output schema was present. The MCP descriptor has no protocol version
   and was not upgraded by inference.
3. **56:335048 — crx-rollins.agent.** The actual HTTPS `agentURI` returned a
   valid ERC-8004 registration (`d788fbe6a4f3940556d23eac9312b97aa9555be1ef24b6b06d5cb7cca0f293f0`).
   Its A2A service URL contains the literal `{agentId}` placeholder. This is
   not a callable advertised endpoint and was not substituted or probed as a
   real service. No capability manifest was present.

The observed enrichment stage counts for these three inspected documents are:

| Stage | Count |
|---|---:|
| discovery candidates sampled | 180 |
| detailed candidates audited | 19 |
| direct identity reads | 7 |
| actual metadata documents resolved/inspected | 3 |
| explicit advertised service descriptors observed | 4 |
| service protocol responses healthy | 1 |
| explicit capability manifests with JSON input/output schemas | 0 |
| immutable versions created | 0 |
| published records | 0 |
| qualifying records (capability + advertised healthy service) | **0** |

The one healthy service observation is the registered B8X A2A card for 97:2097;
it does not make the agent qualifying because the capability contract is
incomplete. The Q402 and crx-rollins records remain withheld for missing or
unusable capability/service evidence. No adapter was added: mapping A2A mode
strings into JSON Schemas would fabricate request/response semantics, and the
Q402 MCP version was absent.

## Disposition and next action

No candidate met the requested real-capability plus healthy-advertised-service
criterion. The strict capability boundary correctly prevented publication.
The safe next step is owner-supplied public metadata containing explicit
capability `inputSchema`/`outputSchema` and, for any selected service, an exact
non-placeholder advertised endpoint with a protocol-versioned card. A reviewed
finality policy is also required before publication can become canonical.

The existing integrated composition run remains the source of retained-DB
stage counts; this hunt adds no database rows and does not relabel any record.
No flags or lock entries were changed.

Disable/rollback remains independent and fail-closed:

```text
ERC8004SCAN_DISCOVERY_ENABLED=false
ERC8004_INGESTION_ENABLED=false
MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED=false
```

Rollback of this handoff removes only this evidence document. Retained identity,
discovery, and historical evidence must not be deleted to make the marketplace
appear non-empty.
