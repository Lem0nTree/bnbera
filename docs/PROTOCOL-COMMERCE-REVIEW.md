# Protocol verification and bounded commerce acceptance

Implemented 2026-09-09 from `3f98a015fd771c478114ae4997bcd1d11db701f1` in `bnbera-ui-light`. This is a verified BSC **testnet acceptance** with a supervised, three-reservation provider allowance, not a mainnet payment release or unlimited provider operation. No mainnet transaction, deployment, commit or push was performed.

## Independent verification facts

The retained directory has 100 vendor members (80 mainnet / 20 testnet). The rendered collection remains capped at 100: 80 mainnet, 19 external testnet, and one separately labelled BNBEra reference provider. Original membership and observations are not deleted when the reference takes one display slot.

Protocol checks do not enable payment eligibility:

| Service | Successful evidence | Other displayed states |
| --- | --- | --- |
| A2A | Bounded JSON Agent Card, MIME, public declared URL/interface, name/version, skills and capabilities validated | Advertised, invalid, unreachable, auth required, stale |
| MCP | Streamable HTTP `initialize`, `notifications/initialized`, and capability-appropriate `tools/list`, `resources/list` or `prompts/list` | Advertised, invalid, unreachable, auth required, stale |
| Web / API | HTTP availability only | Invalid, unreachable, stale |
| Other | Advertised only; no unsupported protocol guessed | Not checked |

An A2A card check is not a task invocation or full conformance certification. MCP checking never sends `tools/call`; session IDs exist only in memory and are not persisted. MCP supports bounded JSON or SSE responses and accepted negotiated versions 2025-11-25, 2025-06-18 and 2025-03-26. Legacy transports that do not pass this handshake remain unverified. Private/credential-bearing targets, unsafe redirects, oversized bodies and invalid schemas fail closed. Web pages are never called Agent Cards.

Each observation contains the exact service identity, protocol/status, check and expiry timestamps, latency, HTTP status, safe reason, supported capability names/count, allowlisted evidence digest and verifier provenance. Evidence expires after two minutes; one successful check is not uptime. Unknown or stale checks never become definitive failures. The profile and directory rows separate verified interfaces from advertised services and completed paid work. Vendor scores and permissionless feedback retain their source labels.

Visible marketplace and directory-detail pages refresh their read-only server observations every 30 seconds; hidden tabs do not poll. Existing filters and client form state are preserved. Core profiles with multiple services do not misattribute an aggregate health check to each endpoint.

OpenOdds `56/49637` previously failed because its server emitted duplicated identical `application/json` MIME values. Identical values now normalize; conflicting MIME values still fail. The live recheck verified its A2A card and MCP handshake/list, and separately found its web service reachable.

A completed bounded refresh observed 133 service references / 107 unique URLs across the 100 retained members:

| Protocol | Verified / reachable | Invalid | Unreachable | Advertised only |
| --- | ---: | ---: | ---: | ---: |
| A2A | 21 | 8 | 4 | 0 |
| MCP | 3 | 9 | 4 | 0 |
| Web | 43 | 1 | 2 | 0 |
| Other | 0 | 0 | 0 | 38 |

These are observation-time counts, not promises about future availability. The reference provider receives its own exact-identity core health check.

## Refresh operations

```sh
MARKETPLACE_SERVICE_REFRESH_ENABLED=true \
  node scripts/run-with-repo-env.mjs -- pnpm ops:marketplace-services
```

The refresh reads only existing finalized members, deduplicates service requests, uses four workers, and holds a PostgreSQL advisory lock. At most 100 profiles are processed. Per-profile observations are inserted idempotently by digest; another dated check is new history. On timeout/failure, rerun the same command: retained completed observations remain valid until their expiry. No cursor reset or discovery expansion is required.

Two new one-minute cron wrappers were installed alongside the two retained jobs: `ops/marketplace-cron/protocol-services.sh` (flock + 110-second process timeout) and `reference-health.sh` (35 seconds, exactly the configured reference identity). These make read-only network checks and retained observation writes, not chain transactions. The previous crontab is backed up under `.runtime/protocol-commerce-review/crontab-before.txt`. No signing worker cron was installed. Log/history retention needs an operational policy before indefinite production use; this change does not delete history.

## External commerce audit and fallback

None of the selected 100 external agents established the complete permitted BNBEra lifecycle with verified price, matching provider identity, callable task/result contract and settlement binding at the authorized 0.001 U test amount. All 80 mainnet candidates are blocked by unresolved mainnet commerce/router/policy/token pins. Fifteen testnet records lack paid metadata; five advertised negotiation offers have mismatched chains/tokens, unavailable invocation, or prices above the authorized test amount. Reachability alone cannot fix those facts.

One clearly labelled reference was therefore registered on the already verified BSC testnet ERC-8004 registry:

- Identity: `eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e:2293`.
- Published version: 2; profile `/agents/bnbera-reference-health-factor-provider`.
- Owner/buyer: `0x230072625F8090d5271C5f882748ce11134ac2Ba`.
- Bound provider wallet: `0x23bb79742B18fE2aF238dDE9eF97f355721c9122`.
- A2A card: `/api/reference-provider/agent-card`; real `message/send` and a separate raw calculation endpoint are implemented.
- Task: exact lending health-factor arithmetic from buyer-attested collateral/debt/threshold. It does **not** claim a live lending-position read or financial advice.
- Price: exactly `1000000000000000` atomic units = **0.001 U**, 18 decimals, token `0xc70b8741b8b07a6d61e54fd4b20f22fa648e5565` on chain 97.

No mainnet reference was registered because its mainnet paid flow could not be safely enabled. Existing contracts were reused; no new payment infrastructure was deployed. `releaseEnabled=false` remains unchanged.

## Actual WalletConnect lifecycle: job 1171

Acceptance used the actual shared WalletConnect connector and relay with an operator-controlled test wallet peer, not an injected provider or fabricated UI. Peer sessions were memory-only, with a mode-0600 Unix approval socket. Every connection, SIWE signature and exact transaction required a separate operator approval. Chain 97, exact persisted intent, provider, contract, token, amount, one job, zero native value and gas caps were checked before signing. Keys and pairing URIs were never printed or stored in application data.

The immutable quote `3233d673-38ac-4f9a-a516-89c2e7cc330b` bound 2,000 USD collateral, 1,000 USD debt and an 80% liquidation threshold to reference version 2. The worker derives its input from this stored quote and verifies the task digest, full provider identity, funded job and exact amount; no independent operator task fixture is substituted.

| Confirmed step | Transaction hash |
| --- | --- |
| Register agent 2293 | `0xbd884a3225c7c28a838e01cf3a4b4b7d917c6da51ff15d297cb6f9fd344d93bd` |
| Bind provider wallet | `0xb62bff0711c10e2a0a0c6d773bbbce42787696d7b40acd858d7632f85b5ca187` |
| Create job 1171 | `0x309833ad6b7bfdecdbe51a8c28b2bf0269843bf0775298a223c58eb48b6901a2` |
| Register commerce | `0x2a1e2ce90bf94c17d0173a7291e299ac537adb2a8fb71dee516f06707021ab3e` |
| Set exact budget | `0x234c197f2e93d246a804523cd5593f9cd385b9348b21f111521b2cc33156a93c` |
| Approve exact 0.001 U | `0x1d6d3a70d7f04be8136f3090ccecfb02c0c7217320d79ec73bb6831fa7b7b287` |
| Fund escrow | `0x4db852572ec70d46170890a2db71e5b45981a96ae711e741e73598d89e693c74` |
| Provider result submission | `0x018f94078a5f4455dc2ec356a55016083bdb4ed02a4951a530e89837a41d5be2` |
| Buyer settlement | `0x248f0794c44dff4567d1c3692f5caebcacb8fe9df83e0218ded16caac65e78f1` |

All nine receipts succeeded on chain 97. Receipt-attributed gas cost totals **0.0001347348 tBNB**. Exactly **0.001 U** moved from buyer escrow to provider; remaining buyer-to-commerce allowance is **0**. Settlement block is 129985469. No unrelated funds were moved by this task.

The actual report is **1.6**, with local SHA-256 `fe9a7eb2d2c50b14b91a2a13d55b4b72b3ce09c71055a9e7dd1a28da12148f31` and on-chain Keccak `0x8cf0667e0244313a6b24e55eb2f32679161365767a0485c7b69a06ac3a7c0c14`. Buyer approval is persisted against that exact digest. The 900-second dispute window was respected; approval and settlement were not automatic. The UI displayed the input snapshot, exact result, manifest and both receipts before completion. A verified-purchase review is explicitly labelled an operator testnet acceptance test, not an independent customer endorsement.

Real recovery checks included rejecting the first create prompt (same operation resumed with no hash or extra job), renewed SIWE after natural expiry, provider replay with `writesBroadcast=false`, and confirmed-job reload across preview restart. The server/UI now fail closed while settlement policy is unavailable or the dispute window is open. Expired authentication prompts re-sign-in while retaining the saved job; polling is non-overlapping and stops after completion.

## Admission, flags and limitations

The initial acceptance paused admission after job 1171. The subsequent explicit authorization adds a **three-reservation lifetime allowance**, not unlimited operation. The supervised service described below replaces manual per-job operation for this allowance. Wallet connection, existing-job recovery, results and reviews remain available through `/hired`; a reachability probe alone still cannot authorize paid work.

The built preview requires `BNBERA_ENV=preview`, chain 97, HTTPS `APP_URL`, `T5_COMMERCE_TESTNET_PREVIEW_ENABLED=true`, `T5_WALLETCONNECT_AUTH_ENABLED=true`, `T5_COMMERCE_LOCAL_ACTIVATION=true`, and `T5_COMMERCE_DEVELOPMENT_CANARY_ENABLED=true`. Production environment/mainnet/release gates remain closed. A WalletConnect project ID must exist before build. The private keys remain only in the retained gitignored environment; bare valid hex keys are normalized in memory.

The legacy exact-job command remains useful for read-only reconciliation of an already attempted operation; do not use it to bypass the new bounded service for a fresh submission:

```sh
# Exact existing job only; this command may sign one provider submission.
T5_REFERENCE_PROVIDER_JOB_ID=AUTHORIZED_JOB_ID \
  node --env-file=.runtime/protocol-commerce-review/preview.env \
  scripts/run-with-repo-env.mjs -- pnpm ops:t5-reference-quoted-worker
```

Do not blindly retry an unknown transaction. Inspect its persisted operation and receipt first. Never use admission as authority to spend on an arbitrary queue. Keep Ask AI read-only; it cannot hire, sign, invoke tools or change this gate. Its process-local quota is not a distributed production quota.

### Three-slot supervised allowance (continuation)

`reference-2293-after-1171-v1` pins the exact full chain-97 identity, version 2 (`0c656a70-700b-59b8-96b8-1377c0a0086a`), owner/provider, public card/service, verified commerce/router/policy/token and exact 0.001 U price. The authorization digest is persisted and compared on every startup/read. It cannot be changed into another agent, chain, version or amount by environment variables.

Migration `0010_reference_provider_allowance.sql` adds one allowance row and three permanent slot numbers enforced by SQL constraints. A quote and its slot commit atomically under a PostgreSQL transaction advisory lock. Identical unexpired buyer/task retries reuse the same quote. **A reservation consumes its slot even if the buyer abandons it or it expires**; slots are never recycled by a restart, failure, refund or completion. This conservative acceptance cap may reject new requests before three completions if buyers abandon their reservations. A new allowance requires new explicit spend authorization and review, not deletion/reset of these rows.

Each slot reserves 100,000,000,000,000 wei = 0.0001 tBNB. The transaction gas limit is at most 400,000 and gas price at most 250,000,000 wei (0.25 gwei); lifetime maximum is 0.0003 tBNB across all three submissions. Actual receipt gas is recorded separately and never restores authorization. Signer balance must cover the full conservative allowance. The SDK builds exact submit calldata and canonical manifest; only its transaction transport is replaced with a bounded EOA signer, while the existing commerce service retains result validation, idempotency, receipts and canonical job state. Transaction hash and nonce are recorded before broadcast; raw signed bytes and keys are never persisted. Unknown or reverted outcomes consume their reserved budget and block new admission until reconciled; no automatic resend occurs.

`ops/reference-provider/bnbera-reference-provider.service` runs the singleton under user systemd, with process flock and a session-lifetime PostgreSQL advisory lock. It polls every five seconds, atomically claims only exact, canonically funded admitted jobs and derives work from immutable buyer quotes. A second instance cannot overlap. The heartbeat is refreshed only after exact configuration, standards-locked deployment verification, provider balance, gas price and fresh endpoint checks. Public capacity reads bypass the directory cache. Quotes fail closed when the heartbeat is older than 20 seconds, admission is disabled, a check fails, or all three slots are used. No worker path approves or settles for a buyer.

```sh
systemctl --user status bnbera-reference-provider.service
systemctl --user restart bnbera-reference-provider.service
# Stop every provider signing path in this supervised service:
systemctl --user disable --now bnbera-reference-provider.service
```

The source unit contains no secrets; the wrapper loads only the retained mode-0600 env and public preview configuration. Journald output is sanitized and rate-limited to 30 messages/minute under host journal rotation. There is no signing cron. Ubuntu user lingering was changed from `no` to `yes` with `sudo loginctl enable-linger ubuntu` so the enabled unit survives logout. To reverse that host change after stopping the provider, use `sudo loginctl disable-linger ubuntu` only if no other user service needs it. For admission-only shutdown, set `T5_REFERENCE_PROVIDER_ADMISSION_ENABLED=false` and the persisted allowance `enabled=false`; restart the preview to refresh its process environment. Stopping the worker automatically makes API admission fail closed once the heartbeat expires (a graceful stop marks it unavailable immediately). Mainnet and production payment release remain disabled.

The latest service observation wins: an older successful probe cannot override a newer failure. Probe projection samples its clock after reading that identity's observations: a new probe committed during a long directory read must not be misclassified as future-dated against a pre-read timestamp. Genuinely future-dated probes still fail closed; both cases have regression coverage. Readiness on the reference profile refreshes every five seconds. Admission closure preserves existing local job recovery; the profile continues displaying its saved result/receipt journey. A completed job may be cleared from the browser's current-task pointer with **Start another task**, without deleting its database history or review. Starting another quote still requires remaining allowance and fresh readiness.

### Automatic worker acceptance: job 1177

Real WalletConnect and SIWE produced quote `35e9e4a9-5062-4515-b894-f7d89c734cf6`, slot 1, for 3,000 USD collateral, 1,000 USD debt and 80% liquidation threshold. Its task SHA-256 is `481f13aa5a255286e3db6eb720ff06f9ee1149ac7501f073bda68bcda1f2df92`. Five separate explicit wallet approvals confirmed create, register, exact budget, exact 0.001 U allowance and funding. The service auto-claimed the funded job at 08:43:17 UTC, invoked the existing real deterministic provider and submitted at 08:43:31. No exact-job operator command triggered the work.

| Step | Confirmed transaction |
| --- | --- |
| Create 1177 | `0x0540bc96d4c1e2ed69645e47f31ef241044b9448f862d70675d601ee7a50e668` |
| Register | `0x9b6dc375f12788942693a1b25e64985a3682a83904f58fc2885c137a16eda22e` |
| Budget | `0x31fd9cb0abbda88d2528cb7cc825b9cd1b5a780ad40dd37e28a716720504edce` |
| Exact 0.001 U approval | `0xba6b0666c9641970542c1bbe1486784dd3550d20a6e80a0918764be92b35e961` |
| Fund | `0xa361c0a47c84e4a66c02b76c933e7a9d9e3aa0f68d313fa6306cfc185d9c3697` |
| Provider submit | `0x8b4af3084f439cb43b46dc7d2059cfd63a72048243a7b1892bf5d3f8a654607e` |
| Explicit buyer settlement | `0xa833c0a88f94a14e0b21bdde7dc1d1b2681059fc9eb2e4151e29fee8e927a188` |

The actual result is **2.4**, local SHA-256 `3b67ee07056176c60e8fc66e40ae9c308eec0c276326afbc57019eb971e5ddef`, on-chain Keccak `0x7ea2e69fd23d482852a771f3f753243d5f55507721f6186c5d3ecc89f76e91b1`. Submit block 129993077 used 200,063 gas at 0.1 gwei = **0.0000200063 tBNB**. Its full 0.0001 tBNB reservation remains consumed. Two slots remain, subject to fresh service readiness. The real 900-second policy window ended at 08:58:31 UTC; approval was verified disabled before that time. After renewed WalletConnect/SIWE, the buyer approved the exact result digest at 08:59:12 UTC and separately signed settlement. Settlement succeeded in block 129995817, using 117,631 gas = 0.0000117631 tBNB. All seven lifecycle receipts succeeded; their total gas cost was **0.0001038358 tBNB**. Exactly **0.001 U** was settled, provider U balance increased from 0.006 to 0.007, buyer U balance is 9.990, and remaining token allowance is zero. No registration, deployment or mainnet transaction occurred in this continuation.

A supervised restart retained one slot and exactly one provider-submit operation/hash. A second process exited 1 at flock, and a second PostgreSQL session could not obtain the worker lock. Stopping the service made public activation unavailable (`WORKER_STOPPED`) and a new authenticated quote return 503 `COMMERCE_DISABLED`, with no second reservation. Service restart restored readiness without another chain write. The completed result and settlement receipt were visible in the browser. A second verified-purchase review explicitly says it is an operator testnet acceptance test, not an independent customer endorsement. **Start another task** cleared only the browser pointer without making a quote; `/hired` retained both completed 1171 and 1177. The acceptance wallet peer was disconnected and stopped after the review; the bounded provider remains supervised and enabled.

The validated pre-migration backup is `.runtime/protocol-commerce-review/before-bounded-service.dump` (0600). Disposable restore/migration preserved all 2,293 agents, three prior protocol jobs, seven prior commerce quotes and valid constraints. Fresh/restart/legacy migration smoke also passed. The new disposable concurrency check admitted exactly three of four simultaneous reservations, denied a fourth SQL slot and retained zero remaining capacity after reconnect. No retained slot was consumed by these tests. At 09:04:42 UTC the retained DB had 2,293 agents, 173 versions, 101 directory observations, 8 commerce quotes, 4 protocol jobs, one reconciled allowance slot, one allowance review, and 11,300 protocol observations (refresh history continues growing). Capacity was ready, admitted 1 / submitted 1 / completed 1 / remaining 2. Receipt/balance/approval/operation evidence is in `bounded-chain-audit-final.json`.

Continuation validation: workspace tests passed (638 Vitest tests, plus 48 Altana tests with one intentional skip and five Studio tests); workspace lint/typecheck and full build passed. Integration/security passed 53 with one intentional skip; operator tests passed 20/20. The dedicated strict worker TypeScript configuration passed. After the concurrent-probe clock correction, marketplace tests passed 52/52, marketplace lint/typecheck passed, the new web build succeeded, and the web suite again passed 199/199. No retained database history or slot was reset.

Final public contract sweep at 09:13:25 UTC (`bounded-public-final.json`) validated four API schemas and five page routes, all HTTP 200: 100 live profiles, 80 mainnet / 20 testnet, zero fixtures, one hire-eligible reference, capacity 2, two completed reference jobs and two explicitly labelled operator reviews. The rendered external observations contained A2A 20 verified / 8 invalid / 4 unreachable; MCP 3 verified / 9 invalid / 4 unreachable; Web 43 reachable / 1 invalid / 2 unreachable; Other 38 advertised. The separate core reference A2A was healthy. OpenOdds retained verified MCP (14 capabilities), verified A2A (12 skills), and reachable Web. Ask AI returned a real HTTP-200 answer correctly distinguishing protocol checks from paid-hire eligibility; cross-origin requests were 403 and oversized requests 400. Warm detail routes took 103–203 ms; a cold collection projection took 11.2 seconds and a cold marketplace page 6.3 seconds. The retained all-identity read path still needs performance work before an unbounded production launch; this acceptance uses its bounded cache and does not hide the cold latency.

Inspected desktop (1440 px) and mobile (390 px) captures show no horizontal overflow: `bounded-marketplace-desktop.png`, `bounded-marketplace-mobile-top.png`, `bounded-reference-{desktop,mobile}.png`, and `bounded-openodds-{desktop,mobile}.png`. `bounded-hired-completed-desktop.png` preserves both 1171 and 1177; result/receipt evidence is in `bounded-job1177-completed-desktop.png`. A screenshot taken before streamed content finished was replaced after waiting for the loaded heading and reference row. Final preview PID is 716199 on port 3022; provider unit main PID is 678415, worker PID 678529, active with no automatic restarts. The original Cloudflare PID 4127270 remains untouched. The wallet acceptance peer is stopped (port 3055 closed). The later read-only receipt audit (`bounded-chain-audit-handoff.json`) still had one slot / one provider operation / capacity 2 and 12,300 protocol observations, with unchanged balances and no additional transactions.

The preview's Cloudflare quick-tunnel hostname is temporary and the registration currently names it. Durable hosting/domain and updated registration require separate authorization before a public provider launch. Mainnet commerce still requires verified contract/token pins and release acceptance. The controlled test wallet is acceptance tooling, not a deployed wallet service; stop it after verification.

## Initial job-1171 evidence (historical; superseded by the bounded continuation)

The following records the earlier paused acceptance. Its no-worker/paused-admission state is historical, not the current three-slot supervised state above.

At 07:46:37 UTC: 2,293 identities/agents, 173 versions, 101 original directory observations and 3,500 protocol observations (the latter continues increasing with the minute refresh). Added one reference agent with two versions, one commerce job, seven confirmed lifecycle operations, result/submission/approval and one clearly labelled verified review. No migration, retained-data deletion or registry cleanup occurred. The validated pre-change PostgreSQL custom-format backup is `.runtime/protocol-commerce-review/before-protocol-commerce.dump` (0600).

Local evidence is under `.runtime/protocol-commerce-review/`: registration, ingestion/setup, external audit, protocol refresh, immutable-quote worker/replay, receipt audit, build/test logs and browser captures. Files containing secrets are not evidence exports. Public preview: `https://species-verification-tool-southwest.trycloudflare.com/marketplace`.

Verification: full workspace package tests passed except two subsequently fixed web-only regressions (null test read-model stubs and an incorrect lock-field test expectation); the final web suite passed 199/199 across 33 files. Agent-ingestion passed 129/129, agent-commerce 80/80, configuration 17/17; operator registration/setup/worker tests passed 20/20. Integration/security tests passed 53 with one intentionally skipped environment-dependent test. Workspace lint/typecheck and production builds passed. The production lock-loader regression was also exercised by real authenticated operation reads after restart, not just its unit test.

Public API schemas passed for the 100-profile collection, OpenOdds `56/49637`, IVL Rebalancer `56/341628`, and reference `97/2293`. Post-restart authenticated reads returned completed job 1171; a new exact reference quote returned `COMMERCE_DISABLED` without creating another job. Ask AI returned a real provider answer, cross-origin requests returned 403, and oversized requests returned 400. Its context now separates finalized registry identity from unavailable metadata resolution and permissionless feedback from purchase stars; answers remain explicitly labelled AI interpretation. Its four focused tests passed after this refinement. Visible-page refresh was observed advancing OpenOdds checks from 07:58 to 07:59 without navigation. Warm public route checks returned HTTP 200 in 112–546 ms. The acceptance WalletConnect peer was disconnected and stopped; no signing worker remains running.

Final desktop (1440 px) and mobile (390 px) marketplace/reference/OpenOdds checks showed no horizontal overflow. Mobile endpoint actions now sit below readable service observations, and long result digests wrap. Captures include `protocol-marketplace-{desktop,mobile}.png`, `protocol-openodds-{desktop,mobile}.png`, `protocol-reference-{desktop,mobile}.png`, and `protocol-hired-completed-desktop.png`. A post-restart Ask AI canary correctly distinguished confirmed finalized identity from unavailable metadata and listed MCP/A2A verification and Web reachability (HTTP 200). Rebuild/restart briefly produced a recoverable 502; all final routes returned 200. A deliberately canceled overlapping build is retained in the logs; completed builds and generated route output are also retained, and the final served artifact was checked in the real browser.

Disable new tasks with the admission flag; stop the exact-job worker/test wallet processes, not the Cloudflare tunnel or unrelated runtimes. To stop health refresh remove only the two added cron lines, retaining the backed-up original lines. Setting `MARKETPLACE_SERVICE_REFRESH_ENABLED=false` disables manual refresh; cron explicitly enables it, so remove its line as well. Old observations naturally become stale. `MARKETPLACE_DIRECTORY_ENABLED=false` restores the previous browse surface without deleting data. To disable browser transactions unset the explicit T5 preview flags while retaining read access. Do not restore the DB backup over retained data without a separately reviewed recovery operation; confirmed chain transactions cannot be undone. Restart only the port-3022 preview after builds; building into an actively served `.next` can transiently invalidate chunks, so use a maintenance window for future rebuilds.
