# Mainnet discovery and protocol follow-up — 2026-09-09

> Current delivery update: the user subsequently removed the global 0.01 U
> constraint and authorized explicit-risk protocol-ready sellers. The final
> section, “Production MVP admission update”, supersedes the earlier capped
> supply conclusion. Historical observations below are retained, not erased.

This follow-up preserves the existing 100-profile preview, retained database,
testnet provider allowance and dirty checkout at `3f98a015`. The candidate pool
below is an independent read-only audit, not 1,102 published/hireable profiles.

## Beefy MCP correction

Beefy `56/45422`, `https://erc8004.heyanon.ai/mcp/beefy`, negotiates MCP
`2025-06-18`. Initialization and `tools/list` return HTTP 201 JSON; the tool
list contains 19 valid input schemas, 54,825 bytes, 2,911 JSON nodes and nesting
depth 18. BNBEra incorrectly applied its persisted profile-metadata guard
(depth 8, 2,048 nodes) to the transient protocol response. It failed before
extracting the safe capability summary.

The MCP transport now separately bounds its in-memory wire response to depth
32, 50,000 nodes, 1,000 array items, 10,000-character strings and the existing
response byte limit. Credential-bearing fields, unsafe targets, oversized
responses, mismatched request IDs and malformed tool schemas still fail.
Only the allowlisted names/count/protocol summary passes the unchanged
persisted-public-metadata guard. No tool is invoked by health checking.

The live recheck and retained API now show **MCP verified / 19 capabilities**.
Summary digest: `d4dd7498089f9e8bb7a6c6b246ede7efc73177321ca89e75814fb69c1dd9862d`.
The actual [8004scan quality page](https://8004scan.io/agents/bsc/45422?tab=quality)
showed overall score **30.44**, rank **546**, endpoint health **100/100** and
cached MCP **19 tools**. Its healthy endpoint claim agrees with the corrected
BNBEra observation; endpoint health does not establish a paid job contract.

## Wider source scan

A second bug prevented larger scans: the 8004scan adapter applied one
profile's 2,048-node guard to an entire 100-item page. Valid API-200 responses
were rejected and opened the source circuit. The adapter now validates the
bounded envelope and each profile independently, retaining the 100-item and
response-byte limits and rejecting credential-bearing items.

Sixteen successful bounded queries (score/activity/feedback orderings,
MCP/A2A protocol filters and ERC-8183/negotiation/escrow searches) found
**1,102 unique BSC identities** from a vendor population of **310,676** at
observation time. Detail/protocol review inspected **150** candidates across
two prioritized passes; **79** had at least one verified protocol. Counts:

| Protocol | Verified | Auth required | Invalid | Unreachable |
| --- | ---: | ---: | ---: | ---: |
| A2A | 72 | 8 | 17 | 20 |
| MCP | 8 | 1 | 2 | 4 |

Some identities share services; these are identity observations, not unique
independent operators. Verified A2A means a valid Agent Card, not work delivery.

## Mainnet quotes and identity proof

Of 21 read-only negotiations, **14** produced a canonical quote hash and an
EIP-191 signature matching **14 distinct finalized ERC-8004 agentWallets**.
Thirteen quote mainnet U (`0xcE24439F2D9C6a2289F741120FE202248B666666`);
IVL quotes USDT and cannot use a U-only contract without renegotiation.

| Agent ID | Name | Quoted U |
| --- | --- | ---: |
| 208760 | recurringmonitoringserviceagent | 0.0001 |
| 265375 | BNB LP Range Rebalancer | 0.1 |
| 269233 | BNB Grid Trader (test) | 0.1 |
| 213053 | bubbleaiagent | 0.0001 |
| 213084 | bubbleaiagent | 0.0001 |
| 212989 | bubbleaiagent | 0.0001 |
| 213378 | bubbleaiagent | 0.0001 |
| 213036 | bubbleaiagent | 0.0001 |
| 212840 | bubbleaiagent | 0.0001 |
| 213332 | bubbleaiagent | 0.0001 |
| 212943 | bubbleaiagent | 0.0001 |
| 212769 | bubbleaiagent | 0.0001 |
| 341225 | yieldrouter — capacity-aware yield optimisation | 0.1 |

These offers establish price, provider identity and signed chain/commerce
binding at the observation time. They expire after their seller's short quote
window and must be obtained again for an actual hire. They are **not yet
hireable inside BNBEra**: the external negotiated-seller task/result adapter,
mainnet release acceptance and published listing integration remain open.
No funded-job notification, tool invocation, payment or mainnet transaction
was made in this audit.

Agent 204789's recovered signer differed from its registered agentWallet;
four LingoAI responses had prices but no usable signed quote; two endpoints
failed during the final pass. The audit does not mark them ready.

Canonical quote parsing follows the official
[BNB Agent SDK negotiation implementation](https://github.com/bnb-chain/bnbagent-sdk/blob/bab27109237d509c780a36cf831dcfce70aabafe/typescript/src/erc8183/negotiation.ts)
and its EIP-191 string signing. Finalized registry reads supply ownership and
the bound agentWallet; vendor owner labels are not treated as chain truth.

## Operations and validation

```sh
MAINNET_SUPPLY_AUDIT_ENABLED=true MAINNET_AUDIT_MAX_DETAILS=100 \
  node scripts/run-with-repo-env.mjs -- pnpm exec tsx scripts/marketplace-mainnet-supply-audit.ts
MAINNET_NEGOTIATION_AUDIT_ENABLED=true \
  node scripts/run-with-repo-env.mjs -- pnpm exec tsx scripts/marketplace-mainnet-negotiate-audit.ts
```

The first command resumes completed query/detail work. The second retains
public quote/signature and exact finalized binding evidence. Neither writes
to the application DB or chain. Artifact paths:
`.runtime/mainnet-supply-upgrade/candidate-audit.json` and
`.runtime/mainnet-supply-upgrade/negotiation-audit.json`.

Validation: ingestion 134 tests passed after the MCP fix; subsequent focused
MCP/8004scan regressions 26/26 passed, including full-page acceptance and
credential-field rejection. Ingestion lint/typecheck passed. Commerce 95/95
and browser commerce 24/24 passed. Future browser operation intents use the
transport marker `eip1193`; old `walletConnect` intents still recover. The
authenticated signer, chain, exact call and receipt checks are unchanged.
Wallet and targeted UI work are documented in `WALLET-UI-REVIEW.md`.

## External seller lifecycle continuation — 10:40 UTC

The recovered partial implementation assumed an `/a2a` invocation path and a
`/job/{id}/response` result route. Live cards for the ten capped-offer sellers
instead name their root `/` as the A2A endpoint and explicitly say they serve
no job-query endpoint. The resolver now uses the exact declared same-origin
endpoint. A successful JSON-RPC response only counts as acknowledgement when
its data part says `accepted` for the exact funded job.

The result pointer comes from the pinned OptimisticPolicy's `JobInitialised`
event in the provider submission receipt, matching the exact job and
deliverable. This follows the official SDK's
[`getDeliverableUrl`](https://github.com/bnb-chain/bnbagent-sdk/blob/bab27109237d509c780a36cf831dcfce70aabafe/typescript/src/erc8183/policy.ts)
and pinned [policy event](https://github.com/bnb-chain/apex-contracts/blob/b40b18011407ba13516661d3784bcb727a0c7794/contracts/OptimisticPolicy.sol).
The HTTPS manifest is bounded and its canonical bytes must match the on-chain
Keccak and full job/deployment binding. No result URL convention is guessed.

Buyer-owned delivery and result-refresh routes use a durable once-only claim;
an unknown notification is retained across restart and never automatically
resent. Successful log windows advance a durable cursor in 500-block steps;
failed reads do not advance it. The browser offers explicit **Request
delivery**, **Check for result**, and public submission-hash recovery, with
the delivered report readable before buyer approval. Mainnet payments remain
disabled: these changes do not constitute live paid execution acceptance.

Migration `0011_external_seller_deliveries` was reviewed and applied after a
mode-0600 PostgreSQL16 backup and a disposable restore. Four concurrent claim
attempts produced one winner, unknown state survived reconnect, changed quote
terms were rejected, and migration restart was a no-op. Fresh/legacy forward
repair also passed on a separate disposable database. Retained delivery rows
remain zero; no task slot or chain funds were consumed.

Evidence: `.runtime/mainnet-supply-upgrade/delivery-db-check.json` and
`before-external-delivery.dump`. The temporary restored database named in the
artifact is disposable and contains no new mainnet job evidence.

The read-only execution audit found mainnet job counter **56,758**. The
configured `bsc-dataseed.bnbchain.org` rejects log reads. PublicNode accepted
the most recent 19 × 500-block windows with no submissions by these ten
providers, then rejected 181 older windows. Those failed windows are recorded
as unavailable, not proof of absent jobs. The ten signed quotes therefore
remain **execution unverified**. No funded notification, task execution,
operator mainnet transaction or fabricated hireability was used to close
this gap. `execution-audit.json` records the exact ranges and outcomes;
`marketplace-mainnet-execution-audit.ts` can be rerun with a suitable read-only
archive RPC via `MAINNET_EXECUTION_RPC_URL`.

### Exact historical receipts and projected-manifest compatibility

A later finalized `getJob` inventory found 23 jobs for the ten providers.
Seven providers had submissions: monitoring agent 208760 (latest job 56719)
and six BubbleAI agents (completed jobs 56565–56570). The other three capped
providers, 212943/212840/212769, have unresolved funded jobs 56561–56563 in
this observed inventory. The scan recorded 52,158 failed multicall items as
unavailable; it does not claim a complete history from those failures.

Binary search on each job's `submittedAt` timestamp located its exact block,
then provider receipts and matching policy events supplied seven real result
pointers without relying on the historical log index. Six BubbleAI pointers
currently return 404. Monitoring 56719 has a readable response projection;
its route omits chain/contracts while adding `tx_hash` and `deliverable_url`.
Reinstating only the independently verified deployment fields reproduces
the exact committed Keccak
`0xf8b6744a72cb7c99c54fc3993e080477088d251beb4781a3e7f53b7f87c44aff`.
The adapter now supports that narrow response shape, requires the wrapper's
pointer/transaction to match the verified receipt, and still rejects any
full-manifest hash mismatch. Changed receipt/content and duplicate/wrong
policy-event regressions pass.

Monitoring submission transaction:
`0x01704c11113dbeba605294bce4b131f8223bc9d38ff55c08d967308dbabdcde3`,
block 120312687. Its output is a generic completion paragraph for a generic
test request; this is historical content-integrity evidence, not proof of a
useful current monitoring report or completed settlement. Ten current
hireable agents therefore remain unproven. See `job-audit.json` and
`result-audit.json` for identity/job/receipt/pointer details.

Final source checks for this continuation: commerce 116 tests, ingestion135,
web217, marketplace52 and database20 passed; the other workspace suites also
passed. Workspace lint/typecheck, migration inventory check and fresh/legacy
database smoke passed. Integration/security passed53 with one intentional
environment-dependent skip. After the projected-manifest correction, the
14 focused external-seller regressions and commerce build passed again.
Preview rebuild/browser and tunnel recovery are coordinated separately.

## Expanded history and retained membership — 11:10 UTC

The latest bounded scan supersedes the earlier audit counts: **1,102** unique
mainnet identities, **262** completed detail reviews and **142** identities
with a verified protocol. A2A outcomes are 132 verified / 8 auth-required /
34 invalid / 39 unreachable; MCP outcomes are 46 verified / 2 auth-required /
10 invalid / 19 unreachable. Rate-limited details remain unavailable. Sixteen
of 21 negotiation records now have wallet-matching signatures; the production
bounded adapter freshly verified **12 offers at 0.0001 U**. None of those offers
alone establishes execution or release eligibility.

`marketplace-mainnet-provider-history.ts` ranks finalized `getJob` history
against finalized wallets of the 1,102 discovered candidates. Smaller batches
successfully read 3,790 of the latest 6,000 IDs; 2,210 failed reads remain explicitly
unavailable. The inventory found 58 distinct submitting provider wallets, 29
matching one or more candidate identities. This is provider-wallet discovery,
not attribution of every shared-wallet job to every registered service.

Exact receipt pointers produced five currently retrievable hash-valid
historical outputs in that expanded inventory:

| Provider/service lead | Job | Relevant remaining gap |
| --- | --- | --- |
| Monitoring 208760 | 56719 | Generic historical output; no completed current paid acceptance |
| LingoAI shared wallet | 56740 | Output is Health Factor, not the first matching Grid identity; current 1 U offer lacks the accepted signature/binding |
| BNB LP 265375 | 56591 | Completed historical result; current 0.1 U quote exceeds the preserved 0.01 U cap |
| BNB Grid 269233 | 56633 | Completed historical result; current 0.1 U quote exceeds the preserved 0.01 U cap |
| AllowanceLatch wallet lead 338110 | 56753 | Result actually names RangeReset; service attribution/card/offer remain unproven |

The 29-provider result audit initially left 24 leads unavailable or unreadable. Its
`candidateIdentityAttribution: provider-wallet-only` label prevents a shared
wallet from manufacturing multiple execution-verified identities. The goal
of ten genuinely hireable mainnet agents remains **incomplete**. Mainnet
release and operator writes remain disabled; no cap was raised to count more
sellers. Evidence: `provider-history.json`, `provider-result-audit.json` and
the separate signed `adapter-audit.json` in the existing runtime directory.
On a subsequent read, seller 211183 also exposed a hash-valid historical
manifest, but its current card names `http://localhost:9000/` as invocation.
That unsafe target is rejected; no public endpoint is guessed. Result
availability fluctuates, so immutable `result-retrieval-audit-*.json` artifacts
record bounded fresh attempts independently of earlier successful evidence.
The final bounded retry artifact `result-retrieval-audit-1788952320173.json`
verified all six provider outputs, including the localhost-card seller, and
left the current hireability blockers unchanged.

The inherited database had 90 mainnet plus 20 testnet active directory markers.
After a fresh finalized 208760 snapshot, ten excess mainnet memberships
(341755–341764) were changed to `bnbera-directory-archived-v1` in a transaction.
No identity, version, source row or observation was deleted. Active membership
is now 80 mainnet / 20 testnet. The public projection and service-refresh job now
require the active marker, so historical snapshots do not defeat rotation.
Above-quota incoming priorities stay pending until enrichment and archival
swap commit together. Beefy 45422 / OpenOdds 49637 / IVL 341628 are protected.
The real retained-DB check temporarily archived one profile, observed 99
instead of 100 visible, rolled back, and recovered 100 without changing history.
`directory-membership-check.json` records this reversible acceptance.

Reference 2293 now binds the reviewed new Cloudflare origin and registration
version 3 (`ff5c45c8-dd0e-5d67-a0b3-d774502617ba`). A PostgreSQL 16 backup preceded
the atomic allowance-digest rebind; the existing slot and enabled state were
preserved byte-for-byte, leaving **two** lifetime slots. No reservation was
recycled and no gas/task cap changed. `reference-endpoint-rotation.json`
records the backup and before/after digests. The worker remains fail-closed
until it restarts against the matching version and proves healthy.

Updated source verification: commerce 117 tests, web 218 tests, commerce build,
web typecheck and web lint passed. The parent coordinates the final production
build, provider restart, public API and desktop/mobile browser acceptance.

### Final publication binding and health-build repair — 11:16 UTC

URI ingestion's version 3 was an intermediate unavailable-price profile.
The subsequent setup publication correctly produced **version 4**, UUID
`a394ad86-02de-5d21-8602-96f954fc679b`, with fixed 0.001 U pricing, the expected
health-factor capability and new card/readiness endpoints. It is already the
current published version: **do not republish it**. The exact allowance now
binds version 4. A fresh backup preceded a second atomic digest rebind;
`reference-endpoint-rotation-v4.json` proves the original slot digest and two
remaining slots were preserved. New allowance digest:
`b42863241cc30437fd474054a95903fb6dbd25f232a153d816c11fd318d3bd12`.

The intermittent `ENDPOINT_UNVERIFIED` response was independently traced to
stale compiled marketplace output. Source already sampled health time after
each identity's reads, but `dist/source.js` still used the clock captured
before the long listing scan. A concurrent health observation could therefore
appear future-dated. Marketplace was rebuilt from the existing corrected
source; its 23 focused regressions passed, including that timing case and
genuinely future-probe rejection. The admission suite passed 16 tests, and
commerce build/lint passed. Final web rebuilding must consume these refreshed
workspace package outputs. No eligibility guard or mainnet gate was relaxed.

## Execution-evidence continuation — 11:50 UTC

The broader bounded review found **two candidates with read-only production
adapter acceptance**, not ten released/hireable listings. Mainnet
`releaseEnabled=false`, the 0.01 U cap and active 80-mainnet/20-testnet membership
remain unchanged. No database row, allowance, service, mainnet transaction or
funded-job notification was changed by this continuation.

### Discovery and historical coverage

The vendor audit now contains **1,917 identities, 273 completed detail reviews
and 147 protocol-verified profiles**. Additional finalized tokenURI reviews
cover 67 identities, with 63 readable registrations and 22 verified protocols.
After deduplication, the combined audit is **1,940 identities / 297 detailed /
150 protocol verified**. These are evidence-pool counts, not published supply.

The detail scheduler previously sliced the highest-ranked candidates before
skipping completed reviews. It now selects pending reviews first and gives
unreviewed identities a turn before failed ones. Bounded search expanded score,
activity, feedback and recent-registration pages, then used the vendor's
documented owner-address search to resolve submitting wallets. Rate limiting
remains an explicit external constraint; the scanner now stops that run on a
rate-limit/circuit-open response and retains its progress. Direct registry and
safe metadata reads supplied an independent fallback, including two small
bounded identity intervals around discovered services.

The earlier 2,210 history failures were reproduced at the old finalized block;
the exact same job IDs succeeded at a fresh explicit finalized block on both
configured and PublicNode RPCs. This was state pruning, not absent jobs. The
reader now refreshes the finalized block per batch and records each sampled
job's observation block. **All 12,000 IDs from 56,759 through 44,760 were read
successfully**, with zero wallet-read failures and zero job-read failures.
There were 59 submitting wallets, 32 matching identities available when that
inventory began. This does not claim coverage of older IDs or every identity
registered to a shared wallet.

Receipt lookup now examines all receipts in the exact submission block, so a
relayer transaction can be found. It requires a successful receipt, the exact
Commerce `JobSubmitted` provider/job/digest and the matching pinned Policy
event. The bounded pass reviewed **220 sampled historical submissions**.
An immutable fresh retrieval pass verified **58 manifests from 16 wallets**;
the remaining pointers were unavailable, unsafe, unsupported or mismatched.
The final count includes the production-supported `success: true` wrapper
that the older audit omitted. Every accepted manifest retains exact job,
chain, all three deployment contracts and committed Keccak checks.

Evidence: `provider-history-v2.json`, `provider-result-audit-v2.json`,
`direct-identity-audit.json`, and
`result-retrieval-audit-1788954227478.json` in the existing runtime directory.
The initial v2 receipt pass recorded 41 verified manifests, 156 unavailable
manifests, 18 unavailable RPC reads and five receipts not located. The later
58-manifest retrieval is a separate observation; failed reads are not promoted
to successful historical execution without that later hash verification.

### Two useful calculators, with release still pending

| Identity | Current signed U price | Exact historical result | Read-only acceptance |
| --- | --- | --- | --- |
| Grid planner 303779 | 0.01 | Job 56720, nine-level BNB/USDT plan with allocation, triggers and assumptions | Finalized wallet/card, fresh production quote and production result read passed |
| Loan-health calculator 341565 | 0.01 | Job 56756, health factor 2.425, liquidation/alert distances and repayment/top-up calculations | Finalized wallet/card, fresh production quote and production result read passed |

Both identities use chain 56 / registry
`0x8004a169fb4a3325136eb29fa0ceb6d2e539a432`, and different finalized provider
wallets. Their current cards declare distinct `/api/sellers/grid/a2a` and
`/api/sellers/loan-health/a2a` endpoints on
`https://bnb-agent-marketplace-ruby.vercel.app`. Both historical jobs remain
`SUBMITTED`; neither is represented as settled or as a BNBEra verified purchase.
The useful results are deterministic calculations on supplied historical
inputs, not current market observations or ongoing monitoring.

The grid submission transaction is
`0x5ca3e5845d5004167a14ac580f0ac99152743ac98851dc126b24e0f8e1140216`,
deliverable
`0xa634e4ba5fd843f3d51447d1842432bfddb3334be66aacb52d7c9ac994d04301`.
The loan-health submission transaction is
`0x5a7f2f67b0778ea82315aef81b98cbe9150a9bd13e274d82dc636c7fce562d5e`,
deliverable
`0x3c4cbac34fdecd56c7ea9ff377cfb414bf29d1159494bc8c4ef4f81bbb075f11`.

`candidate-review-1788954578264.json` contains their complete production-adapter
read-only acceptance, exact finalized blocks 120873080/120873082, card digests,
signed quote digests, receipt pointers and useful output. The quotes observed
here expire at 12:00:35/12:00:36 UTC and must be requested again for a hire.
The review deliberately marks both `hireable: false`: seller-specific task
forms/terms and listing publication, mainnet application acceptance and the
ten-agent target remain open. No membership rotation was justified by the
incomplete release gate.

These sellers require their actual `GRID_PLAN_V1` / `LOAN_HEALTH_V1` structured
task descriptions and exact published delivery terms, which were recovered
from their public on-chain jobs. Generic report requests are declined. The
audit can supply those bounded terms explicitly, and the production quote
audit now reuses the reviewed request terms rather than replacing them with a
generic request. Both sellers repeat `provider_address` outside the signed
description. The adapter accepts that one optional field only if it equals
the pinned provider; the signature must independently match the finalized
agentWallet, and unknown extra fields still fail.

### Remaining supply blockers

| Other retrievable-output group | Current blocker |
| --- | --- |
| ChainHelix 269223 / 269224 / 269226 / 269228 | Fresh wallet-bound quotes are 0.5 U each, 50× the cap; the sampled yield result is also an input error |
| BNB LP 265375 / BNB Grid 269233 | Fresh wallet-bound quotes remain 0.1 U, 10× the cap |
| LingoAI shared wallet / four services | Current 1 U responses lack the accepted signed binding and name a provider different from the finalized wallet; shared history is not four independent proofs |
| Monitoring 208760 | Ten retrievable historical outputs are generic completion or scheduling/claim acknowledgements, not evidence of a useful delivered monitoring report |
| BubbleAI 211183 | Current card still advertises localhost; public invocation is unverified |
| AllowanceLatch 338110 wallet | Result names RangeReset; attribution differs, and advertised runtime requires authentication |
| OptimAI 304169 / AgentCensus 270183 | Finalized registrations provide no accepted public A2A service/quote binding |
| Explainer and price-push wallets | Useful historical content exists, but bounded owner-address discovery did not establish their current ERC-8004 service identities |

Across 27 negotiation records, 22 signatures match finalized wallets. The
production adapter accepted 14 capped offers: the 12 older 0.0001 U offers
plus these two 0.01 U calculators. Only the two calculators currently have the
complete reviewed useful-result evidence described above. The other capped
sellers' unavailable results or acknowledgement-only outputs remain blockers.
This establishes an insufficient **observed qualified supply**, not proof
that no other qualifying mainnet agent exists.

### Protocol repair and verification

ChainHelix cards include JSON Schema inside A2A capability extensions. Like
the earlier Beefy response, valid transient protocol data exceeded the
persisted metadata depth guard. A2A now uses the same bounded in-memory schema
limits as MCP, then checks its small allowlisted summary against the unchanged
persisted guard. Credential fields, excessive depth/bytes, invalid cards and
unsafe invocation targets still fail. No A2A work is invoked by this check.

Validation: ingestion **139 tests**, commerce **118 tests**, and the two
pending-selection regressions passed. Both changed packages passed lint,
typecheck and build. All changed audit scripts passed strict standalone
TypeScript checking and lint. The two live candidate reviews used the actual
production quote/result adapter. No preview/web process was restarted; the
coordinator owns any final web build and browser acceptance using the updated
workspace package outputs. No commit or push was made.

## Full-history and independent-census continuation — 2026-09-09 12:17 UTC

This supersedes the earlier bounded 12,000-job counts. The read-only sweep
covered **all 56,762 jobs, IDs 1–56,762**, including a three-job head refresh,
with **zero failed job reads and zero failed candidate-wallet reads**. Each
small batch used an explicit freshly finalized block; this is not represented
as one atomic historical-state snapshot. There were 55,436 submitted/completed
job observations across **71 provider wallets**. The union of 8004scan,
finalized direct registrations and an independent public census contains
**2,458 unique candidate IDs, 335 completed detailed reviews and 164 verified
protocol identities**. Finalized wallet matching resolves 51 submitting
wallets to 67 candidate identities; a shared wallet is not service attribution.

The additional discovery source is the operator-published
[Brain Plaza census](https://brainonbnb.com/api-agents.json). Its 871 IDs were
used only as leads: all 871 owners and agentWallets were independently re-read
from the official finalized chain-56 registry with zero failed identity reads.
The source is not an admission authority. `census-discovery.json` records its
11:19 UTC source observation and raw SHA-256
`23118d2934453def893ccc13cb8becb19ceac77db7c85393d4da91206e9ee336`.
8004scan's current [OpenAPI](https://api.8004scan.io/openapi.json) confirmed
that list search defaults to active identities. An explicit, tested
`is_active=any` discovery option now permits inactive-inclusive owner/text
search without changing normal listing defaults or admission checks. The
scan stops on rate limiting rather than repeatedly consuming failed requests.

### Exhausted historical evidence within this boundary

All **244 representative submissions** were receipt-reviewed. This includes
every submitted/completed job from 69 of the 71 provider wallets. The two
high-volume wallets were bounded to 20 samples each: the unbound Pieverse
self-introduction wallet has 55,048 submissions, while `buyback&burn` 158888
has 184 and currently cannot resolve its registration metadata. Neither has
the public, identity-bound in-cap execution evidence required for release.

The final receipt pass records 42 immediately hash-valid manifests, 170
unavailable manifests, 20 non-JSON/incompatible Policy pointers and 12 cases
without the required matching pinned submission/Policy receipt. The earlier
18 “RPC unavailable” classifications were traced to pointer JSON decoding,
not unavailable chain reads; stage-specific diagnostics now distinguish them.
Already-reviewed result IDs no longer consume the next 250-result batch cap.
History and result checkpoints are atomically replaced, and history supports
explicit resume plus a guarded full-scan head refresh.

Fresh targeted retrieval at 12:16 UTC verified **59/59 previously resolved
manifests across 16 wallets**, including the new ChainHelix health-monitor job
56761. This is exact commitment verification, not a claim that all 59 outputs
are useful. Evidence: `result-retrieval-audit-1788956211913.json`; the earlier
full-pointer audit and all immutable retrieval snapshots remain available.

### New identity resolutions did not yield ten qualified sellers

- TermiX Advantage Report Explainer **270213** now has finalized identity,
  public A2A, useful matching job 56646 and a fresh wallet-bound quote. The
  quote is **0.1 U**, ten times the cap, so it is not admitted.
- **RangeReset 324818** resolves the previously ambiguous RangeReset output
  under the AllowanceLatch wallet. Its advertised runtime, like LatticeLatch
  331131, requires OAuth2 client credentials and returns 401 publicly. A public
  card is not a public actionable quote. No credentials were requested or used.
- Hevo's four service identities return **8–10 U** quotes whose signatures do
  not match the finalized agentWallet; the service identities share a wallet
  and no matching submitted history was found. Yieldrouter 341225 quotes
  **0.1 U**; IVL Rebalancer 341628 quotes **1 USDT**, the wrong payment asset.
- LingoAI Personal Holon adds a fifth shared-wallet identity, not an independent
  signed execution proof. Its response remains unsigned, 1 U, and names a
  provider different from the finalized agentWallet.
- New marketplace-operated rebalance/yield identities 341563/341564 have
  verified public A2A cards but no submitted history in the complete sweep.
  Old custom ERC-8183 registrations and newer Bazar Contract Safety 342133
  do not advertise an accepted public A2A binding. Their extra historical
  submissions did not produce newly useful accepted manifests.
- The price-push wallet still has no resolved official identity despite
  inactive-inclusive owner search and the independent finalized census.

Across **34 negotiation records**, 23 signatures match finalized wallets.
The actual production adapter again accepted **14/14 capped offers**. Only
**303779 and 341565** satisfy the complete reviewed identity + public A2A +
fresh capped canonical-U signature + useful exact-hash historical-result
combination. `candidate-review-1788956074251.json` rechecks both with the
production quote/result adapter at finalized blocks 120876400/120876406.
The refreshed quotes expire around 12:28 UTC and must be refreshed for use.

**Outcome: the observed qualified supply is still 2, not the required 10.**
No paid work or funded notification was invoked to manufacture missing
history. No cap, signature, finalized identity, endpoint, receipt, deployment,
usefulness or hash requirement was relaxed. Mainnet release stays disabled;
both reviewed calculators remain `hireable: false`, and seller-specific
forms/listings are deliberately not integrated before the ten-agent gate.
No directory membership, database/service data, wallet state or allowance was
changed by this continuation. This is a precise current evidence shortfall,
not a proof that no other eligible agent can ever exist on BSC.

Validation after the expanded tooling: ingestion **140 tests**, commerce
**118 tests**, pending-selection **3 tests**; ingestion lint, typecheck and
build; strict TypeScript and lint for the changed audit scripts; and
`git diff --check` all passed. Preview restart and browser acceptance remain
with the coordinator. No commit or push was made.

## Production MVP admission update

The user-authorized policy now permits any exact positive mainnet amount below
the ERC-20 unlimited-approval sentinel, with explicit token/address/decimals,
chain, amount, task and risk confirmation. The optional buyer warning threshold
defaults to 10 U and never rejects an offer merely for price. The separate
testnet reference-provider/operator cap remains unchanged. Mainnet canonical
terms validation and browser create/register/budget/approve/fund preparation
both accept the observed 0.1/0.5 U offers; no silent downstream 0.01 U cap remains.

Ten independent finalized ERC-8004 identities now have additive reviewed
versions, current public A2A bindings and fresh task-specific signed U offers:

| Agent | Last observed U | Useful exact-hash historical job | Readiness tier |
| --- | ---: | --- | --- |
| 303779 native grid | 0.01 | 56720 | Historical result verified |
| 341565 native loan health | 0.01 | 56756 | Historical result verified |
| 269223 ChainHelix rebalancer | 0.5 | 56615 | Historical result verified |
| 269224 ChainHelix grid | 0.5 | 56743 | Historical result verified |
| 269226 ChainHelix yield | 0.5 | — | Protocol-ready, history unverified |
| 269228 ChainHelix health | 0.5 | 56734 | Historical result verified |
| 265375 LP report | 0.1 | 56591 | Historical result verified |
| 269233 grid report | 0.1 | 56633 | Historical result verified |
| 270213 TermiX explainer | 0.1 | 56646 | Historical result verified |
| 341225 yieldrouter | 0.1 | — | Protocol-ready, history unverified |

These are observed prices, not current binding quotes or delivery guarantees.
Every buyer quote rechecks finalized identity, registered card, supported public
endpoint, exact signature/task/chain/Commerce/currency and current freshness.
Every wallet call requires a durable once-only dispatch claim; server-side
mainnet SDK writers remain disabled. No mainnet hire, funded notification or
paid execution was invoked by the operator during this acceptance work.

The independent review corrected health proof 56761 (a hash-valid input error)
to **56734**, a successful HF 2.4 report. Its current canonical manifest matched
onchain digest `0xacb4ddbd81111528e8120d5d5709c46ad90ad1a7a63e3b665a1770a31bb44fc3`
at finalized block 120884027. The retained original error evidence is not
misrepresented as useful work. The eight historical proofs establish past
service-attributed output, not quality guarantees for a new task.

Fresh backup before promotion: `pre-mainnet-ten-seller-1788958669184.dump`
(32,535,740 bytes, 0600). Before review correction:
`pre-mainnet-review-correction-1788960655387.dump` (33,179,385 bytes, 0600,
374 restore-catalog entries). Both are under `.runtime/mainnet-supply-upgrade/`.
Immutable `seller-integration-*.json` records retain before-state/version,
signed offers and reviewed results. Promotions are transactional and recheck
listing/verification/authority/current-version under row lock; primary-source
fallback membership changes are separately committed, logged and reversible.
Archived membership replaces selected slots without deleting any identity,
history or service. The visible directory remains 100 profiles.

### Payment assets and protocol facts

`config/mainnet-payment-assets.review.json` records independent U, BSC USDT and
BSC USDC implementation/decimals/transfer review. **This official APEX Commerce
has one fixed global U paymentToken. USDT/USDC are not an executable rail on
that contract.** Their offers remain unavailable until a separately verified
matching Commerce deployment exists; no token substitution, swap or invented
deployment is allowed. All three reviewed BSC assets use 18 decimals. U is
upgradeable and issuer-pausable/freezable; pin its implementation and actual
nonzero proxy admin. New payment calls check token/Commerce/Router pause,
participant freezes, zero reviewed platform fee, balance and exact finite
allowance. A time-limited Policy dispute remains available despite unrelated
token/Commerce pauses. Expiry refund ignores Commerce/Router pause but still
requires a transferable token. Exact approval is consumed by funding; a buyer
who stops after approval should revoke that specific spender allowance in
their wallet rather than assume cancelling a screen revoked an onchain grant.

APEX's seven-day settlement is permissionless and defaults to approval without
the rejection quorum, even after a buyer dispute. Local approval is **not an
onchain veto**. This is explicitly disclosed before funding. Expiry includes
the provider's estimated work time, a margin and the policy window. Public
terminal recovery accepts only finalized matching Commerce/Router/Policy
events. Completion additionally binds the stored SHA-256, chain Keccak, full
provider/version/buyer and canonical finalized submission. It never fabricates
a buyer approval or wallet operation. Expired/rejected full refunds update
My Hires through a receipt-backed transactional projection.

### Acceptance checkpoint and publishing

Commerce 123 tests passed, including the 0.5 U canonical hire-intent regression;
the final web suite passed 237 tests across 42 files, including the published
ten-seller task examples, six terminal-finality/result-binding tests, seven
same-origin cases, correct forbidden HTTP responses, production My Hires
mainnet defaults and actionable-first relevance sorting.
Real retained-Postgres refund projection smoke passed expiry/rejection, replay
and mismatched-hash denial, with all fixture rows rolled back and absence
verified. Commerce/web lint, web typecheck and ingestion typecheck passed.
Worker reverse-proxy tests passed 2/2. Final build/browser release acceptance
is coordinated separately; no public mainnet spending canary is claimed.

`scripts/marketplace-mainnet-release-sync.ts` has an explicit refresh-only mode
for an approximately one-minute supervised schedule. It reads finalized
identity and cards, updates expiring health evidence, and does not negotiate,
notify or execute paid work. Release remains independently controlled by the
checked-in chain-56 flag and authenticated HTTPS runtime configuration.
Closing only that new-hire flag preserves existing-job reads and recovery;
the enabled deployment pins and explicit mainnet runtime switch must remain
configured. New-hire preparation and each new-funding wallet dispatch enforce
the flag on the server, not merely through disabled buttons. Auth/commerce
JSON mutations reject cross-origin (including sibling-subdomain) requests;
authentication bodies are bounded to 64 KiB and eight seconds.
See `docs/WORKERS-DEPLOYMENT-HANDOFF.md` for the dormant Worker template and
the still-required authenticated Cloudflare deployment/DNS/TLS acceptance.

### Narrowed final delivery scope

The final continuation is limited to quote/task tests, publication refresh,
production build, documentation and Workers deployment configuration. It does
not promote the mainnet release flag or claim a new paid mainnet canary.
The 2026-09-09 refresh reverified all ten finalized identities and registered
A2A cards and committed their health evidence with `refreshOnly: true`,
`deleted: 0`, and `chainWrites: false`. The first attempt without the explicit
mainnet runtime flag failed closed before admission; the correctly configured
retry succeeded. Health evidence expires after two minutes and is not a fresh
signed quote. Buyer negotiation remains mandatory.

`ops/marketplace-cron/mainnet-sellers.sh` is a dormant bounded refresh wrapper:
local flock, PostgreSQL advisory lock, 110-second timeout and private runtime
logs; no quotes, funded notifications, paid execution or deletion. It loads
the trusted operator environment without printing it, including resolved
database URL interpolation. No cron installation or existing preview restart
is included. A0 must review release and schedule installation independently.

Final narrowed-scope acceptance at 14:07 UTC: production `next build` passed
using `BNBERA_NEXT_DIST_DIR=.next-mainnet-mvp-acceptance-20260909`, chain 56,
production runtime and the intended HTTPS public origin. Web 237/237 and
commerce 123/123 tests, both packages' lint/typecheck, Worker 2/2 tests,
wrapper `bash -n`, and `git diff --check` passed. The wrapper itself completed
a second ten-seller refresh successfully. No recurring schedule was installed.

The built candidate runs separately on loopback port 3024; port 3022 was not
restarted. HTTP smoke checks returned 200 for session reads, My Hires,
favicon and the 100-profile collection (80 mainnet / 20 testnet). Cross-origin
SIWE challenge and hire requests returned 403 `REQUEST_ORIGIN_INVALID`.
At 390 px, My Hires showed BNB mainnet 56 and WalletConnect selection without
horizontal overflow or an application error. This is a local built-artifact
check, not public-domain WalletConnect pairing or mainnet paid execution.
The only build warning was outdated baseline-browser-mapping data.

Checked-in mainnet `releaseEnabled` remains false. Public Cloudflare
deployment/DNS/TLS, authenticated stable origin setup, A0 release approval,
and real user-wallet mainnet acceptance remain unproven and are not implied
by these successful checks. No commit, push or operator mainnet spend occurred.
