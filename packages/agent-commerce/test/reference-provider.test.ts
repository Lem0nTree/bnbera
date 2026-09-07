import { describe, expect, it, vi } from "vitest";
import { verifyErc8183ManifestText } from "@altananetwork/sdk";
import {
  Erc8183ReferenceProviderAdapter,
  canonicalHealthFactorResultBytes,
  calculateReferenceHealthFactor,
  createReferenceHealthFactorResult,
  createReferenceHealthFactorTask,
  healthFactorLendingSnapshotSchema,
  type Erc8183AltanaAuthority,
  type Erc8183CommerceService,
  type Erc8183JobKey,
  type Erc8183ProviderBinding
} from "../src/index.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as `0x${string}`;
const ROUTER = "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25" as `0x${string}`;
const POLICY = "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea" as `0x${string}`;
const CLIENT = "0x3333333333333333333333333333333333333333" as `0x${string}`;
const PROVIDER = "0x4444444444444444444444444444444444444444" as `0x${string}`;
const OTHER = "0x5555555555555555555555555555555555555555" as `0x${string}`;
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

const AUTHORITY = { wallet: { address: PROVIDER } } as unknown as Erc8183AltanaAuthority;

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
      idempotencyKey: "t5-reference-submit-7",
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

  it("rejects unproven or zero debt snapshots instead of fabricating finance data", () => {
    expect(() => healthFactorLendingSnapshotSchema.parse({ ...SNAPSHOT, debtValueUsd: "0.0" })).toThrow(/positive debt/i);
    expect(() => healthFactorLendingSnapshotSchema.parse({ ...SNAPSHOT, sourceReference: "http://example.test/snapshot" })).toThrow(/HTTPS source/i);
    expect(() => healthFactorLendingSnapshotSchema.parse({ ...SNAPSHOT, observedBlockHash: undefined, observedBlock: undefined })).not.toThrow();
  });
});
