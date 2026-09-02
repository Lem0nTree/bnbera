# `@bnbera/agent-commerce`

Fail-closed ERC-8183 job-commerce contracts for BNBEra.

This package is the application boundary around the official ERC-8183 job
escrow lifecycle. It keeps the protocol state (`open`, `funded`, `submitted`,
`completed`, `rejected`, and `expired`) separate from BNBEra's internal
commerce status. It provides:

- independently pinned BSC chain, commerce contract, payment token, token
  decimals, budget, and expiry validation;
- immutable per-job deployment snapshots (spec revision, ABI, evaluator,
  confirmation, expiry, and budget bounds) required for later validation;
- actor-aware create, provider assignment, funding, submission, evaluator
  completion, rejection, and post-expiry refund transitions;
- append-only event payloads with canonical digests and transaction context;
- idempotent repository contracts with stale-state and duplicate-event
  handling; and
- reconciliation records for provisional, orphaned, or otherwise ambiguous
  chain observations.

`InMemoryErc8183Repository` and `assertErc8183Transition` require an enabled
deployment pin at their boundary. The repository's `transaction` unit of work
commits the job, append-only event, and idempotency record together and
serializes rollback-capable transactions; a
production adapter must preserve that database transaction/CAS behavior.
Repository creation timestamps come from its trusted server/chain clock, and
same-state reconciliation accepts only addresses configured as authenticated
system/reconciler actors. `appendEvent` is replay-only: new events must be
created by a validated lifecycle transition so state, actor, chain identity,
and event contents cannot be bypassed.

The checked-in in-memory repository and tests are deterministic contract
fixtures. A production adapter must implement the same uniqueness and
compare-and-set behavior in a PostgreSQL transaction and must verify receipts
against the standards lock before updating state.

The current lock is a candidate and leaves ERC-8183 deployment addresses
unresolved. Consequently, `parseEnabledDeploymentPin` intentionally rejects
the disabled/incomplete lock; this package does not perform chain writes or
claim a live testnet deployment.

Reference specification: [EIP-8183](https://eips.ethereum.org/EIPS/eip-8183).
The optional BNB policy/router deployment reference is [APEX contracts](https://github.com/bnb-chain/apex-contracts);
the candidate lock deliberately leaves disputed policy addresses unresolved.
