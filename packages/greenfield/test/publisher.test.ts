import { describe, expect, it } from "vitest";
import { EvidencePublisher, InMemoryPublicationStore } from "../src/index.js";
import { DeterministicGreenfieldPublisher, DeterministicIpfsPublisher } from "../src/fakes.js";

const artifact = {
  schemaVersion: "bnbera.evidence/v1",
  artifactType: "run_bundle",
  artifactId: "run-1",
  version: 1,
  environment: "hackathon",
  createdAt: "2026-09-02T08:00:00Z",
  payload: {
    runId: "run-1",
    identity: {
      namespace: "eip155",
      chainId: 97,
      identityRegistry: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      agentId: "1"
    },
    agentVersion: "template@1.0.0",
    observedAt: "2026-09-02T08:00:00Z",
    observedBlock: "10",
    dataSources: [],
    candidateActions: [],
    rejectedActions: [],
    selectedAction: null,
    simulationOutput: { status: "ok" },
    riskValidations: { status: "passed" },
    policyValidation: { status: "passed" },
    quote: { amount: "1" },
    transactionHash: null,
    receiptSummary: { status: "simulated" },
    beforeState: { value: "1" },
    afterState: { value: "1" },
    ipfsDeliverable: null,
    contentSha256: null,
    contentKeccak256: null,
    finalStatus: "simulated"
  }
} as const;

function publisher(options?: { readonly ipfs?: DeterministicIpfsPublisher; readonly greenfield?: DeterministicGreenfieldPublisher; readonly maxSealPolls?: number }) {
  const dependencies = {
    store: new InMemoryPublicationStore(),
    ipfs: options?.ipfs ?? new DeterministicIpfsPublisher(),
    greenfield: options?.greenfield ?? new DeterministicGreenfieldPublisher()
  } as {
    store: InMemoryPublicationStore;
    ipfs: DeterministicIpfsPublisher;
    greenfield: DeterministicGreenfieldPublisher;
    maxSealPolls?: number;
  };
  if (options?.maxSealPolls !== undefined) {
    dependencies.maxSealPolls = options.maxSealPolls;
  }
  return new EvidencePublisher(dependencies);
}

describe("independent evidence publication", () => {
  it("verifies both providers independently", async () => {
    const store = new InMemoryPublicationStore();
    const instance = new EvidencePublisher({
      store,
      ipfs: new DeterministicIpfsPublisher(),
      greenfield: new DeterministicGreenfieldPublisher()
    });
    const result = await instance.publish({ artifact, idempotencyKey: "run-1-v1", providers: ["ipfs", "greenfield"] });
    expect(result.attempts.map((attempt) => attempt.state)).toEqual(["verified", "verified"]);
    expect(result.attempts.every((attempt) => attempt.verification?.status === "verified")).toBe(true);
    expect(result.attempts.every((attempt) => attempt.locator?.immutable === true && attempt.locator.verifiedAt !== null)).toBe(true);
    expect(store.values()).toHaveLength(2);
    expect(new Set(store.values().map((attempt) => attempt.idempotencyKey)).size).toBe(2);
  });

  it("does not mirror when IPFS fails and Greenfield succeeds", async () => {
    const result = await publisher({ ipfs: new DeterministicIpfsPublisher({ failUpload: true }) }).publish({
      artifact,
      idempotencyKey: "independent-failure",
      providers: ["ipfs", "greenfield"]
    });
    expect(result.attempts.find((attempt) => attempt.provider === "ipfs")?.state).toBe("upload_failed");
    expect(result.attempts.find((attempt) => attempt.provider === "greenfield")?.state).toBe("verified");
  });

  it("requires seal confirmation before readback verification", async () => {
    const greenfield = new DeterministicGreenfieldPublisher({ sealAfterPolls: 2 });
    const result = await publisher({ greenfield }).publish({ artifact, idempotencyKey: "delayed-seal", providers: ["greenfield"] });
    expect(result.attempts[0]?.state).toBe("verified");
    expect(greenfield.getPollCount()).toBe(2);
  });

  it("records a provider readback failure instead of treating availability as integrity", async () => {
    const result = await publisher({ greenfield: new DeterministicGreenfieldPublisher({ failRead: true }) }).publish({
      artifact,
      idempotencyKey: "readback-provider-failure",
      providers: ["greenfield"]
    });
    expect(result.attempts[0]?.state).toBe("readback_failed");
    expect(result.attempts[0]?.lastErrorCode).toBe("PROVIDER_FAILED");
    expect(result.attempts[0]?.verification).toBeNull();
  });

  it("keeps a provider-submitted transaction distinct from a published object", async () => {
    const result = await publisher({
      greenfield: new DeterministicGreenfieldPublisher({ submittedWithoutReference: true })
    }).publish({ artifact, idempotencyKey: "submitted-only", providers: ["greenfield"] });
    expect(result.attempts[0]?.state).toBe("create_failed");
    expect(result.attempts[0]?.submittedAt).not.toBeNull();
    expect(result.attempts[0]?.verification).toBeNull();
  });

  it.each([
    ["seal_timeout", new DeterministicGreenfieldPublisher({ timeoutOnSeal: true }), "seal_timeout"],
    ["missing", new DeterministicGreenfieldPublisher({ missingOnRead: true }), "readback_failed"],
    ["corrupt", new DeterministicGreenfieldPublisher({ corruptReadback: true }), "hash_mismatch"],
    ["provider", new DeterministicGreenfieldPublisher({ failCreate: true }), "create_failed"]
  ] as const)("records %s without claiming publication", async (_label, greenfield, expected) => {
    const result = await publisher({ greenfield, maxSealPolls: 2 }).publish({ artifact, idempotencyKey: `failure-${_label}`, providers: ["greenfield"] });
    expect(result.attempts[0]?.state).toBe(expected);
    expect(result.attempts[0]?.verification?.status).not.toBe("verified");
  });

  it("returns a duplicate state when the idempotency key is reused for different bytes", async () => {
    const store = new InMemoryPublicationStore();
    const instance = new EvidencePublisher({ store, ipfs: new DeterministicIpfsPublisher() });
    await instance.publish({ artifact, idempotencyKey: "duplicate-key", providers: ["ipfs"] });
    const altered = { ...artifact, version: 2 };
    const result = await instance.publish({ artifact: altered, idempotencyKey: "duplicate-key", providers: ["ipfs"] });
    expect(result.attempts[0]?.state).toBe("duplicate");
    expect(result.attempts[0]?.lastErrorCode).toBe("DUPLICATE_IDEMPOTENCY_KEY");
  });

  it("rejects path traversal in a caller-supplied object name", async () => {
    await expect(
      publisher().publish({
        artifact,
        idempotencyKey: "unsafe-object-name",
        providers: ["ipfs"],
        objectName: "evidence/../private.json"
      })
    ).rejects.toThrow("Invalid immutable evidence object name");
  });

  it("retries a provider failure without creating an IPFS fallback", async () => {
    const store = new InMemoryPublicationStore();
    const failing = new DeterministicGreenfieldPublisher({ failCreate: true });
    const first = new EvidencePublisher({ store, greenfield: failing });
    const failed = await first.publish({ artifact, idempotencyKey: "retry-me", providers: ["greenfield"] });
    expect(failed.attempts[0]?.state).toBe("create_failed");
    const recovered = new EvidencePublisher({ store, greenfield: new DeterministicGreenfieldPublisher() });
    const retry = await recovered.reconcile({ artifact, idempotencyKey: "retry-me", providers: ["greenfield"], provider: "greenfield" });
    expect(retry.state).toBe("verified");
    expect(retry.retryCount).toBe(1);
  });
});
