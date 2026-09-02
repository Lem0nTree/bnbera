# `@bnbera/payment-gateway`

Fail-closed X402/B402 request-payment contracts for BNBEra.

X402 is the buyer-facing HTTP request challenge; B402 is the selected BNB
settlement rail. This package deliberately keeps that per-request rail
separate from ERC-8183 job commerce and models the complete boundary:

`challenge -> authorization -> authenticated relay -> settlement observation -> receipt -> delivery`

It provides:

- independently pinned network, asset, decimals, amount, recipient, payment
  method, destination, facilitator, fixed-egress profile, verified payout,
  request correlation, and challenge lifetime checks;
- secret-reference-only seller configuration validation and an adapter seam
  that never accepts raw credentials in public domain values;
- EIP-3009 and Permit2 Exact method types (Permit2 Upto is not enabled);
- durable-repository contracts for attempts, immutable events and receipt
  identities, settlement observations, and reconciliation; an unknown or
  partial receipt may resolve once to a verified settled receipt;
- idempotency and terminal replay reservations; and
- explicit `unknown`, `partial_failure`, and `manual_review` outcomes so an
  ambiguous post-payment response is never silently retried.

`InMemoryPaymentRepository` requires an enabled, canary-passed seller
configuration at construction. Its `transaction` unit-of-work commits the
attempt, append-only event, challenge linkage, and idempotency record together;
the production repository must provide the same database transaction/CAS
semantics. Replay keys are normalized for reserve, lookup, and terminal CAS.

The current `config/standards.lock.json` disables hosted B402 settlement until
the facilitator, domain, payout recipient, and a complete paid canary are
verified. The checked-in adapters and tests are deterministic local contract
fixtures only: they do not call a facilitator, spend funds, or assert that an
HTTP `402` response proves B402 integration.

Primary implementation references:

- [BNB mpp-sdk / B402](https://github.com/bnb-chain/mpp-sdk)
- [BNB Agent Studio quickstart](https://docs.bnbchain.org/developer-kit/bnbchain-studio/quickstart/)
