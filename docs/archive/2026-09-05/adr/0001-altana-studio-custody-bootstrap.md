# ADR-0001: Altana to Agent Studio custody and session bootstrap

- **Status:** Proposed — phase-zero live validation required
- **Date:** 2026-09-01
- **Owners:** A0 Integration Lead and A2 Altana Bootstrap
- **Scope:** `packages/altana/` and `spikes/altana-studio/`

## Context

BNBEra needs a user-created agent that can run on BNB testnet without giving
the platform the user's administrative private key, passkey export, or
unrestricted wallet credential. The Creator plan requires this sequence:

```text
browser/passkey-controlled Altana administrator
  → exact policy review
  → bounded runtime session
  → Studio/AWS delegated secret path
  → one permitted AgentCore action
  → browser revocation
  → next equivalent action rejected
```

The current architecture pins BNB Agent Studio CLI `0.0.13` as the initial
review target and uses its `--wallet-kind altana` path. The exact way an
externally prepared Altana session is accepted by the pinned Studio release,
however, must be observed in the phase-zero environment. It must not be
inferred from a CLI flag or from a successful local scaffold.

## Decision

Adopt a custody boundary with two implementation alternatives, selected only
after the live spike:

1. **Alternative A (preferred):** use a supported Studio path that accepts an
   externally prepared, bounded Altana runtime session.
2. **Alternative B (fallback):** use the pinned Altana SDK in the browser and
   user-approval flow to create the bounded session, then use Studio for the
   runtime/deployment and inject only the bounded session through the reviewed
   Studio/AWS secret channel.

The phase-zero runner and package expose only public policy/session metadata
and an opaque, one-time `EphemeralSessionMaterial` handoff. They do not expose
an administrator key or a serializable session type. A runtime-secret sink
must accept the material only in memory, place it in the approved delegated
secret destination, return a reference-only receipt, and avoid logging,
returning, or persisting the bytes anywhere else. The local buffer is zeroed
after the sink returns.

The package is a containment and contract layer, not a replacement for
Altana, AWS, Studio, browser, or operating-system security controls. The
selected production adapter remains responsible for using the official SDK,
least-privilege IAM, and the exact pinned Studio deployment path.

## Non-negotiable invariants

- The connected user controls the Altana administrative wallet and approves
  the exact policy in a browser/passkey interaction.
- The policy names the BSC chain, session public address, target contracts,
  selectors, native-value cap, token spend caps, and expiry.
- No unlimited expiry or wildcard selector is accepted.
- Only the bounded runtime session crosses the one-time Studio/AWS secret
  boundary.
- PostgreSQL stores a secret reference and public policy metadata only; public
  evidence stores only a logical destination kind and handoff acceptance.
- The administrative key, passkey export, serialized session, cookies, and
  access tokens never enter BNBEra, logs, build artifacts, evidence, or the
  AgentCore runtime.
- Every state-changing action is checked against current authority state and
  the local policy immediately before submission. The authority read must be
  fresh and bound to the exact session ID and policy digest; missing or stale
  observations fail closed.
- The permitted action, revocation, and post-revocation rejection must be
  chronologically ordered by observed time and, when present, block number.
- A live/testnet attestation requires a reviewed module-private capability;
  caller-supplied `authorized-live-adapter` objects, test authority sources,
  and local-only secret destinations fail closed.
- Revocation or expiry blocks the next state-changing action and pauses the
  corresponding marketplace listing.
- A successful CLI scaffold, HTTP 200, health check, or submitted transaction
  is not accepted as proof of the complete sequence.
- Created write demonstrations remain on BSC testnet unless a separate,
  explicit release decision authorizes otherwise.

## Phase-zero acceptance evidence

The proposal becomes **Accepted** only when the sanitized evidence artifact
records all of the following with the exact installed versions and public
references:

1. Browser/passkey policy review completed.
2. Bounded session grant confirmed by the supported Altana/Studio path.
3. Handoff accepted by the delegated Studio/AWS secret destination.
4. One fixed allowlisted testnet action confirmed with receipt and resulting
   state.
5. Browser administrator revocation confirmed at a current chain/KeyStore
   observation.
6. The same state-changing action rejected after revocation, with no accepted
   state-changing transaction.

The checked-in template at
[`docs/evidence/altana/phase-zero-evidence.template.json`](../evidence/altana/phase-zero-evidence.template.json)
starts at `not_run` / `design_only`. Local unit or simulated runner tests may
prove the package contract, but may not be relabeled as testnet evidence.

## Integration contract for A6 and A10

The Creator and infrastructure workstreams must consume these outputs rather
than reimplementing custody assumptions:

- `ScopedPolicy` and `createScopedPolicy` for normalized allowlists and one of
  the approved expiry presets;
- `RuntimeSessionDescriptor` for public policy, grant reference, and
  secret-reference metadata;
- `handoffRuntimeSession` for one-time material consumption;
- `executionGate` immediately before a write after a fresh authority read;
- `PhaseZeroEvidence` and runner checkpoint semantics for deployment gates.

The root workspace and CI must include both `packages/*` and
`spikes/*` (or invoke `@bnbera/altana-studio-spike` explicitly) so the
package-level `build`, `lint`, `typecheck`, and `test` scripts run recursively.
The spike remains a test-only package until the live phase-zero evidence is
accepted.

A6 may not start the Creator deployment path as accepted until this ADR is
accepted or A0 explicitly records a replacement ADR with equivalent or
stronger invariants. A10 must not create an IAM role that can read another
agent's runtime secret.

## Alternatives rejected

- **Platform-held administrator private key:** rejected; violates user
  custody and allows authority outside the displayed scope.
- **Private key returned to the browser then uploaded later:** rejected; this
  was a donor security defect and creates a plaintext-key lifecycle.
- **Unrestricted local wallet in the production Creator:** rejected; it does
  not provide the required onchain scoped-session boundary.
- **Treating `--wallet-kind altana` as proof of handoff compatibility:**
  rejected; the command must be followed by a real, sanitized observation of
  how the installed Studio version consumes the session.
- **Custom BNBEra custody or escrow contract:** rejected; the architecture
  uses official Altana/BNB standards and keeps authority outside application
  tables.

## Open questions and required access

The following facts remain intentionally unresolved until an authorized live
run:

- Exact installed Studio CLI/runtime build and the command/configuration that
  accepts a prepared Altana session, if Alternative A exists.
- Exact installed `@altananetwork/sdk` version, environment configuration,
  session serialization format, and revocation/readback methods.
- Browser/passkey test account and the person who will approve and revoke the
  session.
- Disposable BSC testnet wallet, bounded funds, fixed test contract/selector,
  and testnet receipt visibility.
- Isolated AWS development account, region, delegated secret destination, and
  runtime IAM role.
- Confirmed behavior of AgentCore after the secret is injected and after the
  KeyStore revocation is observed.
- Final values for the standards lock; no address, ABI, or SDK version is
  invented by this ADR.

Until these are available, the phase-zero status is **blocked on external
observations**, not passed.

## Security and operational notes

- Use a fresh testnet-only wallet and the smallest practical spend/value caps.
- Keep `.studio/.env.local`, `.studio/wallets/`, passkey state, Altana admin
  material, session bytes, AWS credentials, and raw browser logs outside Git
  and chat.
- Do not paste raw adapter errors into evidence; map them to safe reason
  codes.
- Do not retry a state-changing transaction after an unknown outcome merely
  because the client timed out.
- Revoke or destroy the test secret and runtime after the run, while retaining
  only sanitized evidence and public transaction references.

## Primary references

- [BNB Agent Studio CLI reference](https://docs.bnbchain.org/developer-kit/bnbchain-studio/cli-reference/)
  (current command surface, `--wallet-kind altana`, A2A/MCP/X402 flags,
  `bag doctor`, and deployment commands).
- [Pinned `@bnbagent/studio-cli` package](https://www.npmjs.com/package/@bnbagent/studio-cli)
  (reviewed 0.0.13 target and documented wallet/deployment security model).
- [Altana SDK source and README](https://github.com/altananetwork/altana-sdk)
  (passkey wallet, scoped session grant, explicit execution, and revocation
  surfaces).
- [Altana environment API documentation](https://docs.altana.ai/developers/api-documentation/article.html)
  (environment-specific API documentation and scoped service-account keys).
- [BNB Agent Studio security](https://docs.bnbchain.org/developer-kit/bnbchain-studio/security/)
  (official deployment and secret-handling guidance to apply during adapter
  implementation).
