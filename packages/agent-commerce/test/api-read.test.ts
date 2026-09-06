import { describe, expect, it } from "vitest";
import { encodeErc8183Manifest, erc8183ManifestHash } from "@altananetwork/sdk";
import {
  Erc8183CommerceReadService,
  createErc8183JobEvent,
  erc8183DeploymentPinDigest,
  erc8183JobRecordSchema,
  type Erc8183JobEvent,
  type Erc8183JobKey,
  type Erc8183OperationRecord
} from "../src/index.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as `0x${string}`;
const TOKEN = "0xc70b8741b8b07a6d61e54fd4b20f22fa648e5565" as `0x${string}`;
const CLIENT = "0x3333333333333333333333333333333333333333" as `0x${string}`;
const PROVIDER = "0x4444444444444444444444444444444444444444" as `0x${string}`;
const ROUTER = "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25" as `0x${string}`;
const TX = `0x${"b".repeat(64)}` as `0x${string}`;
const BLOCK = `0x${"c".repeat(64)}` as `0x${string}`;
const CALLS = `0x${"a".repeat(64)}` as `0x${string}`;
const LOCAL_SHA256 = "d".repeat(64);

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

const JOB_KEY: Erc8183JobKey = { chainId: 97, commerceContract: COMMERCE, jobId: "7" };
const MANIFEST = {
  version: 1 as const,
  job_id: 7,
  chain_id: 97,
  contracts: { commerce: COMMERCE, router: ROUTER, policy: ROUTER },
  response: { content: "health factor result", content_type: "text/plain" },
  metadata: { source: "test" }
};
const MANIFEST_TEXT = encodeErc8183Manifest(MANIFEST);
const CHAIN_KECCAK = erc8183ManifestHash(MANIFEST);

function job() {
  return erc8183JobRecordSchema.parse({
    jobKey: JOB_KEY,
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
    state: "submitted",
    createdAtUnix: 2_000_000,
    updatedAtUnix: 2_000_001,
    deliverableDigest: LOCAL_SHA256,
    providerBinding: null,
    buyerApproval: null,
    fundingTransactionHash: null,
    submissionTransactionHash: TX,
    completionTransactionHash: null,
    rejectionTransactionHash: null,
    refundTransactionHash: null,
    lastObservedBlock: "123",
    lastObservedBlockHash: BLOCK,
    lastObservedAtUnix: 2_000_001
  });
}

function operation(): Erc8183OperationRecord {
  return {
    operationId: "00000000-0000-4000-8000-000000000001",
    idempotencyKey: "read-model-test-submit",
    requestDigest: "a".repeat(64),
    chainId: 97,
    commerceContract: COMMERCE,
    jobId: "7",
    kind: "submit",
    signerRole: "provider",
    status: "confirmed",
    transactionHash: TX,
    blockNumber: "123",
    blockHash: BLOCK,
    logIndex: 0,
    failureCode: null,
    context: {
      signerAddress: PROVIDER,
      sdkAction: "submit",
      callsId: CALLS,
      parameters: {
        resultDigest: LOCAL_SHA256,
        chainDeliverable: CHAIN_KECCAK,
        deliverableUrl: "https://example.test/deliverables/7.json",
        manifest: MANIFEST,
        result: null
      },
      expectation: { digest: CHAIN_KECCAK, expectedState: "SUBMITTED" }
    },
    createdAtUnix: 2_000_000,
    updatedAtUnix: 2_000_001
  };
}

function submissionEvent(): Erc8183JobEvent {
  return createErc8183JobEvent({
    eventKey: "operation:00000000-0000-4000-8000-000000000001:submit",
    jobKey: JOB_KEY,
    eventType: "job_submitted",
    previousState: "funded",
    nextState: "submitted",
    actorAddress: PROVIDER,
    transactionHash: TX,
    blockNumber: "123",
    blockHash: BLOCK,
    logIndex: 0,
    confirmationState: "canonical",
    payload: {
      operationId: "00000000-0000-4000-8000-000000000001",
      callsId: CALLS,
      resultDigest: LOCAL_SHA256,
      chainDeliverable: CHAIN_KECCAK,
      deliverableUrl: "https://example.test/deliverables/7.json",
      manifestText: MANIFEST_TEXT,
      manifest: MANIFEST,
      result: null
    },
    correlationId: "00000000-0000-4000-8000-000000000001",
    observedAtUnix: 2_000_001
  });
}

class MemoryReadRepository {
  public constructor(
    private readonly currentJob: ReturnType<typeof job>,
    private readonly currentEvent: Erc8183JobEvent | null
  ) {}

  public async get(): Promise<ReturnType<typeof job> | null> {
    return this.currentJob;
  }

  public async getConfirmedSubmissionEvent(): Promise<Erc8183JobEvent | null> {
    return this.currentEvent;
  }
}

class MemoryOperationRepository {
  public constructor(private readonly currentOperation: Erc8183OperationRecord) {}

  public async get(): Promise<Erc8183OperationRecord | null> {
    return this.currentOperation;
  }

  public async listForJob(): Promise<readonly Erc8183OperationRecord[]> {
    return [this.currentOperation];
  }
}

describe("ERC-8183 typed commerce read model", () => {
  it("assembles canonical job and confirmed submission evidence for reload", async () => {
    const read = await new Erc8183CommerceReadService(
      new MemoryReadRepository(job(), submissionEvent()),
      new MemoryOperationRepository(operation())
    ).get(JOB_KEY);

    expect(read.job.state).toBe("submitted");
    expect(read.approvalRequired).toBe(true);
    expect(read.submission).toMatchObject({
      status: "confirmed",
      confirmationState: "canonical",
      localSha256: LOCAL_SHA256,
      chainKeccak: CHAIN_KECCAK,
      callsId: CALLS,
      transactionHash: TX,
      blockNumber: "123",
      deliverableUrl: "https://example.test/deliverables/7.json",
      manifestText: MANIFEST_TEXT,
      operationStatus: "confirmed"
    });
    expect(read.operations).toHaveLength(1);
    expect(read.operations[0]).toMatchObject({ operationId: operation().operationId, status: "confirmed", callsId: CALLS, transactionHash: TX });
    expect(read.operations[0]).not.toHaveProperty("context");
  });

  it("fails closed when a repository returns a non-canonical submission event", async () => {
    const provisional = createErc8183JobEvent({ ...submissionEvent(), eventKey: "provisional-submit", confirmationState: "provisional" });
    await expect(new Erc8183CommerceReadService(
      new MemoryReadRepository(job(), provisional),
      new MemoryOperationRepository(operation())
    ).get(JOB_KEY)).rejects.toMatchObject({ code: "ONCHAIN_MISMATCH" });
  });
});
