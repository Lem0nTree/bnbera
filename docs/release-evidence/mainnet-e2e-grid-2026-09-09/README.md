# Replacement mainnet hire — job 56765

**Funding and delivered work verified. Acceptance/settlement remains time-locked.**

At the user's request to try another mainnet agent, hired ERC-8004 **303779**, `marketplace-operated-grid-planner`, using buyer `0x230072625F8090d5271C5f882748ce11134ac2Ba`. Provider wallet: `0xA2a2012e52Fd075c0F3146e37E833E7294ee52B5`. Chain: BSC mainnet, **56**. Signed price: **0.01 U**; token `0xcE24439F2D9C6a2289F741120FE202248B666666`, 18 decimals. Quote/reservation: `805ac4d6-e973-4da7-a466-3394263dfbde`, agent version 2.

The actual deployed marketplace browser flow created, registered, budgeted, approved and funded new job **56765**. All five receipts succeeded. Remaining U allowance is **zero**. One delivery request was sent. It returned an unknown outcome, but subsequent chain and receipt reconciliation proved the provider submitted the exact result. The request was not repeated.

## Public transaction proofs

| Step | BSC mainnet transaction |
| --- | --- |
| Acquire exactly 0.01 U | [52eada…](https://bscscan.com/tx/0x52eada9c638fed12b666a7a16d96d41b8304fc4405e87204bef8de9179e31872) |
| Create job 56765 | [eb6333…](https://bscscan.com/tx/0xeb63336c9b39c15ad5d9cd6607640c31836ab2249d7cd4208f5ff7957c3b6a2c) |
| Register optimistic policy | [d5a9ba…](https://bscscan.com/tx/0xd5a9bac6c8039ee26d24b81618b1a4eaad9681e4ec7ae8e41d6e64215d917e23) |
| Set exact budget | [8b68f8…](https://bscscan.com/tx/0x8b68f8a53a9323627aefbf3ec144dbe9c010333afb790b1ec112cf7d3923dce5) |
| Approve exact token amount | [615db3…](https://bscscan.com/tx/0x615db35f73515040122336f7765204d3b294c2c3be4d16254ec184c839dfd1da) |
| Fund escrow | [ead646…](https://bscscan.com/tx/0xead646ad5da6f15ca2e8bf453ec41fa34e6947a21ffba6db43acd72a9d62c7a6) |
| Provider submits work | [622db0…](https://bscscan.com/tx/0x622db01ef41fe6b866ef32b47d7b77d21af3b80f864760919668af8fa8dc1b83) |

Raw public transactions and successful receipts are in `chain-audit.json`, `submission.json` and `payment-token-acquisition.json`. `transactions.ndjson` retains hashes recorded before buyer broadcasts. `paid-quote.json` retains the signed task/identity/price binding.

## Delivered work and review

The hypothetical task requested a BNB/USDT arithmetic grid from 700 to 900, nine levels and capital 1000. The delivered result has levels **700, 725, 750, 775, 800, 825, 850, 875, 900**, spacing **25**, allocations summing exactly to **1000**, and outer triggers **665 / 945**. The final level receives the rounding remainder. Buy levels are at or below midpoint 800; sell levels are above it. This is a calculation, with **no trading or custody**.

The policy event in the exact submission receipt points to the [provider result](https://bnb-agent-marketplace-ruby.vercel.app/api/sellers/grid/job/56765/response). After removing its `success` transport wrapper, the canonical manifest hashes to the on-chain commitment:

- Keccak: `0x3184a55488c862c06aa2feb8c58646604b88c89b7218c960b38502fed29ce7b4`
- SHA-256: `b08e20f96debc6c016616ea5df1b4df1983cf74311fd36d4fc63f8cd2eec8ed0`

Both independent content checks and the production app's `refresh-result` verification passed. The app displays **Your result is ready**. The operator checked **I reviewed this result and its exact evidence** after inspecting the content. That checkbox is a local review acknowledgement, **not persisted buyer approval or an on-chain settlement**. See `03-verified-result.png`, `browser-outcomes.json`, `provider-result.json` and `result-verification.json`.

## Remaining settlement and Greenfield work

The policy reports `submittedAt=1788976407` and `disputeWindow=604800`. Earliest on-chain settlement: **2026-09-16 17:53:27 UTC**. The app conservatively uses its later verified-result observation and displays **17:55:59 UTC** on that date. **Approve and settle** is disabled during this window. No settlement transaction was submitted, no completion event exists, and no provider payout is claimed.

After the window, re-read canonical job state and the exact result, perform the authorized buyer approval/settlement, verify its receipt and payout, and publish/read back the actual completed-job Greenfield object. Current-run Greenfield publication is not proven. The [first attempt's report](../mainnet-e2e-2026-09-09/README.md) retains historical testnet Greenfield hash checks and the failed testnet Creator authority attempt. Those do not prove new mainnet publication or successful creation.

Old loan-health job **56764** remains separately unresolved; it was neither retried nor overwritten. Earlier unfunded grid job **56763** was also retained. Only its browser's active operation/quote pointers were cleared to start this fresh hire; database history and previous transaction proofs remain intact.

## Runtime and test details

Integrated RPC and numeric-notification fixes from PR #45 were built successfully with `.next-mainnet-e2e-v4` and deployed to the existing service on port 3022; the existing tunnel was preserved. The source includes the current main branch's UI changes. This is an operator-controlled EIP-1193 test bridge, not a MetaMask or WalletConnect extension test. Keys stayed in process memory and the bridge was closed after funding/review.

The browser tab closed and later hit `ERR_INSUFFICIENT_RESOURCES` loading scripts. Recovery used the saved operation and original hashes. The budget dispatch had not reached the signing bridge: its pending queue was empty and the complete broadcast ledger contained only create/register. Its unsigned claim was released through the wallet-rejection recovery API and resumed once. No transaction was duplicated. Static JavaScript was subsequently fetched through Playwright's request client using the same public asset URLs and bytes to overcome browser resource errors. Full-page screenshot capture failed after funding; the later result viewport screenshot succeeded.

Automatic provider submission log lookup failed at the RPC. Read-only block lookup found the exact receipt using the confirmed policy timestamp and provider address. Supplying that public receipt through **Recover a provider submission** returned `result_verified` and persisted the result in the app. No result data was injected into application storage.

Reproduce public checks without signing:

```sh
pnpm exec tsx scripts/mainnet-e2e-proof.ts docs/release-evidence/mainnet-e2e-grid-2026-09-09
pnpm exec tsx scripts/mainnet-grid-result-proof.ts
```
