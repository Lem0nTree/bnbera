# Wave 0 and Wave 1 activation guide

**Status:** operator checklist
**Environment:** AWS development host, BSC testnet first
**Rule:** never send a seed phrase, private key, passkey export, wallet password,
AWS secret value, or provider token in chat or commit it to Git.

This guide turns the validated Wave 0/1 development baseline into a controlled
testnet run. It separates information the operator may safely share from
secrets that must be entered directly into the target environment.

The current repository is not yet a complete production application. Wave 0
and the durable ERC-8004 ingestion path can run now. Live Altana, ERC-8183,
X402/B402, Greenfield, and IPFS acceptance also require production adapters or
verified standards-lock entries where explicitly noted below.

## 1. What the operator must provide

### Safe to provide in an issue or chat

- AWS account ID, selected region, and IAM role/profile name (never its secret);
- public wallet and smart-account addresses;
- public RPC origins, without API keys in their URL;
- public service domain and intended SIWE domain;
- selected BSC testnet contract addresses and four-byte selectors;
- Greenfield bucket name and selected public storage-provider endpoint;
- IPFS provider name and public gateway origin;
- B402 facilitator origin, merchant identifier, pay-to address, token address,
  decimals, payment method, and trusted spender addresses;
- transaction hashes, agent IDs, object locators, content hashes, and other
  public testnet evidence.

### Enter directly on the host or in the provider console

- wallet password or bounded session material;
- AWS access keys if an instance role or SSO cannot be used;
- Altana account authentication/passkey interaction;
- LLM, 8004scan, B402/facilitator, IPFS, relay, and private RPC tokens;
- any encrypted wallet keystore JSON.

Prefer an EC2 instance profile, AWS SSO, and AWS Secrets Manager. Do not paste
these values into an SSH command because commands can remain in shell history.
Use hidden prompts or the provider's secret-injection workflow.

## 2. Credential collection worksheet

| Capability | Obtain from | Public/reference value to provide | Secret destination | Required now? |
| --- | --- | --- | --- | --- |
| AWS runtime | AWS IAM console: create/select a least-privilege EC2/AgentCore role | account ID, region, role name | EC2 instance profile or AWS SSO; avoid static keys | Yes for AWS deploy |
| Runtime secrets | AWS Secrets Manager in the selected region | secret name/ARN reference only | Secrets Manager | Yes for deployed signing |
| BSC RPC | BNB public endpoints or a chosen RPC provider | credential-free RPC origin | Secrets Manager only if a private endpoint needs a token | Public RPC works now |
| Operator wallet | Create a new BSC-testnet-only wallet through Agent Studio/Altana | public address | encrypted keystore plus hidden password, or Altana scoped session | Yes for chain writes |
| Test gas | BNB Chain testnet faucet | funding transaction hash | No secret | Yes for chain writes |
| Altana authority | Create/recover a passkey wallet in the Altana browser flow | administrator, smart-wallet, and session public addresses | user device/passkey; bounded session goes to the approved runtime secret | Yes for Altana acceptance |
| Agent Studio LLM | `bag llm activate` (the default free provider uses SIWE) or selected LLM console | provider and model name | runtime secret created by Studio/provider | Yes for an LLM-backed agent |
| 8004scan | 8004scan provider account if the selected API requires auth | plan/API origin | Secrets Manager | Only for live 8004scan adapter |
| ERC-8004 | Agent Studio registration on BSC testnet | agent ID, owner, `agentWallet`, endpoint, registration tx | signing wallet/session above | Yes for live identity registration |
| ERC-8183 | Official Studio deployment/config plus verified BSC testnet contracts | commerce/router/policy/token addresses and ABI hashes | funded buyer/provider/evaluator signer references | Blocked until lock and chain adapter are completed |
| B402/X402 | Selected B402 facilitator/merchant onboarding | facilitator origin, merchant ID, pay-to and asset details | facilitator/relay token in Secrets Manager | Blocked until production adapter and paid canary |
| Greenfield | BNB Greenfield testnet plus chosen official storage provider | network, bucket, provider endpoint | testnet signer/session in Secrets Manager | Blocked until adapter and SDK/provider pins |
| IPFS | Selected pinning provider dashboard | provider and gateway origin | pinning API token in Secrets Manager | Blocked until production adapter |

There is no credential that resolves an unknown ERC-8183 contract address or a
missing production adapter. Those are implementation/configuration tasks and
must pass the lock checks before any secret is installed.

## 3. Retrieve and prepare each input

### Step 1 — AWS role and secret channel

1. In the AWS console, open **IAM → Roles** and create or select a role for the
   development EC2 instance and AgentCore runtime.
2. Grant only the services and resources used by the deployment. Scope Secrets
   Manager access to the single BNBEra test secret; do not use AdministratorAccess.
3. Attach the EC2 role as the instance profile. For interactive AgentCore
   provisioning, prefer AWS SSO. Use static access keys only as a last resort.
4. In **Secrets Manager**, create the runtime secret in the selected region.
   The Studio security model uses references such as `WALLET_KEYSTORE_JSON` and
   `WALLET_PASSWORD`; values remain outside the code artifact.
5. Provide only: AWS account ID, region, role name, and secret ARN/name.

The AWS CLI is useful for inspection and SSO/profile setup, but current Agent
Studio documentation says it is not itself required for deployment; its
readiness use is a read-only AgentCore quota check.

### Step 2 — Public domains and base runtime configuration

1. Choose the development service URL, for example an HTTPS subdomain owned by
   the project. Configure DNS and TLS before ERC-8004 endpoint registration.
2. Provide `APP_URL` and the exact `SIWE_DOMAIN` (host and port when applicable).
3. Use the existing local PostgreSQL socket URL on the AWS host unless remote
   database access is deliberately introduced.
4. Start with the official public BSC endpoints already present in
   `.env.example`. A private RPC account is optional for the first test.

### Step 3 — Create the disposable testnet wallet

Use one of these custody paths, in order of preference:

1. **Altana passkey/scoped session:** the operator creates or recovers the
   administrator wallet in the browser and grants only a short-lived session.
   The runtime receives the session, never the administrator key.
2. **Agent Studio encrypted test wallet:** run `bag wallet new` and enter a new
   `WALLET_PASSWORD` through a hidden prompt or Studio's ignored local secret
   file. Never reuse this wallet or password on mainnet.

Record and provide the public address only. Fund it from the
[BNB testnet faucet](https://testnet.bnbchain.org/faucet-smart), then provide
the public funding transaction hash. Keep only the minimum tBNB needed for the
registration and canary transactions.

### Step 4 — Create the Altana authorization

1. Open the [Altana documentation](https://docs.altana.network/) and select the
   passkey-wallet/testnet flow on a device controlled by the operator.
2. Use BNB Testnet, chain ID `97`. The published testnet relay is
   `https://testnet-relay.altana.network`.
3. Before approval, provide the intended target contract and selector. Set
   native value to zero unless the selected call requires it; set explicit
   token limits and a short expiry.
4. Review and approve the session in the browser. Do not export the passkey or
   administrator private key.
5. Hand the bounded session to the single AWS secret destination supported by
   the pinned Studio integration.
6. Provide only the public administrator/smart-wallet/session addresses,
   policy bounds, expiry, grant transaction hash, and secret reference.

The acceptance test must execute one permitted action, revoke the session in
the browser, and prove that the same action is rejected afterward.

### Step 5 — Install and activate Agent Studio

On the AWS host, after reviewing the package/version pins:

```bash
npm install --global @bnbagent/studio-cli
bag --version
bag init bnbera-agent \
  --runtime agentcore \
  --network bsc-testnet \
  --wallet-kind altana \
  --protocols A2A,MCP,X402 \
  --storage-provider ipfs \
  --no-onboard
bag doctor
```

Use `bag llm activate` for the Studio default provider or install a selected
provider token directly in the runtime secret store. Never provide that token
in chat. Run `bag dev` before attempting a cloud deployment.

### Step 6 — ERC-8004 identity and ingestion

1. Make the agent endpoint publicly reachable over HTTPS.
2. Run `bag erc8004 register --endpoint https://<approved-domain>` and approve
   the testnet transaction with the bounded signer.
3. Provide the public registration transaction, agent ID, owner address,
   verified `agentWallet`, and endpoint.
4. Run BNBEra ingestion against the durable PostgreSQL repository and verify
   the canonical ownership/wallet distinction, services, probes, checkpoint,
   and re-open durability.
5. Add 8004scan credentials only when the production 8004scan adapter and its
   exact API contract have been selected. Registry ingestion does not require
   that credential.

### Step 7 — ERC-8183 commerce

Before requesting wallets or funds, implementation must:

1. resolve the conflicting testnet policy addresses;
2. pin the commerce proxy, router, policy, payment token, decimals, ABI hashes,
   evaluator, confirmation depth, budget, and expiry limits;
3. verify bytecode, proxy linkage, and token metadata;
4. implement PostgreSQL and live chain adapters matching the existing CAS and
   reconciliation contracts.

Then create three disposable testnet roles (buyer, provider, evaluator), or
three strictly separated scoped sessions, and fund only the required gas/token
amount. Exercise:

```text
publish → fund/buy → provider submit → buyer fetch → evaluator complete
```

Also test reject/refund and an ambiguous receipt/reconciliation case. Provide
only public addresses, job IDs, transaction hashes, and final states.

### Step 8 — X402/B402 payment canary

After selecting a supported facilitator:

1. create a test merchant account in its official dashboard;
2. record its public facilitator origin, merchant reference, pay-to address,
   token, decimals, supported authorization method, and trusted spenders;
3. place the facilitator/relay credential directly in Secrets Manager;
4. implement the production payment and persistent repository adapters;
5. enable testnet B402 only after the exact configuration is pinned;
6. use a disposable payer to complete one minimum-value paid request and
   reconcile the receipt on-chain.

An HTTP 402 response alone is not acceptance. The canary must bind the quote,
authorization, authenticated relay, settlement observation, receipt, and
delivery to one request correlation ID.

### Step 9 — Greenfield and IPFS evidence

1. Select a Greenfield testnet storage provider from the current official
   endpoint list and provide its public endpoint.
2. Create a unique test bucket and provide its name.
3. Use a disposable Greenfield testnet signer/session with bounded funds. The
   BNB documentation describes obtaining test BNB on BSC testnet and bridging
   it to Greenfield testnet.
4. Select an IPFS pinning provider; create a least-privilege project/token in
   its dashboard and store the token directly in Secrets Manager.
5. Pin the Greenfield SDK version, provider allowlist and readback endpoints,
   then implement the production Greenfield/IPFS and persistent repository
   adapters.
6. Publish one canonical evidence object and verify Greenfield sealing,
   provider readback, byte length, SHA-256, Keccak-256, and IPFS readback.

Provide only the bucket, object name, provider, transaction hash, CID/locator,
hashes, and verification result.

## 4. Execution plan and gates

### Gate A — Reproducible Wave 0 baseline

```bash
cd /home/ubuntu/bnbera
corepack pnpm install --frozen-lockfile
export DATABASE_URL='postgresql:///bnbera?host=/var/run/postgresql'
corepack pnpm db:migrate
corepack pnpm check
corepack pnpm ops:standards-check
```

Pass: dependency lock, migrations, all checks, both BSC chain IDs, latest
blocks, and configured ERC-8004 proxy/implementation bytecode all verify.

### Gate B — Durable Wave 1 identity

Run `ops:ingestion-smoke` in a disposable database, then ingest the registered
testnet agent into `bnbera`. Pass only when observations, canonical identity,
claim CAS, services, probes and checkpoints survive a pool restart.

### Gate C — Local Agent Studio faces

Run `bag doctor`, `bag dev`, and verify the A2A card/JSON-RPC, MCP endpoint and
X402 endpoint locally. This proves local protocol surfaces, not settlement.

### Gate D — Altana custody acceptance

Grant, execute one allowlisted testnet action, revoke, and prove deterministic
post-revocation rejection. Store only sanitized evidence using the checked-in
phase-zero template.

### Gate E — Hosted agent and ERC-8004 endpoint

Run Studio deployment preparation, deploy to the explicitly approved AWS
target, verify the live endpoint, and reconcile the ERC-8004 identity. Check
service logs and the actual protocol responses.

### Gate F — Commerce, payment and evidence

Enable each rail separately only after its production adapter, standards pin,
least-privilege credential, and minimum-value testnet canary pass. A failure in
one rail must not be hidden by another provider's success.

## 5. Recommended order for the operator

Provide these items in small batches:

1. **Batch 1:** intended GitHub repository confirmation, AWS region/account ID,
   IAM role name, public service domain, and whether Altana passkey is selected.
2. **Batch 2:** new testnet wallet/smart-account public address and faucet
   transaction hash; never its secret.
3. **Batch 3:** AWS secret reference and Altana session public metadata after
   the browser grant; install secret values yourself during a guided SSH step.
4. **Batch 4:** ERC-8004 agent ID, registration transaction and endpoint.
5. **Batch 5:** only after the implementation gates pass, facilitator/merchant
   public configuration, Greenfield bucket/provider, and IPFS provider name.

At every stage the operator supplies secret values through a hidden prompt or
provider console while the implementation records only references and public
evidence.

## 6. Primary references

- [BNB Agent Studio quickstart](https://docs.bnbchain.org/developer-kit/bnbchain-studio/quickstart/)
- [BNB Agent Studio CLI reference](https://docs.bnbchain.org/developer-kit/bnbchain-studio/cli-reference/)
- [BNB Agent Studio security](https://docs.bnbchain.org/developer-kit/bnbchain-studio/security/)
- [BNB Smart Chain wallet configuration](https://docs.bnbchain.org/bnb-smart-chain/developers/wallet-configuration/)
- [Altana documentation](https://docs.altana.network/)
- [Altana BNB testnet addresses](https://docs.altana.network/concepts/networks/testnet)
- [Greenfield testnet endpoints](https://docs.bnbchain.org/bnb-greenfield/for-developers/network-endpoint/endpoints/)
- [Greenfield test BNB guide](https://docs.bnbchain.org/bnb-greenfield/getting-started/get-test-bnb/)
