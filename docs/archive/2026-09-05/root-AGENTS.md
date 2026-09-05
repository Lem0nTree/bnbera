# BNBEra Coding-Agent Instructions

These instructions apply to every coding agent working anywhere in this repository.

## Documentation gate before edits

Before changing code, configuration, migrations, or infrastructure, read these files in full from the checkout you will edit:

1. `docs/04-bnbera-master-implementation-plan.md`
2. `docs/05-subagent-delivery-plan.md`
3. `config/standards.lock.json`
4. the focused plan relevant to the assigned work:
   - marketplace, search, ingestion, or web: `docs/01-marketplace-donor-merge-plan.md`
   - evidence, Greenfield, or IPFS: `docs/02-greenfield-data-and-evidence-plan.md`
   - Creator, Agent Studio, Altana, or deployment: `docs/03-no-code-agent-deployer-plan.md`
5. every accepted ADR relevant to the assigned work under `docs/adr/`
6. the shared schemas and interfaces the change consumes.

Before the first edit, report documentation-read evidence to the coordinator. The report must list the exact paths read, the assigned delivery wave/vertical, the applicable feature gate and risk tier, and the constraints or unresolved lock entries that affect the task. A summary from another agent is not a substitute for reading the files in this checkout. If an agent cannot access a required file, it must stop before editing and report the missing path.

## Hackathon execution priority

- Execute revised W0 and W1 first: deliver the public marketplace and its web experience early.
- W0 establishes the runnable marketplace/web vertical slice. W1 makes discovery, search, filtering, detail, comparison, and transparent activation state useful with real or explicitly labelled fixture data.
- Altana acceptance blocks Creator/Agent Studio activation only. It does not block marketplace, web, read-only discovery, search, or detail work.
- After W1, organize remaining work into four delivery verticals: Marketplace Data + Web, Activation + Commerce, Creator + Altana + Reference Agent, and QA + Deployment + Submission.
- Keep incomplete external integrations disabled by default behind documented feature gates. Never make a core marketplace route depend on a disabled Creator, payment, Greenfield, or Altana integration.

## Non-negotiable boundaries

- `config/standards.lock.json` is authoritative for pinned toolchains, networks, contracts, and release-gate status. Unresolved entries stay disabled; do not guess an address, ABI, provider, package, or capability.
- Preserve the independent origin, claim, verification, runtime, authority, and listing state axes and the complete ERC-8004 identity tuple.
- Never store, log, commit, or paste private keys, passkey exports, root credentials, raw sessions, or tokens. Persist secret references only.
- No mock, placeholder, simulated transaction, HTTP response, or health result may be presented as live evidence.
- Mainnet writes, production DNS changes, paid resources, and irreversible actions require explicit release-owner approval.
- Apply the risk-tiered definition of done in the delivery plan. UI-only work does not inherit custody-grade ceremony, while auth, migrations, payments, custody, and onchain writes require their stronger evidence.

## Checkout and handoff discipline

- Confirm the absolute checkout path, branch, base SHA, and `git status --short` before editing.
- Preserve unrelated changes. Do not switch branches, rebase, merge, or commit from a shared working tree unless the coordinator explicitly assigned that operation.
- Stay within assigned paths and use current shared contracts rather than creating local substitutes.
- Handoffs must include documentation-read evidence, changed paths, commands and results, evidence level, known limitations, feature flags, rollback/disable steps, and the exact base/head SHAs when commits are part of the assignment.
