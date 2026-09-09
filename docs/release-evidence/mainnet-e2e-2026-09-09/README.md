# Mainnet E2E attempt — 2026-09-09

**Incomplete: funded, awaiting provider. No acceptance or settlement proven.**

Tested the deployed https://bnbera.ritarda.to browser flow with the authorized operator wallet `0x230072625F8090d5271C5f882748ce11134ac2Ba`. Playwright used an operator-controlled EIP-1193 bridge; this was not a MetaMask or WalletConnect extension test. Each transaction required explicit operator approval against its destination and calldata digest. No private keys, raw signed transactions, session cookies or passkey exports are included.

## Results

| Stage | Observed result |
| --- | --- |
| Acquire payment token | Exactly 0.01 U acquired on BSC mainnet; receipt in `payment-token-acquisition.json`. |
| First hire | Grid job 56763 created and registered. Offer expired during RPC debugging. No budget, approval or funding transaction followed. Retained unfunded. |
| Paid hire | Loan-health agent 341565, job **56764**, all five funding receipts successful. Exactly 0.01 U escrowed. Remaining token allowance is zero. |
| Delivery | One explicit request returned HTTP 409 `RECONCILIATION_REQUIRED`. Subsequent read-only refresh returned `awaiting_provider`. Durable unknown claim retained; request not repeated. Latest chain audit shows FUNDED, zero submission timestamp and zero deliverable. |
| Acceptance / settlement | Not reached. No provider result is available to accept. The pinned optimistic policy has a 604800-second dispute window starting at submission; no settlement date exists before submission. |
| Greenfield | Two existing **testnet** objects fetched successfully with matching SHA-256 hashes. This proves historical storage readback only, not publication of this mainnet hire. |
| Create agent | Current Creator is BNB testnet. Filled template, prepared a headless virtual passkey and reviewed exact authority. Grant failed with `Reason: 0x`; UI reported no authority created. No agent deployment or grant transaction confirmed. Cause not established. |

The loan task uses hypothetical collateral/debt inputs. Its expected deterministic health factor is `(10*600*0.8 + 1*3000*0.825)/3000 = 2.425`; this has not been checked against delivered work.

## Transaction evidence

`transactions.ndjson` stores public transaction hashes before broadcast. `chain-audit.json` contains fetched transactions, successful receipts, decoded commerce events and current job state. Job IDs come from `JobCreated` events.

| Action | Mainnet transaction |
| --- | --- |
| Acquire U | [807b5f…](https://bscscan.com/tx/0x807b5f577330794bf503819c7f369c23c299b369c1d22982eae2aaccd6a868f6) |
| Grid create | [b02801…](https://bscscan.com/tx/0xb02801065e0d2926013bd9cf08581b07930a3bacac32e7499b49fa0b3cd00728) |
| Grid register | [6b7272…](https://bscscan.com/tx/0x6b727226b23517d655aca4644f3fc732565301d988cb313e6c7200e2d39fb517) |
| Loan create | [282fdd…](https://bscscan.com/tx/0x282fdd387f0a97067251a7d2dc7db77540567563bae3c2ddbb578fb0cca1cd39) |
| Loan register | [49483b…](https://bscscan.com/tx/0x49483bd0f79835a192fe2f5f41bbe9c02efcfe415d9a670e7dd8a8ed8c2a6049) |
| Loan budget | [c76366…](https://bscscan.com/tx/0xc76366ceeee9463ca49d432a94c7f2d7278fec1ad9afd5af66d4b88b917836dc) |
| Exact approval | [56aa3c…](https://bscscan.com/tx/0x56aa3c5ef596f77aa7f689680da53244815c69bd5ad80100fcdd222a641e7c0d) |
| Fund escrow | [467b28…](https://bscscan.com/tx/0x467b2877cb32b3b17ddbcf4d34c270ebafc2b274aadc9cd87c2f9c1a3fee5f1a) |

## Bugs and recovery

1. Server receipt recovery ignored the operator RPC and used the SDK default, which rejected archive reads. Composition now passes the configured network RPC to the adapter and external lifecycle.
2. Browser receipt polling used the chain library default endpoint, which failed CORS. Wagmi now uses an explicit public BSC endpoint with a public environment override. The actual five-step funding flow passed after deployment.
3. A later provider receipt-read failure downgraded previously confirmed funding to manual review. Preserve verified evidence on provider unavailability; continue to reject contradictory receipts. The live attempt's manual-review record and failed same-hash recovery are retained as evidence, not rewritten directly in the database. At 16:42 UTC the service was found pointing to a concurrently deployed checkout at `8655953`, whose source lacks the RPC fixes. The later production regression therefore does not establish failure of the configured-RPC patch.

Provider delivery failure has not been diagnosed: the durable record deliberately treats a timeout, failed response or interrupted verification as unknown. Current FUNDED state alone cannot authorize a repeat POST. No unsupported provider status URL was guessed.

## Validation and continuation

Initial full workspace build and the final production web build passed. All 29 focused commerce composition and browser RPC tests passed; ESLint and the text-artifact secret scan passed. Final tested code commit: `8b873c0`, built in `.next-mainnet-e2e-v3`; this final build is not deployed. Tests cover configuration propagation, receipt recovery, preservation during provider outages and rejection of contradictory receipts. `scripts/mainnet-e2e-proof.ts` is read-only and can refresh public receipts without the wallet:

```sh
pnpm exec tsx scripts/mainnet-e2e-proof.ts
```

Continue by reading job 56764 and recovering its genuine provider submission receipt, if one appears. Verify the receipt-derived manifest URL and committed content, inspect the report, then perform buyer acceptance/eligible settlement under the pinned policy. Do not blindly repeat delivery or funding. If the provider never submits, the job expires at Unix `1789577755`; confirm refund eligibility on chain before presenting a refund transaction. Publish and read back the new completed-job Greenfield object only after actual completion. Creator grant/deployment and revoke/deny remain unproven.

Historical Greenfield object URLs, create hashes, byte lengths and readback hashes are in `greenfield-readback.json` and `greenfield-objects.json`. An all-zero seal hash is unavailable evidence, not a seal transaction.

The first two runtime fixes were deployed through the existing systemd service and tunnel for successful funding. A concurrent deployment subsequently replaced the same drop-in with `/home/ubuntu/bnbera-prod-8655953` and `.next-production-8655953`. An attempted final-build switch stopped at a guard before editing that changed file; the service was restarted on its existing configuration and returned HTTP 200. The concurrent deployment was preserved. Integrate and deploy these fixes into the current release before continuing UI recovery. Inspect current service ownership before changing or removing any drop-in. Preserve the database and all job history. The temporary signing bridge was closed.
