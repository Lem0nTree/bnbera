# BNBEra Greenfield Data and Evidence Plan

**Status:** Approved implementation plan
**Revision:** 1.2
**Date:** 2026-09-01

This document defines how BNBEra uses BNB Greenfield to publish independently verifiable agent profiles, decisions, deliverables, execution evidence, and hackathon benchmarks.

Related plans:

- [Marketplace donor merge](./01-marketplace-donor-merge-plan.md)
- [No-code agent deployer](./03-no-code-agent-deployer-plan.md)
- [Complete BNBEra implementation plan](./04-bnbera-master-implementation-plan.md)

Official references:

- [Greenfield introduction](https://docs.bnbchain.org/bnb-greenfield/introduction/)
- [Greenfield JavaScript SDK](https://docs.bnbchain.org/bnb-greenfield/for-developers/apis-and-sdks/sdk-js/)
- [Resource mirroring semantics](https://docs.bnbchain.org/bnb-greenfield/for-developers/cross-chain-integration/mirror-concept/)
- [Greenfield FAQ](https://docs.bnbchain.org/bnb-greenfield/getting-started/general-faqs/)

## 1. Role in BNBEra

Greenfield is the canonical public evidence and artifact-provenance layer for records BNBEra publishes. It does not determine a listing's `origin_type`, owner claim, verification, runtime health, execution authority, or publication state, and it is not required for externally discovered supply.

It provides:

- Versioned public agent profiles.
- Public capability and authority manifests.
- Decision and risk evidence.
- Transaction-linked run records.
- ERC-8183 deliverable provenance.
- x402/B402 payment receipts.
- TermiX benchmark inputs and outputs.
- A final submission evidence index.

Greenfield is not described as putting the payload inside BSC calldata. Its chain records object metadata, permissions, integrity, billing, and seal state while storage providers retain the payload.

## 2. Dual-publishing decision

Use both IPFS and Greenfield:

- IPFS remains the Agent Studio-compatible deliverable provider for ERC-8183.
- Greenfield stores the canonical, structured audit package.
- The same canonical content hash connects the IPFS object, Greenfield object, ERC-8183 output, marketplace run, and BSC transaction.
- The final evidence index is sealed, read back, hash-verified, and linked from BNBEra profiles, jobs, and run records.

Greenfield supplements Agent Studio storage rather than pretending to be a built-in Studio storage option when it is not configured as one.

Greenfield resource mirroring is explicitly outside the hackathon critical path. Mirroring creates an EVM-side resource representation and changes management semantics; it is not treated as a lightweight checksum anchor.

## 3. Environment separation

Use different configured buckets for:

- Development.
- Preview/test automation.
- Hackathon production.
- Future mainnet production.

Bucket names are configured because Greenfield names must be unique. Do not hardcode a globally assumed name in application source.

Network defaults:

- Greenfield testnet for the hackathon environment.
- BSC testnet for BNBEra-created write demonstrations unless the main-track network gate requires chain-56 category coverage.
- Autonomous BSC mainnet writes disabled until separately approved; read-only chain-56 discovery and evidence links remain allowed for the main-track fallback.

Every evidence record stores the exact BSC chain ID. Evidence from chain 56 and chain 97 is never combined into one execution claim.

## 4. Object model

```text
agents/{namespace}/{chainId}/{identityRegistry}/{agentId}/versions/{version}/profile.json
agents/{namespace}/{chainId}/{identityRegistry}/{agentId}/versions/{version}/capabilities.json
agents/{namespace}/{chainId}/{identityRegistry}/{agentId}/versions/{version}/authority.json
runs/{jobId}/bundle.json
runs/{jobId}/deliverable.json
benchmarks/{taskId}/comparison.json
submission/evidence-index.json
```

Object names are deterministic and versioned. Namespace and registry-address path segments are canonicalized and validated. Existing objects are never silently overwritten to represent a new agent or run state.

### 4.1 Agent profile

Contains:

- Schema version.
- BSC chain ID.
- Full ERC-8004 identity: namespace, BSC chain ID, identity-registry address, and agent ID.
- Agent name, description, and category.
- Marketplace URL.
- Advertised and validated service descriptors, including A2A, MCP, ERC-8183, and X402 when present.
- Template slug, version, and digest when the agent was created from a verified BNBEra strategy.
- Supported protocols and assets.
- Pricing summary.
- Capability-manifest hash.
- Altana smart-wallet address when applicable.
- Public execution-policy summary when applicable.
- Creation and verification timestamps.

### 4.2 Capability object

Contains:

- Capability IDs and descriptions.
- Versioned input and output JSON Schemas.
- Required protocol and network.
- Allowed action classes.
- Required data sources.
- Maximum supported task bounds.
- Evidence produced by a successful run.

### 4.3 Authority object

Contains public, onchain-verifiable information only:

- Altana wallet address.
- Session public address.
- Registered Keystore reference.
- Allowlisted contracts and selectors.
- Token spend limits.
- Expiry.
- Grant or renewal transaction hash.
- Last verified block.
- Active, expired, or revoked status.

It never contains a private key, password, serialized session, authentication token, or AWS reference.

### 4.4 Run bundle

Contains:

- Run and job IDs.
- Agent and template version.
- Observed timestamp and block number.
- Typed data-source snapshots.
- Candidate actions.
- Rejected actions and reasons.
- Selected action.
- Simulation output.
- Risk validations.
- Altana policy validation.
- Quote and price limits.
- Transaction hash and receipt summary.
- Before and after protocol state.
- IPFS deliverable URI.
- Content hashes.
- Final run status.

### 4.5 Benchmark comparison

Contains:

- Exact task.
- Starting data and timestamp.
- Measurement window and sample size.
- Manual method and actual output.
- Agent method and actual output.
- Time.
- Direct cost.
- Gas and marketplace payment.
- Wins/losses where meaningful, realized benefit or PnL, capital at risk, and maximum drawdown for trading records.
- Failure count and retry treatment.
- Quality rubric and scores.
- Risk violations.
- Methodology, transaction links, and evidence links.
- Conclusion derived from the measurements.

## 5. Data classification

### Public and publishable

- Verified agent metadata.
- Capability manifests.
- Public endpoints.
- Public Altana policy.
- Public onchain positions used by the task.
- Decisions and simulations after schema redaction.
- Transaction receipts.
- Deliverables explicitly approved for public publication.
- Benchmark inputs and outputs.

### Forbidden

- Private keys or seed phrases.
- Altana session serialization.
- Wallet passwords.
- AWS credentials, ARNs containing sensitive context, or secret values.
- Authentication cookies, tokens, email addresses, or IP addresses.
- Internal prompts or chain-of-thought.
- Private portfolio data not already public.
- Unredacted errors or logs.
- Draft profiles without publication consent.
- User-submitted files outside approved types and size limits.

The publisher uses an allowlist schema. Redaction does not rely on trying to detect unknown secret-field names after the fact.

## 6. Canonicalization and hashing

Before publishing an object:

1. Validate it against its exact versioned Zod schema.
2. Select only allowed public fields.
3. Normalize addresses, chain IDs, atomic token amounts, timestamps, and transaction hashes.
4. Deterministically order JSON keys.
5. Serialize without environment-specific whitespace.
6. Calculate SHA-256 for storage integrity.
7. Calculate keccak256 as the secondary EVM-compatible content digest.
8. Record the schema version and hash algorithm.

The same canonical bytes are uploaded to IPFS and Greenfield when the deliverable is dual-published.

## 7. Publishing lifecycle

### State machine

```text
pending
  → validating
  → creating_object
  → uploading
  → awaiting_seal
  → reading_back
  → verified
```

Failure states:

- `validation_failed`
- `create_failed`
- `upload_failed`
- `seal_timeout`
- `readback_failed`
- `hash_mismatch`

### Operation

1. Create an `evidence_objects` record and idempotency key.
2. Validate and canonicalize the payload.
3. Submit the Greenfield create-object transaction.
4. Persist the transaction before continuing.
5. Upload the exact canonical bytes to the selected storage provider.
6. Poll object status with bounded backoff.
7. After sealing, download the object.
8. Recalculate SHA-256 and keccak256.
9. Compare size and hashes.
10. Mark the object verified only when readback matches.

A submitted transaction is not reported as a completed upload. A successful upload is not reported as sealed. A sealed object is not reported as integrity-verified until readback succeeds.

## 8. Idempotency and retry

- Object identity uses environment, object type, resource ID, version, and content hash.
- Before creating an object, check for an already verified matching record.
- If creation succeeded but upload failed, resume from upload.
- If upload succeeded but sealing is pending, resume polling.
- If a conflicting object name has a different hash, create the next immutable version and raise an audit event.
- Never replace a verified object with different bytes.
- Persist every Greenfield transaction before waiting for confirmation.

## 9. Small-object strategy

Greenfield charges a minimum size for small objects. Reduce waste by bundling related records:

- Put decision, simulation, policy validation, receipt, and before/after state into one `bundle.json`.
- Keep large deliverables as separate objects.
- Update the submission evidence index in deliberate batches rather than after every health check.
- Do not publish high-frequency raw monitoring samples; publish the snapshots relevant to a decision or benchmark.

## 10. Marketplace and chain linking

The final evidence index contains:

- Every BNBEra-created reference agent included in the submission.
- ERC-8004 identities.
- Template digests.
- Altana policy transactions.
- ERC-8183 jobs.
- x402/B402 receipts.
- Execution transaction hashes.
- Greenfield object locations and hashes.
- IPFS deliverable locations and hashes.
- TermiX comparisons.

After the index is sealed and read back:

1. Calculate and retain its SHA-256 and keccak256 digests.
2. Store the Greenfield object reference, seal transaction, readback result, and digest in PostgreSQL.
3. Link relevant BSC execution, Altana authority, ERC-8004, and ERC-8183 transaction hashes from the index without claiming that those transactions contain the Greenfield payload or index digest.
4. Link the verified index from BNBEra evidence pages and from BNBEra-controlled registration/job metadata where the pinned standards and ownership flow permit it.
5. Verify every outbound chain and storage link from the production evidence page.

No Greenfield mirror or custom BSC anchoring contract is required for the hackathon. A future mirroring feature requires its own ownership, permissions, cost, and lifecycle design.

## 11. Publisher security

- Run the publisher in AWS, not a browser or Vercel function.
- Use a dedicated low-balance Greenfield publisher wallet.
- Keep signing material in AWS Secrets Manager.
- Give the publisher no access to Altana session secrets.
- Restrict IAM to the publisher's own secret and operational resources.
- Limit supported MIME types and object sizes.
- Apply per-agent and global publishing rate limits.
- Redact structured logs.
- Never accept an arbitrary bucket, object name, storage provider, or callback URL from the browser.

## 12. UI presentation

Use Greenfield green `#22C55E` and a dark green surface `#10261A` for:

- Greenfield logo/label.
- Object created/uploaded/sealed/verified progress.
- Evidence integrity.
- Provenance links.

The BNBEra primary action color remains purple. BSC transactions use yellow. Every Greenfield state includes a text label and icon so color is not the only signal.

The evidence page displays:

- Object name and version.
- Greenfield network.
- Creation transaction.
- Seal state.
- Size.
- SHA-256 and keccak256.
- Readback verification time.
- Associated BSC transaction.
- IPFS counterpart when present.
- Downloadable human-readable JSON.

## 13. Monitoring

Track:

- Create-object transaction success.
- Upload success.
- Time to seal.
- Readback success.
- Hash mismatches.
- Retry count.
- Bytes and minimum-size overhead.
- Publisher wallet balance.
- Storage-provider availability.
- Marketplace/profile link state.

Alert immediately on a hash mismatch or evidence marked verified without a completed readback.

## 14. Tests

### Unit

- Schema validation.
- Secret-field rejection.
- Canonical JSON stability.
- Hash calculation.
- Deterministic object names.
- Idempotency.
- Version-conflict handling.

### Integration

- Create a testnet object.
- Upload canonical bytes.
- Observe sealing.
- Read it back and match hashes.
- Retry after an interrupted upload.
- Dual-publish matching bytes to IPFS.
- Verify that the evidence page resolves the sealed index and displays linked BSC transaction references as ordinary verified links, not as an extra on-chain commitment.

### Security

- Reject private-key-like and forbidden schema fields.
- Reject unexpected MIME types and oversized objects.
- Reject path traversal and arbitrary bucket/object input.
- Confirm no AWS or Altana secret appears in payloads or logs.

## 15. Acceptance criteria

- Each BNBEra-created reference agent has a sealed, readable versioned profile.
- Externally discovered agents may be listed without BNBEra Greenfield evidence; any evidence badge requires a sealed, read-back-verified object.
- Each required live run has a verified run bundle.
- ERC-8183 deliverable hashes agree across the job, IPFS, Greenfield, and PostgreSQL.
- The final evidence index is sealed, readable, and links to the exact BSC network and transactions represented by each run.
- If the TermiX bounty is targeted, the report contains actual inputs and outputs, at least one trading/stock/security task, and the required measurement-window, track-record, cost, and risk fields.
- No private or secret data is published.
- The UI distinguishes pending, uploaded, sealed, and verified states.
- Greenfield is represented accurately as storage-chain metadata plus storage-provider payloads.

## Changelog

- **1.2 — 2026-09-01:** Aligned evidence terminology with independent origin/claim/listing state, made service descriptors discovery-based, and completed the conditional TermiX track-record schema.
- **1.1 — 2026-09-01:** Removed Greenfield mirroring and ambiguous digest anchoring from the hackathon path, added explicit marketplace/transaction linking and full ERC-8004 identity paths, aligned evidence with the main-track network gate, and made Greenfield optional for externally discovered listings.
- **1.0 — 2026-09-01:** Initial approved Greenfield evidence plan.
