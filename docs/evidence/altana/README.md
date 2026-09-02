# Altana phase-zero evidence

[`phase-zero-evidence.template.json`](./phase-zero-evidence.template.json) is
the only checked-in starting artifact for the Altana → Agent Studio spike.
It is intentionally marked `not_run` and `design_only`. It contains no
credentials, serialized session, fabricated transaction hash, or claim of
successful deployment.

Replace `null` values only from a controlled run against the pinned Studio,
Altana SDK, AWS secret path, and BSC test environment. Keep the evidence
public and sanitized:

- record public addresses, policy bounds, version strings, transaction hashes,
  block references, and non-secret error codes;
- record only `secretHandoffAccepted` and a non-sensitive destination kind
  (for example `aws-secrets-manager`), never an ARN, name, or referenced value;
- never record private keys, seed phrases, passkey exports, serialized
  sessions, cookies, access tokens, passwords, raw environment files, or
  unredacted logs;
- distinguish local/simulated evidence from real testnet evidence;
- include a fresh active authority read bound to the exact session ID and
  policy digest before the permitted action;
- include the actual native value and token/native charges for each action and
  require them to match the expected action;
- require action, revocation, and post-revocation observations in chronological
  timestamp/block order when those references are available;
- never promote live evidence from a caller-fabricated attestor, test
  authority source, or local-only secret destination;
- do not mark the sequence passed unless the same bounded action is confirmed
  before revocation and rejected after revocation.

The runner's output is still subject to A0/A11 review. A valid transaction
hash, HTTP response, or health check on its own does not prove the complete
custody sequence.
