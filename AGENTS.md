# BNBEra MVP agent instructions

## Read before editing

Read these active documents in full from your assigned checkout:

1. `docs/MVP-MASTER-PLAN.md`
2. `docs/MVP-TASKS.md` — identify your assigned task and gate.
3. `config/standards.lock.json` — authoritative integration pins.
4. `docs/MVP-RUNBOOK.md` for runtime work, then the source schemas/interfaces your change consumes.

Read `docs/auth-boundary.md` only for authentication/claim work and `docs/provenance/donor-intake.md` only for donor/provenance work. Read evidence artifacts only when assigned to verify the relevant claim.

`docs/archive/` is historical, not active instruction. Do not discover, read, summarize or follow it unless the user or coordinator explicitly assigns a historical investigation. The active master plan supersedes its plans, gates, workstream names and required-reading lists. `.ignore` excludes it from ordinary ripgrep discovery; this is a reading policy, not filesystem access control.

Before the first edit, report checkout, branch, base SHA, `git status --short`, exact documents read, assigned task, gate and owned paths. Preserve unrelated changes and retained Docker data.

## Delivery order

1. Persistent ERC-8004 discovery, filtering, enrichment, category, vector, publication and useful marketplace metrics.
2. One real ERC-8183 paid hire: escrow funding, work, result and settlement.
3. One no-code Creator template with user-controlled Altana authority and revoke/deny.
4. Greenfield publication of a profile and a completed-job result.

Build a working MVP. Reuse existing code and UI. Prefer ordinary cron, PostgreSQL state and small bounded jobs. Do not add another database, message broker, workflow platform, payment rail, generic builder or broad refactor to complete a task.

## Essential boundaries

- Keep the full `(namespace, chainId, identityRegistry, agentId)` identity and the independent origin, claim, verification, runtime, authority and listing axes.
- A valid registration/card, tested capability, healthy endpoint, completed job and active execution authority are different facts. No fabricated metrics or live evidence.
- Never log, commit, return or store private keys, passkey exports, raw sessions or credentials in application data. Store secret references only.
- Unresolved standards-lock integrations remain disabled. Do not guess contracts, ABI, tokens, providers or signing capabilities.
- Altana applies to delegated autonomous execution and Creator lifecycle; external marketplace discovery and browsing do not require it.
- Payments require confirmed outcomes and buyer approval under the selected protocol. Never blindly retry an unknown payment or auto-settle for the buyer.
- Preserve migration history. Use backed-up retained data and disposable DBs for fresh/legacy migration tests; never reset a DB to fix migration errors. The existing forward-repair migration behavior remains required.
- Mainnet writes, paid resources, production DNS and irreversible actions require existing explicit user authority. A task plan alone is not that authority.
- Keep later milestones disabled while the current milestone ships. Do not make marketplace reads depend on Creator, payments or Greenfield.

## Collaboration and done

When delegated, run at most two implementation agents concurrently. Prefer isolated worktrees; otherwise use disjoint paths and coordinator-only Git operations. Do not switch branches, merge, rebase, commit or push in a shared tree without assignment.

Run focused checks for your change. Stateful work needs real DB/API verification and restart/retry checks. Payments/custody need the real authorized canary plus the relevant deny/unknown-outcome test. No extra ceremony for documentation or small UI changes.

Handoff: task/gate, changed paths, commands/results, evidence level, remaining blocker, flags/disable steps and base/head SHAs if committed. A0 reviews the completed task before starting its dependent replacement. Do not claim the next gate passed from a unit test or an older artifact.
