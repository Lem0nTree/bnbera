# BNBEra Greenfield Data and Evidence Plan

**Status:** Approved implementation plan
**Revision:** 1.0
**Date:** 2026-09-01

This document defines how BNBEra uses BNB Greenfield to publish independently verifiable agent profiles, decisions, deliverables, execution evidence, and hackathon benchmarks.

Related plans:

- [Marketplace donor merge](./01-marketplace-donor-merge-plan.md)
- [No-code agent deployer](./03-no-code-agent-deployer-plan.md)
- [Complete BNBEra implementation plan](./04-bnbera-master-implementation-plan.md)

Official references:

- [Greenfield introduction](https://docs.bnbchain.org/bnb-greenfield/introduction/)
- [Greenfield JavaScript SDK](https://docs.bnbchain.org/bnb-greenfield/for-developers/apis-and-sdks/sdk-js/)
- [Cross-chain dApp integration](https://docs.bnbchain.org/bnb-greenfield/for-developers/cross-chain-integration/dapp-integration/)
- [Greenfield FAQ](https://docs.bnbchain.org/bnb-greenfield/getting-started/general-faqs/)

## 1. Role in BNBEra

Greenfield is the canonical public evidence and provenance layer.

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
- The final Greenfield evidence index is mirrored or anchored to BSC testnet through supported cross-chain tooling.

Greenfield supplements Agent Studio storage rather than pretending to be a built-in Studio storage option when it is not configured as one.

## 3. Environment separation

Use different configured buckets for:

- Development.
- Preview/test automation.
- BSC testnet production.
- Future mainnet production.

Bucket names are configured because Greenfield names must be unique. Do not hardcode a globally assumed name in application source.

Network defaults:

- Greenfield testnet for the hackathon environment.
- BSC testnet for evidence anchoring.
- Mainnet disabled until separately approved.

## 4. Object model

```text
agents/{chainId}/{agentId}/versions/{version}/profile.json
agents/{chainId}/{agentId}/versions/{version}/capabilities.json
agents/{chainId}/{agentId}/versions/{version}/authority.json
runs/{jobId}/bundle.json
runs/{jobId}/deliverable.json
benchmarks/{taskId}/comparison.json
submission/evidence-index.json
```

Object names are deterministic and versioned. Existing objects are never silently overwritten to represent a new agent or run state.

### 4.1 Agent profile

Contains:

- Schema version.
- BSC chain ID.
- ERC-8004 agent ID.
- Agent name, description, and category.
- Marketplace URL.
- A2A, MCP, ERC-8183, and x402 endpoints.
- Template slug, version, and digest.
- Supported protocols and assets.
- Pricing summary.
- Capability-manifest hash.
- Altana smart-wallet address.
- Public policy summary.
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
- Manual method and actual output.
- Agent method and actual output.
- Time.
- Direct cost.
- Gas and marketplace payment.
- Quality rubric and scores.
- Risk violations.
- Transaction and evidence links.
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
7. Calculate keccak256 for EVM anchoring.
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

## 10. BSC anchoring

The final evidence index contains:

- Every reference agent.
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

1. Calculate its EVM-compatible digest.
2. Mirror the object through supported Greenfield cross-chain functionality or anchor its digest in the selected BSC evidence transaction.
3. Store the BSC transaction in the database and index.
4. Verify both directions from the production evidence page.

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
- Cross-chain anchor state.

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
- Verify the evidence index anchor from BSC.

### Security

- Reject private-key-like and forbidden schema fields.
- Reject unexpected MIME types and oversized objects.
- Reject path traversal and arbitrary bucket/object input.
- Confirm no AWS or Altana secret appears in payloads or logs.

## 15. Acceptance criteria

- Each reference agent has a sealed, readable versioned profile.
- Each required live run has a verified run bundle.
- ERC-8183 deliverable hashes agree across the job, IPFS, Greenfield, and PostgreSQL.
- The final evidence index is sealed, readable, and linked to BSC testnet.
- The TermiX report contains actual inputs and outputs.
- No private or secret data is published.
- The UI distinguishes pending, uploaded, sealed, and verified states.
- Greenfield is represented accurately as storage-chain metadata plus storage-provider payloads.

## Changelog

- **1.0 — 2026-09-01:** Initial approved Greenfield evidence plan.
