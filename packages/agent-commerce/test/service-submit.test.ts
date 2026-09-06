import { describe, expect, it, vi } from "vitest";
import { encodeErc8183Manifest, erc8183ManifestHash } from "@altananetwork/sdk";
import {
  createHealthFactorResult,
  createHealthFactorTask,
  Erc8183CommerceService,
  erc8183DeploymentPinDigest,
  erc8183JobRecordSchema,
  type Erc8183AltanaAdapter,
  type Erc8183AltanaAuthority,
  type Erc8183CanonicalJobStore,
  type Erc8183JobRecord,
  type PostgresErc8183OperationRepository
} from "../src/index.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as `0x${string}`;
const ROUTER = "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25" as `0x${string}`;
const TOKEN = "0xc70b8741b8b07a6d61e54fd4b20f22fa648e5565" as `0x${string}`;
const CLIENT = "0x3333333333333333333333333333333333333333" as `0x${string}`;
const PROVIDER = "0x4444444444444444444444444444444444444444" as `0x${string}`;
const NESTED_CHAIN_DELIVERABLE = `0x${"e".repeat(64)}` as `0x${string}`;
const EXPLICIT_CHAIN_DELIVERABLE = `0x${"f".repeat(64)}` as `0x${string}`;
const VERSION_ID = "00000000-0000-4000-8000-000000000042";
const PROVIDER_BINDING = {
  identity: { namespace: "eip155", chainId: 97, identityRegistry: "0x1111111111111111111111111111111111111111", agentId: "42" },
  agentVersionId: VERSION_ID,
  agentVersion: 1
} as const;
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
const AUTHORITY = { wallet: { address: PROVIDER } } as unknown as Erc8183AltanaAuthority;

function job(): Erc8183JobRecord {
  return erc8183JobRecordSchema.parse({
    jobKey: { chainId: 97, commerceContract: COMMERCE, jobId: "7" },
    terms: {
      chainId: 97,
      commerceContract: COMMERCE,
      paymentToken: TOKEN,
      paymentDecimals: 18,
      clientAddress: CLIENT,
      providerAddress: PROVIDER,
      evaluatorAddress: ROUTER,
      hookAddress: ROUTER,
      budgetAtomic: "1000",
      descriptionDigest: "b".repeat(64),
      expiresAtUnix: 2_000_600
    },
    deploymentPin: PIN,
    deploymentPinDigest: erc8183DeploymentPinDigest(PIN),
    state: "funded",
    createdAtUnix: 2_000_000,
    updatedAtUnix: 2_000_000,
    deliverableDigest: null,
    providerBinding: null,
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

function service(adapter: Erc8183AltanaAdapter): Erc8183CommerceService {
  return new Erc8183CommerceService({
    adapter,
    operations: {} as PostgresErc8183OperationRepository,
    jobs: { get: async () => job() } as unknown as Erc8183CanonicalJobStore
  });
}

function result(chainDeliverable: `0x${string}`) {
  const task = createHealthFactorTask({
    jobKey: { chainId: 97, commerceContract: COMMERCE, jobId: "7" },
    providerBinding: PROVIDER_BINDING,
    account: CLIENT,
    protocol: "venus",
    requestedAtUnix: 2_000_000
  });
  return createHealthFactorResult({ task, observedAtUnix: 2_000_001, healthFactor: 1.72, chainDeliverable });
}

describe("ERC-8183 submit Keccak binding", () => {
  it("rejects a nested provider result Keccak that differs from an explicit top-level digest", async () => {
    const submit = vi.fn();
    const commerce = service({ pin: PIN, submit } as unknown as Erc8183AltanaAdapter);
    const providerResult = result(NESTED_CHAIN_DELIVERABLE);

    await expect(commerce.submit({
      idempotencyKey: "submit-nested-keccak-mismatch",
      authority: AUTHORITY,
      requesterAddress: PROVIDER,
      jobId: "7",
      resultDigest: providerResult.resultDigest,
      chainDeliverable: EXPLICIT_CHAIN_DELIVERABLE,
      result: providerResult
    })).rejects.toMatchObject({ code: "ONCHAIN_MISMATCH" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("rejects a nested provider result Keccak that differs from a manifest digest", async () => {
    const submit = vi.fn();
    const commerce = service({ pin: PIN, submit } as unknown as Erc8183AltanaAdapter);
    const providerResult = result(NESTED_CHAIN_DELIVERABLE);
    const manifest = {
      version: 1 as const,
      job_id: 7,
      chain_id: 97,
      contracts: { commerce: COMMERCE, router: ROUTER, policy: ROUTER },
      response: { content: "result", content_type: "text/plain" },
      metadata: { source: "test" }
    };
    const manifestDigest = erc8183ManifestHash(manifest);
    expect(encodeErc8183Manifest(manifest)).toBeTypeOf("string");

    await expect(commerce.submit({
      idempotencyKey: "submit-nested-manifest-mismatch",
      authority: AUTHORITY,
      requesterAddress: PROVIDER,
      jobId: "7",
      resultDigest: providerResult.resultDigest,
      manifest,
      result: providerResult
    })).rejects.toMatchObject({ code: "ONCHAIN_MISMATCH" });
    expect(providerResult.chainDeliverable).not.toBe(manifestDigest);
    expect(submit).not.toHaveBeenCalled();
  });
});
