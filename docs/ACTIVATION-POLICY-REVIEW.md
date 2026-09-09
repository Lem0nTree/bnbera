# Activation panel policy review — 2026-09-09

T5/G2 presentation review against integrated `main` at
`ea349e286db117d6f1b4f58e43115ada09daf014`. PRs #41, #45, #46 and #47
merged without conflicts. Both #45 CI runs passed after correcting two test
typing errors and integrating the other three PRs.

## Policy and seller findings

The mainnet offer selects APEX OptimisticPolicy
`0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5`, whose reviewed immutable
window is 604800 seconds. This is a property of the selected deployment,
not a mandatory seven-day rule for every APEX evaluator or ERC-8183 job.
The installed Altana SDK's approval action calls the router's settlement
method; it provides no early buyer-payout override.

The pinned [OptimisticPolicy source](https://github.com/bnb-chain/apex-contracts/blob/b40b18011407ba13516661d3784bcb727a0c7794/contracts/OptimisticPolicy.sol)
starts the window at on-chain submission. `check` approves after the window
unless a buyer dispute reached its rejection quorum. Sufficient authorized
votes can produce rejection earlier. A dispute alone is not a payout veto;
an explicit settlement transaction remains necessary. The
[router](https://github.com/bnb-chain/apex-contracts/blob/b40b18011407ba13516661d3784bcb727a0c7794/contracts/EvaluatorRouterUpgradeable.sol)
allows permissionless settlement subject to the selected policy.

All ten catalog seller cards returned HTTP 200 during this review. This is
card availability, not proof of a fresh quote or delivery. The
[Grid card](https://bnb-agent-marketplace-ruby.vercel.app/grid/.well-known/agent-card.json)
offers deterministic calculations without trading or custody. The
[Loan Health card](https://bnb-agent-marketplace-ruby.vercel.app/loan-health/.well-known/agent-card.json)
offers one report from supplied inputs, without monitoring, transactions or
custody. Their terms agree with the corresponding catalog bindings. The
[seller's job validation](https://github.com/gilbertsahumada/bnb-agent-marketplace/blob/cc9bd3a79756e6bc8bfda2e48b6ea364eddaaf85/src/mainnet/hosted-seller-repository.ts)
requires its exact mainnet router and policy. Broader card capabilities do
not change the scope of a particular signed offer.

## Presentation corrections

- Show deliverables, quality requirements and any success criteria from the
  exact signed contract task before the raw JSON disclosure. Never replace
  saved terms with current catalog defaults; show an explicit fallback if
  the display projection cannot be parsed.
- Explain immediate access to verified delivery, delayed provider payout,
  permissionless settlement and early quorum-based rejection separately.
- Rename the combined action to “Approve and request settlement.” Explain
  that checking the review box does not persist acceptance or release funds.
- Label the existing timestamp as an app estimate, not the dispute deadline.
- Remove home/detail promises that the buyer controls final settlement.
- Keep mainnet policy copy out of reference testnet quotes.

`activation-panel--detail` renders `CommerceJourney`, which renders
`CommerceQuoteDetails`. These corrections apply to both full and compact
detail panels; the CSS class itself does not enforce any policy.

## Functional limits retained

The app deliberately combines persisted buyer approval and a settlement
request. Its server checks the timing gate before saving that approval.
There is currently no separate “accept delivery now, settle later” action.
That coupling is BNBEra's design; the payout delay is the selected contract's
rule. This review changes presentation, not that lifecycle.

The timing gate uses the local confirmed observation time plus the contract
window, not the policy's exact `submittedAt` or current verdict. It is
conservative for payout, but must not be presented as the last opportunity
to dispute. The dispute button also does not project the exact on-chain
deadline or rejection-vote state; contract checks remain authoritative.
An exact policy-state read and corresponding action availability would be
needed for full state alignment, rather than only accurate disclosure.

No completed-job or Greenfield claim is advanced by this review. Job 56765
has verified delivery evidence; its previously verified earliest policy
payout time is September 16, 2026 at 17:53:27 UTC. It is not settled.

## Validation

The merged #45 head passed both complete CI runs, including disposable DB,
build, type, test, security and production-runtime checks. The panel changes
passed nine focused quote/detail tests, including exact seller-term display,
unparseable-term fallback and exclusion of mainnet policy copy from testnet.
Web lint and TypeScript checks also passed for the panel changes.

## Follow-up: minimal verdict display

PR #50 adds a direct read of the pinned policy’s `check(jobId, "0x")` for submitted jobs and displays Pending, Approve, Reject or Unavailable with the latest status read. This addresses the missing verdict display described above. Exact dispute deadlines, vote/quorum presentation and action availability remain separate follow-up work; the conservative timing gate and approval/settlement coupling are unchanged.
