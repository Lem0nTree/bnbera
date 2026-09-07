import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  createReferenceProviderAuthorityResolver,
  runReferenceProviderWorker,
  sanitizeReferenceProviderRun,
  type ReferenceProviderWorkerDependencies
} from "./t5-reference-provider-worker.ts";
import {
  createReferenceProviderWorkerComposition,
  referenceProviderRunnerConfigFromEnvironment
} from "../packages/agent-commerce/src/index.ts";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de";
const ROUTER = "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25";
const POLICY = "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea";
const REGISTRY = "0x8004a818bfb912233c491871b3d84c89a494bd9e";
const PROVIDER = "0x4444444444444444444444444444444444444444";
const OWNER = "0x7777777777777777777777777777777777777777";
const OTHER = "0x5555555555555555555555555555555555555555";
const taskInput = {
  account: "0x3333333333333333333333333333333333333333",
  chainId: 97 as const,
  protocol: "venus",
  requestedAtUnix: 2_000_001,
  lendingSnapshot: {
    collateralValueUsd: "1000.00",
    debtValueUsd: "500",
    liquidationThresholdBps: 8000,
    sourceKind: "protocol_snapshot" as const,
    sourceReference: "https://example.test/venus/snapshot/7",
    observedAtUnix: 2_000_000,
    observedBlock: "12345",
    observedBlockHash: `0x${"a".repeat(64)}`
  }
};

function enabledEnvironment(): Record<string, string> {
  return {
    NODE_ENV: "test",
    DATABASE_URL: "postgres://worker.test/unused",
    T5_REFERENCE_PROVIDER_WORKER_ENABLED: "true",
    T5_REFERENCE_PROVIDER_LOCAL_TESTNET: "true",
    T5_REFERENCE_PROVIDER_IDENTITY_REGISTRY: REGISTRY,
    T5_REFERENCE_PROVIDER_AGENT_ID: "42",
    T5_REFERENCE_PROVIDER_COMMERCE_CONTRACT: COMMERCE,
    T5_REFERENCE_PROVIDER_JOB_ID: "7",
    T5_REFERENCE_PROVIDER_EXPECTED_OWNER_ADDRESS: OWNER,
    T5_REFERENCE_PROVIDER_ADDRESS: PROVIDER,
    T5_REFERENCE_PROVIDER_SERVICE_URL: "https://provider.example/api/reference-provider/health-factor",
    T5_REFERENCE_PROVIDER_ROUTER_CONTRACT: ROUTER,
    T5_REFERENCE_PROVIDER_POLICY_CONTRACT: POLICY,
    T5_REFERENCE_PROVIDER_SECRET_REFERENCE: "env://T5_REFERENCE_PROVIDER_PRIVATE_KEY",
    T5_REFERENCE_PROVIDER_TASK_INPUT_JSON: JSON.stringify(taskInput)
  };
}

describe("T5 reference-provider worker runtime", () => {
  it("is disabled before opening PostgreSQL or composing the Altana seam", async () => {
    const createDatabase = vi.fn();
    const compose = vi.fn();
    const result = await runReferenceProviderWorker({
      env: {},
      dependencies: {
        createDatabase,
        compose
      } as unknown as ReferenceProviderWorkerDependencies
    });

    expect(result).toEqual({ status: "disabled", idempotencyKey: "disabled", operation: null });
    expect(createDatabase).not.toHaveBeenCalled();
    expect(compose).not.toHaveBeenCalled();
  });

  it("keeps the worker job-bound even when readiness fields are otherwise configured", async () => {
    const readinessEnvironment = Object.fromEntries(
      Object.entries(enabledEnvironment()).filter(([name]) => name !== "T5_REFERENCE_PROVIDER_JOB_ID")
    );
    const createDatabase = vi.fn();

    await expect(runReferenceProviderWorker({
      env: readinessEnvironment,
      dependencies: { createDatabase } as unknown as ReferenceProviderWorkerDependencies
    })).rejects.toMatchObject({
      code: "COMMERCE_DISABLED",
      message: expect.stringContaining("T5_REFERENCE_PROVIDER_JOB_ID")
    });
    expect(createDatabase).not.toHaveBeenCalled();
  });

  it("composes one configured identity/job and invokes the runner once with sanitized evidence", async () => {
    const run = vi.fn(async () => ({
      status: "replayed" as const,
      idempotencyKey: "t5-reference-provider-submit:97:0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de:7",
      operation: {
        operationId: "00000000-0000-4000-8000-000000000099",
        idempotencyKey: "t5-reference-provider-submit:97:0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de:7",
        requestDigest: "c".repeat(64),
        chainId: 97 as const,
        commerceContract: COMMERCE as `0x${string}`,
        jobId: "7",
        kind: "submit" as const,
        signerRole: "provider" as const,
        status: "confirmed" as const,
        transactionHash: `0x${"d".repeat(64)}` as `0x${string}`,
        blockNumber: "123",
        blockHash: `0x${"e".repeat(64)}` as `0x${string}`,
        logIndex: null,
        failureCode: null,
        context: {
          signerAddress: PROVIDER as `0x${string}`,
          sdkAction: "submit" as const,
          parameters: { authoritySecretReference: "env://T5_REFERENCE_PROVIDER_PRIVATE_KEY" }
        },
        createdAtUnix: 2_000_000,
        updatedAtUnix: 2_000_001
      },
    }));
    const compose = vi.fn((input) => {
      expect(input.config.jobKey).toEqual({ chainId: 97, commerceContract: COMMERCE, jobId: "7" });
      expect(input.config.identity).toMatchObject({ chainId: 97, identityRegistry: REGISTRY, agentId: "42" });
      expect(input.taskInput).toEqual(taskInput);
      expect(input.config.authoritySecretReference).toBe("env://T5_REFERENCE_PROVIDER_PRIVATE_KEY");
      return { runner: { run } };
    });
    const close = vi.fn(async () => undefined);
    const dependencies = {
      readStandardsLock: vi.fn(async () => ({ lock: "fixture" })),
      createDatabase: vi.fn(() => ({ pool: {} as never, close })),
      compose,
      resolveAuthority: vi.fn(() => vi.fn())
    } as unknown as ReferenceProviderWorkerDependencies;

    const result = await runReferenceProviderWorker({ env: enabledEnvironment(), dependencies });

    expect(result.status).toBe("replayed");
    expect(compose).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    const output = sanitizeReferenceProviderRun(result);
    expect(output).toMatchObject({ status: "replayed", writesBroadcast: false, operation: { status: "confirmed" } });
    expect(JSON.stringify(output)).not.toContain("T5_REFERENCE_PROVIDER_PRIVATE_KEY");
    expect(JSON.stringify(output)).not.toContain("authoritySecretReference");
  });

  it("constructs the real standards-locked PostgreSQL/Altana composition without a write", async () => {
    const env = enabledEnvironment();
    const config = referenceProviderRunnerConfigFromEnvironment(env);
    const standardsLock = JSON.parse(await readFile(new URL("../config/standards.lock.json", import.meta.url), "utf8")) as unknown;
    const composition = createReferenceProviderWorkerComposition({
      config,
      standardsLock,
      pool: {} as never,
      taskInput,
      resolveAuthority: vi.fn()
    });

    expect(composition.adapter.pin.chainId).toBe(97);
    expect(composition.adapter.pin.commerceContract.toLowerCase()).toBe(COMMERCE);
    expect(composition.adapter.routerContract.toLowerCase()).toBe(ROUTER);
    expect(composition.adapter.policyContract.toLowerCase()).toBe(POLICY);
    expect(composition.runner).toBeDefined();
  });

  it("rejects an env-resolved signer whose derived address is not the configured provider", async () => {
    const resolveAuthority = createReferenceProviderAuthorityResolver({
      T5_REFERENCE_PROVIDER_ADDRESS: OTHER,
      T5_REFERENCE_PROVIDER_PRIVATE_KEY: "0x0000000000000000000000000000000000000000000000000000000000000001"
    });

    await expect(resolveAuthority("env://T5_REFERENCE_PROVIDER_PRIVATE_KEY")).rejects.toMatchObject({ code: "UNAUTHORIZED_ACTOR" });
  });
});
