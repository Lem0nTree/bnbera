# BNBEra phase-zero Altana → Agent Studio spike

This directory contains the adapter contract, a fail-closed runner, a
sanitized evidence template, and a runbook for proving the custody boundary
required by BNBEra. It is not a claim that the live Altana or Agent Studio
flow has already run.

## What must be proven

The live test is complete only when one browser/passkey-controlled flow
demonstrates all of the following on the selected BNB test environment:

```text
review exact policy
  → grant bounded Altana runtime session
  → hand off only bounded session material to the approved Studio/AWS secret path
  → execute one permitted state-changing action through AgentCore
  → revoke from the browser administrator
  → attempt the same action again and observe rejection
```

The root/admin signer, passkey export, and administrative keystore must never
enter BNBEra, PostgreSQL, logs, evidence objects, build artifacts, or the
runtime. The runtime may receive only the expiring, allowlisted session
material through the approved one-time secret handoff.

The runner in [`src/runner.ts`](./src/runner.ts) accepts injected adapters so
the browser, Altana SDK, Studio CLI, AWS secret path, and AgentCore behavior
remain explicit integration boundaries. The local tests use a simulated
driver and are labeled `simulated`; they do not satisfy the live acceptance
gate.

Before the permitted action, the runner applies the configured policy bounds,
performs a fresh `SessionStateObservation`, and checks that its active status,
session ID, policy digest, source, and freshness window match the granted
descriptor. A cached or unbound `active` flag fails closed. The action adapter
must return the actual native value and token/native charges; the runner binds
those values to the expected action before evidence can pass.

## Official inputs reviewed

The following primary sources were checked while preparing this spike:

- [BNB Agent Studio CLI reference](https://docs.bnbchain.org/developer-kit/bnbchain-studio/cli-reference/)
  documents `bag init`, the `--wallet-kind altana` option, the A2A/MCP/X402
  protocol flags, `bag doctor`, and the deploy workflow.
- [Pinned `@bnbagent/studio-cli` package](https://www.npmjs.com/package/@bnbagent/studio-cli)
  is the reviewed 0.0.13 package target in the architecture plan and describes
  Altana as a bounded runtime-session custody mode. The installed package and
  runtime still need to be verified in the test environment.
- [Altana SDK source and README](https://github.com/altananetwork/altana-sdk)
  documents passkey wallets, scoped `grantSession`, bounded calls/spend, and
  explicit revocation. The exact API and session serialization exposed by the
  selected installed SDK must be captured during the live run rather than
  inferred from this scaffold.
- [Altana environment API documentation](https://docs.altana.ai/developers/api-documentation/article.html)
  explains that environment-specific API references and credentials are
  served by the authenticated Altana environment. No Altana credential is
  embedded here.

## Alternatives to test

### Alternative A — Studio accepts an externally prepared session

1. Use the browser/Altana flow to create the session and review its exact
   call, selector, value, token, spend, and expiry bounds.
2. Pass only the resulting bounded runtime-session material to the supported
   Studio configuration/deployment path.
3. Record the exact Studio command/configuration and delegated secret
   destination without recording the material itself.

### Alternative B — Altana SDK provisions before Studio deployment

1. Use the pinned Altana SDK in the browser/user-approval flow.
2. Verify the session in the onchain KeyStore or supported SDK read path.
3. Use Studio for the runtime and deployment, injecting the already-bounded
   session through the reviewed Studio/AWS secret channel.
4. Record why Alternative A was unavailable in the pinned Studio release.

Do not invent a third path by accepting an administrator private key, a
passkey export, an unrestricted local wallet, or an unreviewed environment
variable in the BNBEra backend.

## Controlled procedure

### 1. Prepare an isolated test environment

- Start from the exact `ARCHITECTURE_BASE_SHA` and the `config/standards.lock.json`
  selected by A0. Do not run from an uncommitted checkout.
- Use a disposable BSC testnet wallet and tightly bounded funds. Never reuse
  a mainnet key.
- Use an isolated AWS development account or sandbox secret store with a
  role that can write/read only the test agent's delegated secret.
- Use a browser with the Altana passkey test account. The user performs the
  administrator approval; an automation or terminal must not request a seed
  phrase or passkey export.

### 2. Verify the Studio toolchain

The current official CLI reference shows the following shape. Run it only in
a disposable directory, after the exact version and network have been
recorded in the standards lock:

```powershell
bag init bnbera-altana-spike `
  --runtime agentcore `
  --network bsc-testnet `
  --wallet-kind altana `
  --protocols A2A,MCP,X402 `
  --storage-provider ipfs `
  --no-onboard
bag doctor
```

The command above is a procedure to test, not evidence that it succeeded in
this repository. Capture only sanitized command output: tool versions,
selected options, non-secret error codes, and public runtime metadata.

### 3. Review and grant the policy

The browser must show the exact values before approval:

- BSC chain ID (`97` for the default testnet path unless the locked
  environment says otherwise).
- Altana smart-wallet address and administrator address.
- Session public address.
- One or more explicit contract addresses and four-byte selectors.
- Maximum native value per call.
- Token addresses, atomic spend limits, and periods.
- Expiry (`1h`, `24h`, or `7d`; no unlimited option).

The public evidence records these facts only. It never records a serialized
session, key bytes, cookie, access token, password, or raw browser state.

### 4. Perform the one-time handoff

The adapter returns an opaque `EphemeralSessionMaterial` to the runner. The
runner consumes it once, passes it to the approved secret sink, and zeroes
its local byte buffer after the sink returns. The sink must not log, persist,
return, or copy the material outside the selected Studio/AWS secret path.

After the handoff, public evidence records only the logical destination kind
and `secretHandoffAccepted: true`, never an ARN, secret name, or value. An
internal database descriptor may contain `secretReference` only after the
external sink returns a successful `SessionHandoffReceipt`; that reference
must not be copied into public evidence. The runner result exposes only a
sanitized handoff receipt with the provider kind, session ID, policy digest,
acceptance time, and one-time-consumption flag; it omits the destination
reference as well.

### 5. Execute, revoke, and prove rejection

- Invoke one fixed action that is inside the displayed allowlist and below
  the displayed limits.
- Verify the transaction receipt and resulting state on the same testnet.
- Revoke the session through the browser administrator path.
- Read the current authorization state from the supported Altana/KeyStore
  path at a confirmed block.
- Attempt the same action again. The result must be a deterministic
  authorization rejection before a state-changing transaction is accepted.
- If the post-revocation action succeeds or has an unknown outcome, mark the
  run blocked and do not publish the agent.

The handoff receipt must echo the approved destination, session ID, and policy
digest, confirm one-time consumption, and be accepted only while the granted
policy is unexpired. A sink response for a different destination or session is
not evidence of a successful handoff.

## Evidence handling

Start from [`phase-zero-evidence.template.json`](../../docs/evidence/altana/phase-zero-evidence.template.json).
The template is intentionally `not_run` / `design_only` and has no fabricated
transaction hashes. Replace nulls only with values observed during the
controlled run. Use the runner output or a reviewed equivalent to preserve
the following distinctions:

- `simulated` or `local_test` proves only local adapter behavior;
- `testnet` requires a real browser grant, testnet receipt, revocation
  observation, and post-revocation rejection;
- no phase-zero result should be labeled `mainnet` by this spike.

The report must include the exact Studio CLI/runtime and Altana SDK versions,
the selected alternative, policy summary, public transaction references,
destination kind/acceptance boolean, and any blocked step. A URL, HTTP 200,
health check, or submitted transaction is not proof of this complete sequence.

## Required credentials and interactions still outstanding

The following are intentionally not present in this branch:

- Altana browser/passkey test-account access and user approval.
- The installed Altana SDK version and its environment-specific configuration.
- Agent Studio CLI/runtime 0.0.13 verification in the target environment.
- A disposable BSC testnet wallet and bounded test funds.
- A supported Studio/AWS delegated secret destination and least-privilege
  runtime role.
- One fixed testnet contract/selector action approved for the spike.
- An operator to revoke the session in the browser and confirm the second
  action rejection.

Until those items are observed and recorded, A2's phase-zero acceptance is
blocked and A6 Creator implementation must not treat this scaffold as proof
of custody compatibility.
