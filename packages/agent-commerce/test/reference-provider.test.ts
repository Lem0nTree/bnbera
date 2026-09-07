import { describe, expect, it, vi } from "vitest";
import { verifyErc8183ManifestText } from "@altananetwork/sdk";
import {
  CommerceError,
  Erc8183ReferenceProviderAdapter,
  Erc8183ReferenceProviderRunner,
  PostgresReferenceProviderJobSelector,
  REFERENCE_PROVIDER_MAX_BUDGET_ATOMIC,
  REFERENCE_PROVIDER_MAX_RESPONSE_BYTES,
  canonicalHealthFactorResultBytes,
  calculateReferenceHealthFactor,
  createReferenceHealthFactorProviderClient,
  createReferenceHealthFactorResult,
  createReferenceHealthFactorTask,
  erc8183DeploymentPinDigest,
  erc8183JobRecordSchema,
  healthFactorLendingSnapshotSchema,
  referenceProviderIdempotencyKey,
  referenceProviderReadinessConfigFromEnvironment,
  referenceProviderRunnerConfigFromEnvironment,
  referenceProviderSecretReferenceSchema,
  type Erc8183AltanaAuthority,
  type Erc8183CommerceService,
  type Erc8183JobKey,
  type Erc8183OperationRecord,
  type Erc8183ProviderBinding
} from "../src/index.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as `0x${string}`;
const ROUTER = "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25" as `0x${string}`;
const POLICY = "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea" as `0x${string}`;
const CLIENT = "0x3333333333333333333333333333333333333333" as `0x${string}`;
const PROVIDER = "0x4444444444444444444444444444444444444444" as `0x${string}`;
const OWNER = "0x7777777777777777777777777777777777777777" as `0x${string}`;
const OTHER = "0x5555555555555555555555555555555555555555" as `0x${string}`;
const TOKEN = "0x6666666666666666666666666666666666666666" as `0x${string}`;
const JOB_KEY: Erc8183JobKey = { chainId: 97, commerceContract: COMMERCE, jobId: "7" };
const PROVIDER_BINDING: Erc8183ProviderBinding = {
  identity: { namespace: "eip155", chainId: 97, identityRegistry: "0x1111111111111111111111111111111111111111", agentId: "42" },
  agentVersionId: "00000000-0000-4000-8000-000000000042",
  agentVersion: 1
};
const SNAPSHOT = {
  collateralValueUsd: "1000.00",
  debtValueUsd: "500",
  liquidationThresholdBps: 8000,
  sourceKind: "protocol_snapshot" as const,
  sourceReference: "https://example.test/venus/snapshot/7",
  observedAtUnix: 2_000_000,
  observedBlock: "12345",
  observedBlockHash: `0x${"a".repeat(64)}`
};

const AUTHORITY = {
  wallet: { address: PROVIDER },
  signer: { type: "privateKey", address: PROVIDER, publicKey: "0x04", signDigest: vi.fn() }
} as unknown as Erc8183AltanaAuthority;
const PIN = {
  enabled: true as const,
  chainId: 97 as const,
  specRevision: "apex-v1",
  commerceContract: COMMERCE,
  paymentToken: TOKEN,
  paymentDecimals: 18,
  abiHash: "4d8ac8b406dff522f1b9066eb3e00e2c8e491d4d09df2564ede124220b623ede",
  evaluatorProfile: "verified-policy-v1",
  confirmationThreshold: 1,
  minExpiryLeadSeconds: 60,
  maxExpiryHorizonSeconds: 86_400,
  minBudgetAtomic: "1",
  maxBudgetAtomic: "10000000000000000"
};

function referenceTask() {
  return createReferenceHealthFactorTask({
    jobKey: JOB_KEY,
    providerBinding: PROVIDER_BINDING,
    account: CLIENT,
    protocol: "venus",
    requestedAtUnix: 2_000_001,
    lendingSnapshot: SNAPSHOT
  });
}

function ownedJob(providerAddress = PROVIDER, budgetAtomic = "1000") {
  return erc8183JobRecordSchema.parse({
    jobKey: JOB_KEY,
    terms: {
      chainId: 97,
      commerceContract: COMMERCE,
      paymentToken: TOKEN,
      paymentDecimals: 18,
      clientAddress: CLIENT,
      providerAddress,
      evaluatorAddress: ROUTER,
      hookAddress: ROUTER,
      budgetAtomic,
      descriptionDigest: "b".repeat(64),
      expiresAtUnix: 2_000_600
    },
    deploymentPin: PIN,
    deploymentPinDigest: erc8183DeploymentPinDigest(PIN),
    state: "funded",
    createdAtUnix: 2_000_000,
    updatedAtUnix: 2_000_000,
    deliverableDigest: null,
    providerBinding: PROVIDER_BINDING,
    buyerApproval: null,
    fundingTransactionHash: null,
    submissionTransactionHash: null,
    completionTransactionHash: null,
    rejectionTransactionHash: null,
    refundTransactionHash: null,
    lastObservedBlock: null,
    lastObservedBlockHash: null,
    lastObservedAtUnix: null
  });
}

function operation(status: Erc8183OperationRecord["status"] = "confirmed"): Erc8183OperationRecord {
  return {
    operationId: "00000000-0000-4000-8000-000000000099",
    idempotencyKey: referenceProviderIdempotencyKey(JOB_KEY),
    requestDigest: "c".repeat(64),
    chainId: 97,
    commerceContract: COMMERCE,
    jobId: JOB_KEY.jobId,
    kind: "submit",
    signerRole: "provider",
    status,
    transactionHash: `0x${"d".repeat(64)}`,
    blockNumber: "123",
    blockHash: `0x${"e".repeat(64)}`,
    logIndex: null,
    failureCode: status === "unknown" ? "RELAY_PENDING" : null,
    context: {
      signerAddress: PROVIDER,
      sdkAction: "submit",
      callsId: `0x${"f".repeat(64)}`,
      parameters: { providerBinding: PROVIDER_BINDING },
      expectation: null
    },
    createdAtUnix: 2_000_000,
    updatedAtUnix: 2_000_001
  };
}

const RUNNER_CONFIG = {
  enabled: true,
  runtimeEnvironment: "test" as const,
  developmentCanaryEnabled: true,
  releaseEnabled: false as const,
  chainId: 97 as const,
  identity: PROVIDER_BINDING.identity,
  jobKey: JOB_KEY,
  expectedOwnerAddress: OWNER,
  providerAddress: PROVIDER,
  providerEndpoint: "https://provider.example/api/reference-provider/health-factor",
  authoritySecretReference: "secret://t5/reference-provider",
  routerContract: ROUTER,
  policyContract: POLICY
};

describe("BNBEra reference health-factor provider", () => {
  it("computes an exact, provenance-bearing result and binds identical bytes to the manifest", () => {
    expect(calculateReferenceHealthFactor(SNAPSHOT)).toMatchObject({
      healthFactor: 1.6,
      healthFactorExact: "1.6",
      interpretation: "safe"
    });

    const task = referenceTask();
    const result = createReferenceHealthFactorResult({ task, observedAtUnix: 2_000_001 });
    expect(result.result).toMatchObject({
      fixture: false,
      source: "bnbera.reference.health-factor",
      healthFactor: 1.6,
      healthFactorExact: "1.6",
      provenance: { sourceKind: "protocol_snapshot", observedAtUnix: 2_000_000 }
    });
    expect(result.result).not.toHaveProperty("privateKey");
    expect(() => createReferenceHealthFactorResult({ task, observedAtUnix: 1_999_999 })).toThrow(/precede/i);

    const resultBytes = canonicalHealthFactorResultBytes(result.result);
    expect(JSON.parse(resultBytes)).toEqual(result.result);
    expect(result.resultDigest).toBeTypeOf("string");
  });

  it("prepares a canonical ERC-8183 manifest whose response bytes are the served result", async () => {
    const submit = vi.fn(async () => ({}) as Awaited<ReturnType<Erc8183CommerceService["submit"]>>);
    const resolveAuthority = vi.fn(async (reference: string) => {
      expect(reference).toBe("secret://t5/reference-provider");
      return AUTHORITY;
    });
    const provider = new Erc8183ReferenceProviderAdapter(
      { submit } as unknown as Pick<Erc8183CommerceService, "submit">,
      resolveAuthority
    );
    const completed = await provider.submit({
      idempotencyKey: referenceProviderIdempotencyKey(JOB_KEY),
      jobKey: JOB_KEY,
      providerBinding: PROVIDER_BINDING,
      account: CLIENT,
      protocol: "venus",
      requestedAtUnix: 2_000_001,
      lendingSnapshot: SNAPSHOT,
      routerContract: ROUTER,
      policyContract: POLICY,
      producedAtUnix: 2_000_002,
      providerAddress: PROVIDER,
      requesterAddress: PROVIDER,
      authoritySecretReference: "secret://t5/reference-provider"
    });

    expect(completed.submission.manifest.response.content).toBe(completed.submission.resultBytes);
    expect(completed.submission.resultBytes).toBe(canonicalHealthFactorResultBytes(completed.submission.result.result));
    expect(verifyErc8183ManifestText(completed.submission.manifestText, completed.submission.chainDeliverable)).toBe(true);
    expect(completed.submission.deliverableUrl).toMatch(/^data:text\/plain;base64,/u);
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      jobId: "7",
      requesterAddress: PROVIDER,
      resultDigest: completed.submission.result.resultDigest,
      chainDeliverable: completed.submission.chainDeliverable,
      deliverableUrl: completed.submission.deliverableUrl,
      manifest: completed.submission.manifest,
      result: completed.submission.result
    });
  });

  it("does not resolve or submit with a mismatched requester/provider actor", async () => {
    const submit = vi.fn();
    const resolveAuthority = vi.fn();
    const provider = new Erc8183ReferenceProviderAdapter(
      { submit } as unknown as Pick<Erc8183CommerceService, "submit">,
      resolveAuthority as never
    );

    await expect(provider.submit({
      idempotencyKey: "t5-reference-submit-actor-mismatch",
      jobKey: JOB_KEY,
      providerBinding: PROVIDER_BINDING,
      account: CLIENT,
      protocol: "venus",
      requestedAtUnix: 2_000_001,
      lendingSnapshot: SNAPSHOT,
      routerContract: ROUTER,
      policyContract: POLICY,
      providerAddress: PROVIDER,
      requesterAddress: OTHER,
      authoritySecretReference: "secret://t5/reference-provider"
    })).rejects.toMatchObject({ code: "UNAUTHORIZED_ACTOR" });
    expect(resolveAuthority).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("requires the resolved signer address to match the provider even when its wallet handle claims the provider", async () => {
    const submit = vi.fn();
    const resolveAuthority = vi.fn(async () => ({
      wallet: { address: PROVIDER },
      signer: { type: "privateKey", address: OTHER, publicKey: "0x04", signDigest: vi.fn() }
    }) as unknown as Erc8183AltanaAuthority);
    const provider = new Erc8183ReferenceProviderAdapter(
      { submit } as unknown as Pick<Erc8183CommerceService, "submit">,
      resolveAuthority
    );

    await expect(provider.submit({
      idempotencyKey: referenceProviderIdempotencyKey(JOB_KEY),
      jobKey: JOB_KEY,
      providerBinding: PROVIDER_BINDING,
      account: CLIENT,
      protocol: "venus",
      requestedAtUnix: 2_000_001,
      lendingSnapshot: SNAPSHOT,
      routerContract: ROUTER,
      policyContract: POLICY,
      providerAddress: PROVIDER,
      requesterAddress: PROVIDER,
      authoritySecretReference: "secret://t5/reference-provider"
    })).rejects.toMatchObject({ code: "UNAUTHORIZED_ACTOR" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("rejects unproven or zero debt snapshots instead of fabricating finance data", () => {
    expect(() => healthFactorLendingSnapshotSchema.parse({ ...SNAPSHOT, debtValueUsd: "0.0" })).toThrow(/positive debt/i);
    expect(() => healthFactorLendingSnapshotSchema.parse({ ...SNAPSHOT, sourceReference: "http://example.test/snapshot" })).toThrow(/HTTPS source/i);
    expect(() => healthFactorLendingSnapshotSchema.parse({ ...SNAPSHOT, observedBlockHash: undefined, observedBlock: undefined })).not.toThrow();
  });

  it("accepts only secret references and keeps the runner disabled without an opt-in", () => {
    expect(referenceProviderRunnerConfigFromEnvironment({})).toMatchObject({ enabled: false, releaseEnabled: false, chainId: 97 });
    expect(referenceProviderReadinessConfigFromEnvironment({})).toMatchObject({ enabled: false, releaseEnabled: false, chainId: 97 });
    expect(() => referenceProviderSecretReferenceSchema.parse(PROVIDER)).toThrow(/secret reference/i);
    expect(() => referenceProviderSecretReferenceSchema.parse("secret://")).toThrow(/secret reference/i);

    const enabledEnvironment = {
      NODE_ENV: "development",
      T5_REFERENCE_PROVIDER_WORKER_ENABLED: "true",
      T5_REFERENCE_PROVIDER_LOCAL_TESTNET: "true",
      T5_REFERENCE_PROVIDER_IDENTITY_REGISTRY: PROVIDER_BINDING.identity.identityRegistry,
      T5_REFERENCE_PROVIDER_AGENT_ID: PROVIDER_BINDING.identity.agentId,
      T5_REFERENCE_PROVIDER_COMMERCE_CONTRACT: COMMERCE,
      T5_REFERENCE_PROVIDER_JOB_ID: JOB_KEY.jobId,
      T5_REFERENCE_PROVIDER_EXPECTED_OWNER_ADDRESS: OWNER,
      T5_REFERENCE_PROVIDER_ADDRESS: PROVIDER,
      T5_REFERENCE_PROVIDER_SERVICE_URL: "https://provider.example/api/reference-provider/health-factor",
      T5_REFERENCE_PROVIDER_ROUTER_CONTRACT: ROUTER,
      T5_REFERENCE_PROVIDER_POLICY_CONTRACT: POLICY,
      T5_REFERENCE_PROVIDER_SECRET_REFERENCE: PROVIDER
    };
    expect(() => referenceProviderRunnerConfigFromEnvironment(enabledEnvironment)).toThrow(/secret reference/i);
    expect(referenceProviderRunnerConfigFromEnvironment({ ...enabledEnvironment, T5_REFERENCE_PROVIDER_SECRET_REFERENCE: "secret://t5/reference-provider" })).toMatchObject({
      enabled: true,
      chainId: 97,
      releaseEnabled: false,
      authoritySecretReference: "secret://t5/reference-provider"
    });

    const readinessEnvironment = Object.fromEntries(
      Object.entries({ ...enabledEnvironment, T5_REFERENCE_PROVIDER_SECRET_REFERENCE: "secret://t5/reference-provider" })
        .filter(([name]) => name !== "T5_REFERENCE_PROVIDER_JOB_ID")
    );
    expect(referenceProviderReadinessConfigFromEnvironment(readinessEnvironment)).toMatchObject({
      enabled: true,
      chainId: 97,
      identity: PROVIDER_BINDING.identity,
      expectedOwnerAddress: OWNER,
      providerAddress: PROVIDER,
      providerEndpoint: "https://provider.example/api/reference-provider/health-factor",
      authoritySecretReference: "secret://t5/reference-provider",
      commerceContract: COMMERCE,
      routerContract: ROUTER,
      policyContract: POLICY,
      maxBudgetAtomic: REFERENCE_PROVIDER_MAX_BUDGET_ATOMIC
    });
    expect(referenceProviderReadinessConfigFromEnvironment(readinessEnvironment)).not.toHaveProperty("jobKey");
    expect(() => referenceProviderRunnerConfigFromEnvironment(readinessEnvironment)).toThrow(/T5_REFERENCE_PROVIDER_JOB_ID/);
  });

  it("calls the existing health-factor endpoint and retains its exact canonical bytes and digest", async () => {
    const task = referenceTask();
    const expected = createReferenceHealthFactorResult({ task, observedAtUnix: 2_000_001 });
    const resultBytes = canonicalHealthFactorResultBytes(expected.result);
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://provider.example/api/reference-provider/health-factor");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ "Content-Type": "application/json", Accept: "application/json" });
      expect(JSON.parse(String(init?.body))).toEqual({
        schemaVersion: "bnbera.reference.health-factor.request/v1",
        jobKey: JOB_KEY,
        providerBinding: PROVIDER_BINDING,
        account: CLIENT,
        protocol: "venus",
        requestedAtUnix: 2_000_001,
        lendingSnapshot: SNAPSHOT
      });
      return new Response(resultBytes, {
        status: 200,
        headers: {
          "content-length": String(new TextEncoder().encode(resultBytes).byteLength),
          "X-BNBEra-Result-SHA256": expected.resultDigest
        }
      });
    });
    const client = createReferenceHealthFactorProviderClient({
      endpoint: "https://provider.example/api/reference-provider/health-factor",
      fetch: fetcher
    });

    await expect(client.invoke({
      schemaVersion: "bnbera.reference.health-factor.request/v1",
      jobKey: JOB_KEY,
      providerBinding: PROVIDER_BINDING,
      account: CLIENT,
      protocol: "venus",
      requestedAtUnix: 2_000_001,
      lendingSnapshot: SNAPSHOT
    })).resolves.toEqual({ resultBytes, result: expected.result, resultDigest: expected.resultDigest });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects endpoint credentials, a bad digest, and an oversized body before submission", async () => {
    expect(() => createReferenceHealthFactorProviderClient({ endpoint: "https://user:pass@example.test/result", fetch: vi.fn() as never })).toThrow(/credential-free/i);
    const task = referenceTask();
    const expected = createReferenceHealthFactorResult({ task, observedAtUnix: 2_000_001 });
    const resultBytes = canonicalHealthFactorResultBytes(expected.result);
    const badDigest = createReferenceHealthFactorProviderClient({
      endpoint: "https://provider.example/result",
      fetch: vi.fn(async () => new Response(resultBytes, { status: 200, headers: { "X-BNBEra-Result-SHA256": "0".repeat(64) } }))
    });
    await expect(badDigest.invoke({
      schemaVersion: "bnbera.reference.health-factor.request/v1",
      jobKey: JOB_KEY,
      providerBinding: PROVIDER_BINDING,
      account: CLIENT,
      protocol: "venus",
      requestedAtUnix: 2_000_001,
      lendingSnapshot: SNAPSHOT
    })).rejects.toMatchObject({ code: "ONCHAIN_MISMATCH" });

    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const oversized = createReferenceHealthFactorProviderClient({
      endpoint: "https://provider.example/result",
      maxResponseBytes: 10,
      fetch: vi.fn(async () => ({ ok: true, headers: new Headers({ "content-length": String(REFERENCE_PROVIDER_MAX_RESPONSE_BYTES + 1) }), arrayBuffer })) as unknown as typeof fetch
    });
    await expect(oversized.invoke({
      schemaVersion: "bnbera.reference.health-factor.request/v1",
      jobKey: JOB_KEY,
      providerBinding: PROVIDER_BINDING,
      account: CLIENT,
      protocol: "venus",
      requestedAtUnix: 2_000_001,
      lendingSnapshot: SNAPSHOT
    })).rejects.toMatchObject({ code: "INVALID_JOB" });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("is disabled unless the explicit local testnet gate is enabled", async () => {
    const selector = { select: vi.fn() };
    const provider = { invoke: vi.fn() };
    const submit = vi.fn();
    const reconcile = vi.fn();
    const operations = { getByIdempotencyKey: vi.fn(async () => null) };
    const runner = new Erc8183ReferenceProviderRunner({
      config: { enabled: false },
      selector,
      provider,
      service: { submit, reconcile } as never,
      operations,
      resolveAuthority: vi.fn()
    });

    await expect(runner.run()).resolves.toMatchObject({ status: "disabled", operation: null });
    expect(selector.select).not.toHaveBeenCalled();
    expect(provider.invoke).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("selects one owned job, calls the existing provider, and never rebroadcasts a duplicate", async () => {
    const key = referenceProviderIdempotencyKey(JOB_KEY);
    const stored = new Map<string, Erc8183OperationRecord>();
    const firstOperation = operation("confirmed");
    const task = referenceTask();
    const providerResult = createReferenceHealthFactorResult({ task, observedAtUnix: 2_000_002 });
    const providerResponse = {
      result: providerResult.result,
      resultBytes: canonicalHealthFactorResultBytes(providerResult.result),
      resultDigest: providerResult.resultDigest
    };
    const selector = { select: vi.fn(async () => ({
      job: ownedJob(),
      identityOwnerAddress: OWNER,
      identityAgentWallet: PROVIDER,
      account: CLIENT,
      protocol: "venus",
      requestedAtUnix: 2_000_001,
      lendingSnapshot: SNAPSHOT
    })) };
    const provider = { invoke: vi.fn(async () => providerResponse) };
    const submit = vi.fn(async () => {
      stored.set(key, firstOperation);
      return { operation: firstOperation, result: null, replayed: false } as unknown as Awaited<ReturnType<Erc8183CommerceService["submit"]>>;
    });
    const reconcile = vi.fn();
    const resolveAuthority = vi.fn(async (reference: string) => {
      expect(reference).toBe("secret://t5/reference-provider");
      return AUTHORITY;
    });
    const runner = new Erc8183ReferenceProviderRunner({
      config: RUNNER_CONFIG,
      selector,
      provider,
      service: { submit, reconcile } as never,
      operations: { getByIdempotencyKey: vi.fn(async (idempotencyKey: string) => stored.get(idempotencyKey) ?? null) },
      resolveAuthority
    });

    const first = await runner.run();
    const second = await runner.run();
    expect(first).toMatchObject({ status: "submitted", idempotencyKey: key, operation: { status: "confirmed", transactionHash: firstOperation.transactionHash } });
    expect(second).toMatchObject({ status: "replayed", idempotencyKey: key, operation: { operationId: firstOperation.operationId } });
    expect(selector.select).toHaveBeenCalledOnce();
    expect(provider.invoke).toHaveBeenCalledOnce();
    expect(resolveAuthority).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("reconciles an unknown submit once and never retries the Altana write", async () => {
    const key = referenceProviderIdempotencyKey(JOB_KEY);
    const stored = new Map<string, Erc8183OperationRecord>();
    const unknown = operation("unknown");
    const reconciled = { ...unknown, status: "reconciled" as const };
    const task = referenceTask();
    const providerResult = createReferenceHealthFactorResult({ task, observedAtUnix: 2_000_002 });
    const submit = vi.fn(async () => {
      stored.set(key, unknown);
      throw new CommerceError({ code: "TRANSACTION_UNKNOWN", message: "relay pending", relayCallsId: unknown.context?.callsId ?? undefined, nextAction: "reconcile_transaction" });
    });
    const reconcile = vi.fn(async () => {
      stored.set(key, reconciled);
      return { operation: reconciled, result: null, replayed: false };
    });
    const runner = new Erc8183ReferenceProviderRunner({
      config: RUNNER_CONFIG,
      selector: { select: vi.fn(async () => ({ job: ownedJob(), identityOwnerAddress: OWNER, identityAgentWallet: PROVIDER, account: CLIENT, protocol: "venus", requestedAtUnix: 2_000_001, lendingSnapshot: SNAPSHOT })) },
      provider: { invoke: vi.fn(async () => ({ result: providerResult.result, resultBytes: canonicalHealthFactorResultBytes(providerResult.result), resultDigest: providerResult.resultDigest })) },
      service: { submit, reconcile } as never,
      operations: { getByIdempotencyKey: vi.fn(async (idempotencyKey: string) => stored.get(idempotencyKey) ?? null) },
      resolveAuthority: vi.fn(async () => AUTHORITY)
    });

    const first = await runner.run();
    const second = await runner.run();
    expect(first.status).toBe("reconciled");
    expect(second.status).toBe("reconciled");
    expect(submit).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledOnce();
  });

  it("rejects a selected job whose provider actor is not the configured authority", async () => {
    const provider = { invoke: vi.fn() };
    const submit = vi.fn();
    const resolveAuthority = vi.fn();
    const runner = new Erc8183ReferenceProviderRunner({
      config: RUNNER_CONFIG,
      selector: { select: vi.fn(async () => ({ job: ownedJob(OTHER), identityOwnerAddress: OWNER, identityAgentWallet: PROVIDER, account: CLIENT, protocol: "venus", requestedAtUnix: 2_000_001, lendingSnapshot: SNAPSHOT })) },
      provider,
      service: { submit, reconcile: vi.fn() } as never,
      operations: { getByIdempotencyKey: vi.fn(async () => null) },
      resolveAuthority: resolveAuthority as never
    });

    await expect(runner.run()).rejects.toMatchObject({ code: "UNAUTHORIZED_ACTOR" });
    expect(provider.invoke).not.toHaveBeenCalled();
    expect(resolveAuthority).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("rejects a selected identity owned by a different ERC-8004 owner", async () => {
    const provider = { invoke: vi.fn() };
    const runner = new Erc8183ReferenceProviderRunner({
      config: RUNNER_CONFIG,
      selector: { select: vi.fn(async () => ({ job: ownedJob(), identityOwnerAddress: OTHER, identityAgentWallet: PROVIDER, account: CLIENT, protocol: "venus", requestedAtUnix: 2_000_001, lendingSnapshot: SNAPSHOT })) },
      provider,
      service: { submit: vi.fn(), reconcile: vi.fn() } as never,
      operations: { getByIdempotencyKey: vi.fn(async () => null) },
      resolveAuthority: vi.fn()
    });

    await expect(runner.run()).rejects.toMatchObject({ code: "UNAUTHORIZED_ACTOR" });
    expect(provider.invoke).not.toHaveBeenCalled();
  });

  it("requires an observed ERC-8004 agent wallet and enforces the provider budget cap", async () => {
    const provider = { invoke: vi.fn() };
    const selector = { select: vi.fn(async () => ({
      job: ownedJob(PROVIDER, `${BigInt(REFERENCE_PROVIDER_MAX_BUDGET_ATOMIC) + 1n}`),
      identityOwnerAddress: OWNER,
      identityAgentWallet: PROVIDER,
      account: CLIENT,
      protocol: "venus",
      requestedAtUnix: 2_000_001,
      lendingSnapshot: SNAPSHOT
    })) };
    const runner = new Erc8183ReferenceProviderRunner({
      config: RUNNER_CONFIG,
      selector,
      provider,
      service: { submit: vi.fn(), reconcile: vi.fn() } as never,
      operations: { getByIdempotencyKey: vi.fn(async () => null) },
      resolveAuthority: vi.fn()
    });

    await expect(runner.run()).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    expect(provider.invoke).not.toHaveBeenCalled();

    const walletMissing = new Erc8183ReferenceProviderRunner({
      config: RUNNER_CONFIG,
      selector: { select: vi.fn(async () => ({
        job: ownedJob(),
        identityOwnerAddress: OWNER,
        identityAgentWallet: null,
        account: CLIENT,
        protocol: "venus",
        requestedAtUnix: 2_000_001,
        lendingSnapshot: SNAPSHOT
      })) },
      provider,
      service: { submit: vi.fn(), reconcile: vi.fn() } as never,
      operations: { getByIdempotencyKey: vi.fn(async () => null) },
      resolveAuthority: vi.fn()
    });
    await expect(walletMissing.run()).rejects.toMatchObject({ code: "UNAUTHORIZED_ACTOR" });

    const walletWrong = new Erc8183ReferenceProviderRunner({
      config: RUNNER_CONFIG,
      selector: { select: vi.fn(async () => ({
        job: ownedJob(),
        identityOwnerAddress: OWNER,
        identityAgentWallet: OTHER,
        account: CLIENT,
        protocol: "venus",
        requestedAtUnix: 2_000_001,
        lendingSnapshot: SNAPSHOT
      })) },
      provider,
      service: { submit: vi.fn(), reconcile: vi.fn() } as never,
      operations: { getByIdempotencyKey: vi.fn(async () => null) },
      resolveAuthority: vi.fn()
    });
    await expect(walletWrong.run()).rejects.toMatchObject({ code: "UNAUTHORIZED_ACTOR" });
  });

  it("selects a distinct owner/provider pair only from finalized identity evidence", async () => {
    const jobs = { get: vi.fn(async () => ownedJob()) };
    const pool = {
      query: vi.fn(async () => ({ rows: [{
        owner_address: OWNER,
        owner_observed_block: "123",
        agent_wallet: PROVIDER,
        agent_wallet_observed_block: "123",
        agent_uri: "https://provider.example/card",
        agent_uri_observed_block: "123",
        observed_block: "123",
        observed_block_hash: `0x${"a".repeat(64)}`,
        read_consistency: "finalized"
      }] }))
    };
    const selector = new PostgresReferenceProviderJobSelector(pool as never, jobs as never, {
      account: CLIENT,
      chainId: 97,
      protocol: "venus",
      requestedAtUnix: 2_000_001,
      lendingSnapshot: SNAPSHOT
    }, OWNER);

    await expect(selector.select({ identity: PROVIDER_BINDING.identity, jobKey: JOB_KEY, providerAddress: PROVIDER })).resolves.toMatchObject({
      identityOwnerAddress: OWNER,
      identityAgentWallet: PROVIDER
    });
  });

  it("rejects provisional or incomplete identity evidence before provider invocation", async () => {
    const jobs = { get: vi.fn(async () => ownedJob()) };
    const pool = {
      query: vi.fn(async () => ({ rows: [{
        owner_address: OWNER,
        owner_observed_block: "123",
        agent_wallet: PROVIDER,
        agent_wallet_observed_block: "123",
        agent_uri: "https://provider.example/card",
        agent_uri_observed_block: "123",
        observed_block: "123",
        observed_block_hash: `0x${"a".repeat(64)}`,
        read_consistency: "provisional"
      }] }))
    };
    const selector = new PostgresReferenceProviderJobSelector(pool as never, jobs as never, {
      account: CLIENT,
      chainId: 97,
      protocol: "venus",
      requestedAtUnix: 2_000_001,
      lendingSnapshot: SNAPSHOT
    }, OWNER);

    await expect(selector.select({ identity: PROVIDER_BINDING.identity, jobKey: JOB_KEY, providerAddress: PROVIDER })).resolves.toBeNull();
  });
});
