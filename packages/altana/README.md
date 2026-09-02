# `@bnbera/altana`

Secret-free custody boundary primitives for BNBEra.

This package does not implement or impersonate the Altana SDK. It provides
the contracts that an adapter for the pinned `@altananetwork/sdk` and Agent
Studio deployment path must satisfy:

- `ScopedPolicy` and `createScopedPolicy` normalize BSC chain, addresses,
  selectors, atomic limits, and bounded expiry presets;
- `assertActionWithinPolicy` and `executionGate` fail closed for expired,
  unknown, revoked, widened, or over-spent authority. Every token/native
  charge and cumulative bucket is explicit. `executionGate` also requires a
  fresh active session read bound to the descriptor's session ID and policy
  digest;
- `EphemeralSessionMaterial` permits one handoff and prevents JSON/string
  serialization of the local session bytes;
- `handoffRuntimeSession` sends material to an injected secret sink once and
  zeroes the local buffer after the sink returns;
- `PhaseZeroEvidence` helpers create and validate a sanitized, public-only
  checkpoint record. Finalization requires correlated chain/target/selector,
  receipt, native/token charges, resulting-state, revocation, and authority
  observations plus an explicit attestor; callers cannot supply a free-form
  `testnet` label. A plain `authorized-live-adapter` object is rejected by a
  module-private reviewed capability, and live evidence cannot use test
  authority sources or a local-only secret destination.

The sink must still be implemented with a reviewed Studio/AWS secret path. A
one-time in-memory wrapper cannot protect a misconfigured adapter, logger,
secret store, IAM role, browser, or runtime. No class or function in this
package accepts an administrator private key, passkey export, or raw
serialized session as a public domain field.

## Usage boundary

The production flow should be assembled only after the phase-zero spike has
captured the exact installed Studio CLI/runtime and Altana SDK behavior. Use
the runner under [`spikes/altana-studio`](../../spikes/altana-studio/) to
exercise the injected adapters. The checked-in tests are simulated/local
contract tests and are not live custody evidence.
