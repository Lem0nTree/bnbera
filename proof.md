# BNBEra execution and Greenfield proof

Evidence snapshot: **9 September 2026**. This page explains recorded real transactions and storage artifacts, not simulated test results or a fresh status check.

**Testnet has completed hiring, delivery, settlement and Greenfield publication evidence. Mainnet has funded hiring and verified delivery evidence, but the recorded mainnet job has not settled or produced its own completed-job Greenfield bundle.** PR [#45](https://github.com/Lem0nTree/bnbera/pull/45) added the mainnet transaction evidence; it did not complete every stage.

## What has actually happened

“Not recorded” means the cited evidence does not establish that stage. It does not mean a transaction failed.

| Network / job / agent | Paid hire | Agent delivery | Buyer approval and settlement | Greenfield publication | Detailed evidence |
| --- | --- | --- | --- | --- | --- |
| BSC testnet (97), **1103**, agent **2206** | [Funded](https://testnet.bscscan.com/tx/0x0b005abb90ee3238204b2b989ca36e0924b9e0842b3464961d1def3a9ac67afc) | Useful health-factor result; [submitted](https://testnet.bscscan.com/tx/0x8343f2402aa567f274340538fb4798125a67d93d10f308017659dc84bc0fddf1) | Approved and [settled](https://testnet.bscscan.com/tx/0x8f580a37cb22ec2f5c19c78cb9f3371caee02426e60c499bd9b18064ede3f26f); operator verified-purchase review | **Yes:** historical version 11 agent profile and completed-job run bundle, on Greenfield testnet | [MVP status](docs/MVP-STATUS.md), [stored objects](docs/release-evidence/mainnet-e2e-2026-09-09/greenfield-objects.json) |
| BSC testnet (97), **1171**, agent **2293** | [Funded](https://testnet.bscscan.com/tx/0x4db852572ec70d46170890a2db71e5b45981a96ae711e741e73598d89e693c74), 0.001 test U | Health factor **1.6**; [submitted](https://testnet.bscscan.com/tx/0x018f94078a5f4455dc2ec356a55016083bdb4ed02a4951a530e89837a41d5be2) | Explicit approval and [settlement](https://testnet.bscscan.com/tx/0x248f0794c44dff4567d1c3692f5caebcacb8fe9df83e0218ded16caac65e78f1); provider paid | No bundle for this job recorded | [Commerce review](docs/PROTOCOL-COMMERCE-REVIEW.md) |
| BSC testnet (97), **1177**, agent **2293** | [Funded](https://testnet.bscscan.com/tx/0xa361c0a47c84e4a66c02b76c933e7a9d9e3aa0f68d313fa6306cfc185d9c3697), 0.001 test U | Worker automatically picked up the funded job; health factor **2.4**; [submitted](https://testnet.bscscan.com/tx/0x8b4af3084f439cb43b46dc7d2059cfd63a72048243a7b1892bf5d3f8a654607e) | Explicit approval and [settlement](https://testnet.bscscan.com/tx/0xa833c0a88f94a14e0b21bdde7dc1d1b2681059fc9eb2e4151e29fee8e927a188); provider paid | No bundle for this job recorded | [Commerce review](docs/PROTOCOL-COMMERCE-REVIEW.md) |
| BSC mainnet (56), **56765**, Grid agent **303779** | [Funded](https://bscscan.com/tx/0xead646ad5da6f15ca2e8bf453ec41fa34e6947a21ffba6db43acd72a9d62c7a6), 0.01 U | [Submitted](https://bscscan.com/tx/0x622db01ef41fe6b866ef32b47d7b77d21af3b80f864760919668af8fa8dc1b83); result digest verified and report displayed | Review checkbox checked, **no persisted approval, settlement transaction or provider payout recorded** | No completed-job bundle for 56765 | [Mainnet Grid proof](docs/release-evidence/mainnet-e2e-grid-2026-09-09/README.md) |
| BSC mainnet (56), **56764**, Loan Health agent **341565** | [Funded](https://bscscan.com/tx/0x467b2877cb32b3b17ddbcf4d34c270ebafc2b274aadc9cd87c2f9c1a3fee5f1a), 0.01 U | Notification outcome unknown; reconciliation showed awaiting provider, with no verified result | Not recorded | Not recorded | [Earlier mainnet attempt](docs/release-evidence/mainnet-e2e-2026-09-09/README.md) |

Earlier Grid job **56763** was created and policy-registered, but its quote expired before funding. It is not a paid hire. Unknown notification outcomes were reconciled rather than blindly retried.

Job 1103 used an operator EOA canary. Jobs 1171 and 1177 exercised WalletConnect/SIWE with an operator-controlled peer. Mainnet job 56765 used the deployed browser with an operator-controlled EIP-1193 bridge; it does not prove a real MetaMask or WalletConnect extension journey. These are operator execution proofs, not independent customer endorsements.

Agent identities include their network and registry, not just their numeric ID:

- Testnet 2206: `eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e:2206`.
- Testnet 2293 uses the same testnet registry.
- Mainnet Grid: `eip155:56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:303779`.

The Grid delivery calculates nine hypothetical BNB/USDT levels from 700 to 900, spaced by 25, with allocations totaling 1000 and risk triggers at 665 and 945. It does not execute trades or take custody. See the [recorded result verification](docs/release-evidence/mainnet-e2e-grid-2026-09-09/result-verification.json).

## What “estimates settlement timing” means

The current app calculates:

```text
app estimate = time the app observed the submission + contract dispute window
actual policy boundary = on-chain submittedAt + contract dispute window
```

For mainnet job **56765**, the recorded on-chain `submittedAt` is `1788976407`. With the selected policy's **604800-second (seven-day)** window:

| Timestamp | Recorded value (UTC) | Meaning |
| --- | --- | --- |
| On-chain submission | 9 September 2026, 17:53:27 | Contract starts its window here |
| Exact policy boundary | **16 September 2026, 17:53:27** | Approval becomes possible if no rejection verdict takes precedence; disputes must be submitted before this boundary |
| App estimate | 16 September 2026, 17:55:59 | **2 minutes 32 seconds late** because the app observed delivery later |

The estimate is conservative for payout, but it is **not safe to use as the last time to dispute**. Neither timestamp means funds move automatically: settlement still requires a successful transaction.

The original “policy verdicts still need integration” gap meant the panel did not read the policy's actual **Pending / Approve / Reject** decision. This change adds a direct `check(jobId, "0x")` read for submitted jobs and displays that verdict on each status refresh. RPC failures display **Unavailable**, never inferred approval. The selected contract can reject before seven days when a buyer dispute receives enough authorized rejection votes. A dispute alone does not permanently block approval. A timer reaching zero cannot establish the current verdict.

The remaining integration is to read the job's exact policy submission time, dispute window, dispute state and rejection votes/quorum alongside its chain state and block time, then use those facts and the verdict for the displayed deadline and available actions. The minimal verdict display does not replace the existing timing gate or change transaction authorization. Missing policy reads must not be treated as approval. This is a remaining application integration task; the contract already enforces its rules.

## Which rules belong to APEX, Altana and BNBEra?

| Behavior | Where it comes from |
| --- | --- |
| Seven days before ordinary mainnet payout approval | The **selected deployed APEX OptimisticPolicy**, `0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5`. Seven days is not universal to all APEX policies or ERC-8183 jobs. |
| Shorter testnet wait | The recorded runs for jobs 1171 and 1177 used a **900-second (15-minute)** dispute window. Different deployments can have different windows. |
| Read the delivered report immediately | Delivery is available before settlement. The seven-day window delays ordinary payout approval, not access to the result. |
| Cannot save acceptance separately while waiting | **BNBEra design:** the app currently combines persisted buyer approval with requesting settlement, and checks its timing gate first. The review checkbox alone does not save acceptance. |
| No early payout override through the SDK | The integrated Altana approval action calls the settlement router, which obeys the selected policy. Altana is not the source of the seven-day window. |
| Settlement can be called by someone other than the buyer | The APEX router permits settlement subject to the policy. BNBEra's approval screen does not give the buyer an exclusive on-chain payout veto. |

The [activation policy review](docs/ACTIVATION-POLICY-REVIEW.md) records the UI changes and remaining integration gap. The contract rules are documented in the pinned [OptimisticPolicy](https://github.com/bnb-chain/apex-contracts/blob/b40b18011407ba13516661d3784bcb727a0c7794/contracts/OptimisticPolicy.sol) and [EvaluatorRouter](https://github.com/bnb-chain/apex-contracts/blob/b40b18011407ba13516661d3784bcb727a0c7794/contracts/EvaluatorRouterUpgradeable.sol). The current estimate is implemented in [commerce-server.ts](apps/web/src/lib/commerce-server.ts).

## What we published to Greenfield

The historical publications are on **Greenfield testnet, SDK chain ID 5600**. Both objects were recorded as verified on 8 September and read back on 9 September at 16:12:24 UTC with HTTP 200 and matching SHA-256 hashes.

| Artifact | Identity and scope | Public object | SHA-256 of recorded readback |
| --- | --- | --- | --- |
| Agent profile | Testnet agent 2206, historical version 11 | [agent_profile.json](https://gnfd-testnet-sp1.bnbchain.org/view/bnbera-t8-230072625f8090d5271c5f882748ce11134ac2ba/evidence/hackathon/agent_profile/agent-2206/versions/11/agent_profile.json) | `69e0294f83908f355a1a883c98768b52786a3f88439cf6f02fcd5b63e70279d8` |
| Completed-job run bundle | Testnet job 1103, agent 2206, historical version 11 | [run_bundle.json](https://gnfd-testnet-sp1.bnbchain.org/view/bnbera-t8-230072625f8090d5271c5f882748ce11134ac2ba/evidence/hackathon/run_bundle/run-b5a033ff-f4a9-5622-97c6-d0594a501db8/versions/11/run_bundle.json) | `12cba7d6a989d2603a525bb4965d84fe5bff4569f106a0ce3decb84d56e24446` |

The [readback record](docs/release-evidence/mainnet-e2e-2026-09-09/greenfield-readback.json) includes object-creation transaction hashes. Seal transaction hashes are unavailable (`null`); this page does not claim separate seal transaction receipts. The committed [profile](docs/release-evidence/mainnet-e2e-2026-09-09/greenfield-agent_profile.json) and [run bundle](docs/release-evidence/mainnet-e2e-2026-09-09/greenfield-run_bundle.json) preserve the historical payloads. Successful storage/readback proves those bytes were retrievable; fields marked `unknown` in the bundle are not independently validated by that fact.

**Reading these objects again during the mainnet run was not a new publication for a mainnet job.** They still refer to testnet job 1103 and its historical agent profile, not job 56765 or the agent's current version.

Greenfield itself does not impose the APEX seven-day delay. BNBEra's current [completed-job bundle builder](packages/greenfield/src/t8-inputs.ts) requires commerce to be `settled`, protocol state `completed`, and result state `settled`. Testnet could reach that completed state and publish its proof. Mainnet job 56765 had only reached submitted delivery in the recorded evidence, so it was not yet eligible for this bundle. Publishing an agent profile is a separate operation.

To finish the mainnet proof, re-read the actual policy and job state, complete the authorized approval/settlement flow when permitted, confirm the receipt and provider payout, then publish and read back a **new bundle bound to job 56765**. A BSC mainnet job stored on Greenfield testnet would still be Greenfield **testnet** storage; the two networks must be labeled separately.
