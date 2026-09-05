# T4 ERC-8183 feasibility — BSC testnet

Status: read-only feasibility evidence and implementation handoff. No wallet,
signer, transaction, deployment, payment, feature enablement, or secret was
used.

- Checkout: `/home/ubuntu/bnbera-task-t4`
- Branch: `task/t4-erc8183-feasibility`
- Common base/head at start: `5db33273f66672ca6fd2e3547345c3b7a719cd5e`
- Task/gate: T4 read-only feasibility for G2; T3/G1 acceptance is still a prerequisite
- Owned change: this evidence/plan document only. `config/standards.lock.json` remains coordinator-owned and unchanged.
- Observation: 2026-09-05 UTC, BSC testnet chain ID `97`

## Decision

The simplest single rail is the BNB Chain APEX v1 ERC-8183 stack on BSC
testnet. The official APEX address registry at commit
`b40b18011407ba13516661d3784bcb727a0c7794` is authoritative when its README
table disagrees with it.

| Role | Read-only candidate | Status |
| --- | --- | --- |
| Commerce proxy (`AgenticCommerceUpgradeable`) | `0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de` | proven from official address registry, code and ERC-1967 slot |
| Commerce implementation | `0x153783ddbdf5233c591965f04644b1df2d1a7815` | proven from official address registry and proxy slot |
| Evaluator Router/hook proxy (`EvaluatorRouterUpgradeable`) | `0xd7d36d66d2f1b608a0f943f722d27e3744f66f25` | proven from official address registry, code and ERC-1967 slot |
| Router implementation | `0x40c0254610d92f1eb9c2d7d5d2114bc4c99d935e` | proven from official address registry and proxy slot |
| Active OptimisticPolicy | `0xd6a4217588f6b1f5657a92a3e94e6422ad771cea` | proven: live Router whitelist is `true` |
| Payment token (`U`) | `0xc70b8741b8b07a6d61e54fd4b20f22fa648e5565` | address/18 decimals proven; issuer and transfer semantics remain unresolved |

The README table candidate `0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6` is
not the active policy: the live Router reports `policyWhitelist(candidate) =
false`, while `policyWhitelist(0xd6a421...) = true`. Both policy contracts
have code and point at the same Commerce/Router, but their immutable policy
parameters differ (`900s/quorum 1/2 voters` versus `86400s/quorum 2/3
voters`). Registering a job with the README candidate would fail. This
resolves the existing policy-address conflict without guessing.

The payment token must not yet be described as USDC. The pinned APEX address
registry calls it `U`; the live contract returns `name() = United Stables`,
`symbol() = U`, and `decimals() = 18`, whereas the APEX README table labels it
“USDC on testnet”. The official APEX sources provide no issuer/source or
transfer-semantics proof for this address. A bytecode hash and metadata call do
not prove absence of fee-on-transfer, rebasing, blocklist, or other behavior
that the APEX kernel explicitly excludes. Keep commerce disabled until an
authoritative token source/issuer review and the coordinator’s product bounds
are recorded. Do not substitute another token or deploy a replacement token.

## Official sources and ABI pins

Only the following primary sources were used:

- ERC-8183 draft at the locked ERCs commit:
  [erc-8183.md](https://github.com/ethereum/ERCs/blob/a078cab5cc8e9581c15f76c091ed96eed28f02f7/ERCS/erc-8183.md)
- APEX repository at commit
  `b40b18011407ba13516661d3784bcb727a0c7794`:
  [README](https://github.com/bnb-chain/apex-contracts/blob/b40b18011407ba13516661d3784bcb727a0c7794/README.md),
  [addresses.ts](https://github.com/bnb-chain/apex-contracts/blob/b40b18011407ba13516661d3784bcb727a0c7794/scripts/addresses.ts),
  [Commerce source](https://github.com/bnb-chain/apex-contracts/blob/b40b18011407ba13516661d3784bcb727a0c7794/contracts/AgenticCommerceUpgradeable.sol),
  [Router source](https://github.com/bnb-chain/apex-contracts/blob/b40b18011407ba13516661d3784bcb727a0c7794/contracts/EvaluatorRouterUpgradeable.sol),
  [Policy source](https://github.com/bnb-chain/apex-contracts/blob/b40b18011407ba13516661d3784bcb727a0c7794/contracts/OptimisticPolicy.sol)
- Official APEX ABI files at the same commit:
  [Commerce ABI](https://github.com/bnb-chain/apex-contracts/blob/b40b18011407ba13516661d3784bcb727a0c7794/abis/AgenticCommerceUpgradeable.json),
  [Router ABI](https://github.com/bnb-chain/apex-contracts/blob/b40b18011407ba13516661d3784bcb727a0c7794/abis/EvaluatorRouterUpgradeable.json),
  [Policy ABI](https://github.com/bnb-chain/apex-contracts/blob/b40b18011407ba13516661d3784bcb727a0c7794/abis/OptimisticPolicy.json)

Using the standards-lock rule `sha256(JSON.stringify(JSON.parse(abiBytes)))`:

| ABI | Canonical SHA-256 |
| --- | --- |
| `AgenticCommerceUpgradeable.json` | `4d8ac8b406dff522f1b9066eb3e00e2c8e491d4d09df2564ede124220b623ede` |
| `EvaluatorRouterUpgradeable.json` | `75194cd4777b17459108a69da2e65c15dc00b2b8c7fe340794d28dceeb3d3329` |
| `OptimisticPolicy.json` | `843d484a26c8a21271df31078347cdb5bcfad705cd69bed729c2773bb392cc62` |

The official APEX Hardhat source pins Solidity `0.8.28`, optimizer enabled
with 200 runs, `viaIR: true`, and EVM `cancun`. These are source/toolchain
pins, not a claim that BNBEra should deploy or upgrade this stack.

## Read-only RPC evidence

Endpoint: `https://data-seed-prebsc-1-s1.bnbchain.org:8545` (official BSC
testnet endpoint used only for JSON-RPC reads). At `2026-09-05T22:46:35Z`,
`eth_chainId` returned `0x61` (97). The endpoint returned:

- latest block `129337515`, hash
  `0x38f7067fac28bfa774dfb26cfd71a4f110c69af0b58278e8b828ab1a484f15e4`
- finalized block `129337508`, hash
  `0x237df94dd072ce341f996204040cab2ae6dbdd36150f849293b28004661a97c1`

`eth_getCode`, ERC-1967 implementation-slot reads, and view calls below were
made at `latest`. This RPC exposes finalized block metadata but returned
`missing trie node` for historical `eth_getCode`/state at the `finalized` tag;
that limitation is recorded rather than treated as finality proof. No state
was changed.

Runtime code at `latest`:

| Address role | Bytes | Runtime SHA-256 |
| --- | ---: | --- |
| Commerce proxy | 130 | `a04dc24cdccd0690eae672f2ce21d4b2188c15bc30000b783da51d6bbd6ea13d` |
| Commerce implementation | 10892 | `df9996ee849157d112de9ca9eff870ddf30bd51d1c9b785669887797c697fd10` |
| Router proxy | 130 | `a04dc24cdccd0690eae672f2ce21d4b2188c15bc30000b783da51d6bbd6ea13d` |
| Router implementation | 6685 | `41ff045ec43932e4f28d25146edaf0a5c1d2425f3dab826c88afa52ec8ab1fa1` |
| Active policy `0xd6a421...` | 4413 | `4a17125e2600679a15b88acf8cd481f442d8056fd38da709a4a774e621258ed5` |
| README policy `0x4f4678...` | 4413 | `eb46e34e186d05487a8cd69f9f571a3a5a58bd93541bc4e56a4b3c6ac8dc2816` |
| Payment token | 2007 | `1076ca0b58e992bba671ddbde6a9d96685c712113eee50caa891c458fc2b48a9` |

The EIP-1967 implementation slot
`0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc`
returned:

```text
Commerce proxy -> 0x153783ddbdf5233c591965f04644b1df2d1a7815
Router proxy   -> 0x40c0254610d92f1eb9c2d7d5d2114bc4c99d935e
```

Read-only view calls returned:

```text
commerce.paymentToken()       = 0xc70b8741b8b07a6d61e54fd4b20f22fa648e5565
commerce.platformFeeBP()      = 0
commerce.platformTreasury()    = 0x1001b2c085345f388778a975648aa50bcfd0d134
commerce.owner()               = 0x1001b2c085345f388778a975648aa50bcfd0d134
commerce.paused()              = false
commerce.MAX_EXPIRY_DURATION() = 31536000
commerce.jobCounter()          = 1029
router.commerce()              = 0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de
router.owner()                 = 0x1001b2c085345f388778a975648aa50bcfd0d134
router.inflightJobCount()     = 301
activePolicy.commerce()       = 0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de
activePolicy.router()         = 0xd7d36d66d2f1b608a0f943f722d27e3744f66f25
activePolicy.disputeWindow()  = 900
activePolicy.voteQuorum()     = 1
activePolicy.activeVoterCount() = 2
router.policyWhitelist(active) = true
router.policyWhitelist(README)  = false
token.decimals()               = 18
token.name()                   = United Stables
token.symbol()                 = U
token.DOMAIN_SEPARATOR()       = 0xbfdacda9e354449fe1236dbd82c99a502d8fb126472b59cdd770a76099bede17
```

The stale policy’s read-only values were `disputeWindow = 86400`,
`voteQuorum = 2`, and `activeVoterCount = 3`; its `commerce()` and `router()`
still pointed at the live pair. The whitelist result, not a guessed address,
selects the active policy.

## Protocol flow and constraints

The official APEX Router is both the ERC-8183 evaluator and the required hook.
The selected policy is bound by `router.registerJob` and gates funding and
submission notifications. The minimal useful flow is:

1. Client calls `commerce.createJob(provider, router, expiredAt, description, router)`.
   APEX requires `expiredAt > now + 300s`, `expiredAt <= now + 31536000`, a
   non-zero evaluator and a non-zero ERC-165 `IACPHook`.
2. Client calls `router.registerJob(jobId, 0xd6a421...)`. Router verifies Open
   state, client caller, evaluator/hook equal to Router, and the policy
   whitelist.
3. Client or provider calls `commerce.setBudget(jobId, amount, "0x")`; client
   explicitly approves the exact token amount to the Commerce proxy and calls
   `commerce.fund(jobId, expectedBudget, "0x")`.
4. Provider performs the real off-chain task, stores the exact result bytes and
   URL, hashes those bytes to a `bytes32` deliverable, and calls
   `commerce.submit(jobId, deliverable, "0x")`. The policy rejects submissions
   too close to expiry to fit its 900-second dispute window.
5. Buyer verifies the useful result in BNBEra. Only an authenticated buyer
   approval may authorize `router.settle(jobId, evidence)`; the backend must
   never auto-approve. The Router pulls the policy verdict and calls Commerce
   `complete` or `reject`.
6. On no-submit/expiry, anyone may call `commerce.claimRefund(jobId)` after
   `expiredAt`; anyone then calls `router.markExpired(jobId)` to reconcile
   Router bookkeeping. A dispute calls policy `dispute`, voter(s) call
   `voteReject`, and a quorum verdict causes Router settlement to reject/refund.

The chain’s `settle`/`claimRefund` success is not proof of useful work. BNBEra
must retain the result URL, exact output digest, buyer approval, confirmed
receipt and protocol event before marking a marketplace job completed.

Product values still requiring coordinator approval are `confirmationThreshold`,
`minExpiryLeadSeconds`, `maxExpiryHorizonSeconds`, `minBudgetAtomic`, and
`maxBudgetAtomic`. Only the kernel’s minimum lead (`>300s`), maximum horizon
(365 days), policy dispute window (900s), token decimals, addresses and ABI
source pins are externally proven here. Do not invent budget limits or enable
the deployment pin from this document.

## Implementation-ready backend contract

Keep the existing `@bnbera/agent-commerce` lifecycle/repository boundary and
the full ERC-8004 identity. `erc8183JobKey` is only the protocol tuple
`(chainId, commerceContract, jobId)`; every application job also stores
`(namespace, chainId, identityRegistry, agentId)`, `agentVersionId`, quote
digest and task-input digest in the existing commerce projection.

### Read/quote API

```ts
type HireQuoteRequest = {
  identity: {
    namespace: string;
    chainId: 97;
    identityRegistry: `0x${string}`;
    agentId: string;
  };
  agentVersionId: string;
  providerAddress: `0x${string}`;
  taskInputDigest: `0x${string}`;
  priceAtomic: string;
  quoteExpiresAtUnix: number;
};

type HireQuote = HireQuoteRequest & {
  quoteId: string;
  commerceContract: `0x${string}`;
  routerContract: `0x${string}`;
  policyContract: `0x${string}`;
  paymentToken: `0x${string}`;
  paymentDecimals: 18;
  evaluatorAddress: `0x${string}`; // Router
  hookAddress: `0x${string}`;      // Router
  issuedAtUnix: number;
  deploymentPinDigest: string;
};

type ChainOperation = {
  operationId: string;
  idempotencyKey: string;
  kind: "create" | "register" | "set_budget" | "approve" | "fund" |
    "submit" | "settle" | "claim_refund" | "mark_expired";
  jobKey?: { chainId: 97; commerceContract: string; jobId: string };
  signerRole: "client" | "provider" | "system";
  transactionHash: `0x${string}` | null;
  status: "awaiting_signature" | "submitted" | "confirmed" | "reverted" |
    "unknown" | "reconciled" | "manual_review";
};
```

`POST /api/hire/quote` is read-only and returns the exact pinned terms.
Mutation endpoints first persist a request-digest/idempotency record and return
wallet calldata or an operation handle; the caller submits through its own
wallet. No private key, raw session, credential, or signed payload is stored
in application data. `create` parses the confirmed `JobCreated` event to get
the numeric job ID; it must not predict `jobCounter` under concurrency.

Persist each operation before submission, including operation kind, signer
role, chain/contract/job identity, request digest, transaction hash, receipt
status, block/hash/log index, and sanitized failure code. Unique idempotency
keys replay the original operation; reusing a key with a different request is
an error. If a receipt is unknown, reconcile receipt + `getJob` + relevant
events before any retry. Never blindly retry `approve` or `fund`.

### Persistence and state mapping

Use `commerce_jobs` for buyer/provider/quote/task/result projection,
`erc8183_jobs` for canonical protocol terms and state, and
`erc8183_job_events` for append-only chain observations. Add one small
PostgreSQL operation table for the pre-send/idempotency fields above; the
existing tables have no durable row for `approve`, `register`, or unknown
transaction attempts. Keep the operation table keyed by the canonical
protocol job identity and protect it with a unique idempotency constraint.

The protocol mapping is:

```text
local draft/quoted -> create confirmed -> Open
Open + register + budget + buyer approval + fund confirmed -> Funded
Funded + provider submit/result digest confirmed -> Submitted
Submitted + buyer approval + Router verdict/receipt confirmed -> Completed or Rejected
Funded/Submitted + expiry refund confirmed + Router markExpired -> Expired
```

Only a confirmed receipt and matching `Job*` event/getJob state may advance a
canonical state. A page reload or worker restart reconstructs the operation
and job from PostgreSQL and chain reads; it does not resend a transaction.
Unknown/reverted/manual-review states remain visible and block duplicate
charge. Buyer approval is a separate authenticated record and is never
inferred from a quote, HTTP 200, funding acknowledgement or provider submit.

### Result and fixture boundary

T3 must select the real published agent and prove its invocation schema before
T4 chooses a paid task. The smallest intended fixture is a read-only
health-factor report, but the agent’s actual advertised input/output schema
wins. Store the exact public result bytes, URL/access policy, output digest,
observed block/source time and receipt references. A funding acknowledgement
or HTTP 200 without a useful result is not completion.

## Focused checks and acceptance

Read-only checks completed:

1. Official-source address and ABI extraction at the locked APEX commit.
2. Canonical ABI SHA-256 calculation for Commerce, Router and Policy.
3. `eth_chainId`, latest/finalized block metadata, `eth_getCode` for every
   configured address, ERC-1967 implementation-slot reads, and view calls for
   token/Commerce/Router/Policy linkage and policy whitelist.

Before a paid canary, T4/T5 must add:

- quote/input validation (full identity/version, pinned token/decimals,
  amount/expiry bounds, digest and no-secret payloads);
- idempotent create/register/approve/fund and operation persistence;
- receipt timeout -> unknown -> chain reconciliation, with no blind retry;
- useful-result digest/URL and explicit buyer approval before settlement;
- wrong chain/token/evaluator/hook/recipient/amount, duplicate submit/fund,
  policy rejection, no-submit expiry/refund and Router `markExpired` cases;
- fresh/legacy disposable migration checks, page reload and worker restart;
- one real authorized testnet cycle with receipt/result evidence.

The current branch performed no paid or simulated live success. G2 remains
blocked until T3/G1 is accepted, the token issuer/transfer semantics and
product pin bounds are reviewed, and the coordinator obtains explicit
authority plus a funded test wallet for the canary (`BSC_TESTNET_PRIVATE_KEY`
is the later signer name; its value was neither requested nor used here).

The retained PostgreSQL database is read-only for this task. No migration,
commerce/job insert, or retained-data test was run. Any future DB-backed test
must use an independent disposable database/container and prove fresh/legacy
migration and restart behavior before a coordinator proposes a retained
migration.

## Proposed coordinator-only lock review (not applied)

After the blockers are resolved, the coordinator may review these values for
`networks["97"].erc8183`, all sourced from the official files and the reads
above:

```json
{
  "specRevision": "a078cab5cc8e9581c15f76c091ed96eed28f02f7",
  "apexRevision": "b40b18011407ba13516661d3784bcb727a0c7794",
  "commerceProxy": "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de",
  "routerProxy": "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25",
  "policy": "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea",
  "paymentToken": "0xc70b8741b8b07a6d61e54fd4b20f22fa648e5565",
  "paymentDecimals": 18,
  "commerceAbiHash": "4d8ac8b406dff522f1b9066eb3e00e2c8e491d4d09df2564ede124220b623ede",
  "routerAbiHash": "75194cd4777b17459108a69da2e65c15dc00b2b8c7fe340794d28dceeb3d3329",
  "policyAbiHash": "843d484a26c8a21271df31078347cdb5bcfad705cd69bed729c2773bb392cc62",
  "implementationAddresses": {
    "commerce": "0x153783ddbdf5233c591965f04644b1df2d1a7815",
    "router": "0x40c0254610d92f1eb9c2d7d5d2114bc4c99d935e"
  },
  "policyParameters": { "disputeWindowSeconds": 900, "voteQuorum": 1 },
  "verificationStatus": "verified-read-only-address-source-bytecode-linkage; token-source-review-pending"
}
```

Do not add `confirmationThreshold`, expiry lead, or budget bounds from this
artifact; they require an explicit product decision and coordinator review.
