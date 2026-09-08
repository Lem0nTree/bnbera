import { describe, expect, it } from "vitest";
import {
  GreenfieldSdkPublisher,
  GREENFIELD_CANDIDATE_STANDARDS_PINS,
  GREENFIELD_TESTNET_CHAIN_ID,
  GREENFIELD_TESTNET_NETWORK,
  greenfieldObjectReference
} from "../src/index.js";

const createHash = `0x${"1".repeat(64)}`;
const sealHash = `0x${"2".repeat(64)}`;
const privateKey = `0x${"3".repeat(64)}`;

function sdkFixture(options: {
  readonly unknownCreate?: boolean;
  readonly providerFailure?: boolean;
  readonly malformedMetadata?: boolean;
  readonly metadataDelay?: number;
  readonly privateKeyValue?: string;
} = {}) {
  const bytes = new TextEncoder().encode("canonical bytes");
  const configuredPrivateKey = options.privateKeyValue ?? privateKey;
  let objectExists = false;
  let sealed = false;
  let createCalls = 0;
  let uploadCalls = 0;
  let broadcastCalls = 0;
  let metadataCalls = 0;
  let seenCreateMessage: Record<string, unknown> | null = null;
  let seenUpload: { readonly params: Record<string, unknown>; readonly auth: Record<string, unknown> } | null = null;
  const client = {
    object: {
      createObject: async (message: Record<string, unknown>) => {
        createCalls += 1;
        seenCreateMessage = message;
        return {
          simulate: async () => ({ gasLimit: 100n, gasPrice: "1" }),
          broadcast: async (params: Record<string, unknown>) => {
            broadcastCalls += 1;
            expect(params.privateKey).toBe(`0x${configuredPrivateKey.replace(/^0x/i, "")}`);
            objectExists = true;
            if (options.unknownCreate) throw new Error("connection closed after broadcast");
            return { code: 0, txhash: createHash };
          }
        };
      },
      uploadObject: async (params: Record<string, unknown>, auth: Record<string, unknown>) => {
        uploadCalls += 1;
        seenUpload = { params, auth };
        return { code: 0, statusCode: 200 };
      },
      getObjectMeta: async () => {
        metadataCalls += 1;
        if (options.providerFailure) return { code: 0, statusCode: 503, body: {} };
        if (options.malformedMetadata) return { code: 0, statusCode: 200, body: {} };
        if (!objectExists || metadataCalls <= (options.metadataDelay ?? 0)) return { code: 0, statusCode: 404, body: {} };
        return {
          code: 0,
          statusCode: 200,
          body: {
            GfSpGetObjectMetaResponse: {
              Object: {
                CreateTxHash: createHash,
                SealTxHash: sealed ? sealHash : "",
                ObjectInfo: {
                  ObjectName: "evidence/hackathon/agent_profile/agent-1/versions/1/agent_profile.json",
                  Owner: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  Creator: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  PayloadSize: bytes.byteLength,
                  ObjectStatus: sealed ? 1 : 0,
                  Checksums: ["AQ=="]
                }
              }
            }
          }
        };
      },
      getObject: async (_params: Record<string, unknown>, auth: Record<string, unknown>) => {
        expect(auth.privateKey).toBe(`0x${configuredPrivateKey.replace(/^0x/i, "")}`);
        return { code: 0, statusCode: 200, body: new Blob([bytes]) };
        }
      },
      headObject: async () => objectExists ? { objectInfo: { ObjectName: "present" } } : { objectInfo: null },
    sp: { getSPUrlByBucket: async () => "https://sp.example" }
  };
  const publisher = new GreenfieldSdkPublisher({
    network: GREENFIELD_TESTNET_NETWORK,
    chainId: GREENFIELD_TESTNET_CHAIN_ID,
    rpcUrl: "https://rpc.example",
    bucket: "greenfield-test",
    creator: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    keyReference: "GREENFIELD_PUBLISHER_PRIVATE_KEY",
    loadSecret: (reference) => {
      expect(reference).toBe("GREENFIELD_PUBLISHER_PRIVATE_KEY");
      return configuredPrivateKey;
    },
    sdkModule: {
      Client: { create: () => client },
      Long: { fromNumber: (value) => ({ toNumber: () => value }) }
    },
    sdkClient: client,
    standardsPins: {
      ...GREENFIELD_CANDIDATE_STANDARDS_PINS,
      storageProviders: [{
        providerLabel: "test-sp",
        endpoint: "https://sp.example",
        operatorAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }]
    },
    reedSolomonModule: {
      ReedSolomon: class {
        encode() {
          return ["AQ=="];
        }
      }
    },
    spEndpoint: "https://sp.example"
  });
  return { publisher, bytes, counts: () => ({ createCalls, uploadCalls, broadcastCalls }), createMessage: () => seenCreateMessage, upload: () => seenUpload, seal: () => { sealed = true; } };
}

type BucketMismatch = "owner" | "sp" | "visibility" | "payment";

function bucketSdkFixture(options: {
  readonly bucketExists?: boolean;
  readonly unknownBroadcast?: boolean;
  readonly delayedIndexPolls?: number;
  readonly mismatch?: BucketMismatch;
  readonly malformedHead?: boolean;
  readonly malformedSp?: boolean;
  readonly spNotFound?: boolean;
  readonly headError?: "no-such-bucket" | "timeout";
  readonly privateKeyValue?: string;
} = {}) {
  const creator = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const operator = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const configuredPrivateKey = options.privateKeyValue ?? privateKey;
  const bytes = new TextEncoder().encode("unused");
  let bucketExists = options.bucketExists ?? false;
  let delayedIndexPolls = 0;
  let headCalls = 0;
  let metaCalls = 0;
  let createCalls = 0;
  let simulateCalls = 0;
  let broadcastCalls = 0;
  let seenCreateMessage: Record<string, unknown> | null = null;
  let seenSimulation: Record<string, unknown> | null = null;
  let seenBroadcast: Record<string, unknown> | null = null;
  const bucketApi = {
    headBucket: async function (this: unknown, bucketName: string) {
      expect(this).toBe(bucketApi);
      headCalls += 1;
      expect(bucketName).toBe("greenfield-test");
      if (options.headError === "no-such-bucket") {
        throw new Error("Query failed with (6): No such bucket: unknown request");
      }
      if (options.headError === "timeout") {
        throw new Error("Query failed with (7): RPC timeout");
      }
      if (!bucketExists) {
        const error = Object.assign(new Error("bucket not found"), { statusCode: 404 });
        throw error;
      }
      if (delayedIndexPolls > 0) {
        delayedIndexPolls -= 1;
        const error = Object.assign(new Error("bucket not found while indexing"), { statusCode: 404 });
        throw error;
      }
      if (options.malformedHead) return { code: 0, statusCode: 200, body: {} };
      return {
        code: 0,
        statusCode: 200,
        bucketInfo: {
          BucketName: "greenfield-test",
          Owner: options.mismatch === "owner" ? "0xcccccccccccccccccccccccccccccccccccccccc" : creator,
          PaymentAddress: options.mismatch === "payment" ? "0xcccccccccccccccccccccccccccccccccccccccc" : creator,
          Visibility: options.mismatch === "visibility" ? 2 : 1,
          BucketStatus: 0
        }
      };
    },
    getBucketMeta: async function (this: unknown, params: Record<string, unknown>) {
      expect(this).toBe(bucketApi);
      metaCalls += 1;
      expect(params).toEqual({ bucketName: "greenfield-test", endpoint: "https://sp.example" });
      if (options.spNotFound) {
        const error = Object.assign(new Error("SP returned 404"), { statusCode: 404 });
        throw error;
      }
      if (options.malformedSp) return { code: 0, statusCode: 200, body: {} };
      return {
        code: 0,
        statusCode: 200,
        body: {
          GfSpGetBucketMetaResponse: {
            Bucket: {
              Operator: options.mismatch === "sp" ? "0xcccccccccccccccccccccccccccccccccccccccc" : operator,
              CreateTxHash: createHash
            }
          }
        }
      };
    },
    createBucket: async function (this: unknown, message: Record<string, unknown>) {
      expect(this).toBe(bucketApi);
      createCalls += 1;
      seenCreateMessage = message;
      return {
        simulate: async (params: Record<string, unknown>) => {
          simulateCalls += 1;
          seenSimulation = params;
          return { gasLimit: 100n, gasPrice: "1" };
        },
        broadcast: async (params: Record<string, unknown>) => {
          broadcastCalls += 1;
          seenBroadcast = params;
          bucketExists = true;
          if (options.unknownBroadcast) {
            delayedIndexPolls = options.delayedIndexPolls ?? 0;
            throw new Error("connection closed after broadcast");
          }
          return { code: 0, transactionHash: createHash };
        }
      };
    }
  };
  const client = {
    object: {
      createObject: async () => ({ broadcast: async () => ({}) }),
      uploadObject: async () => ({ code: 0 }),
      getObject: async () => ({ code: 0, body: new Blob([bytes]) }),
      getObjectMeta: async () => ({ code: 0, statusCode: 404, body: {} })
    },
    bucket: bucketApi,
    sp: { getSPUrlByBucket: async () => "https://sp.example" }
  };
  const publisher = new GreenfieldSdkPublisher({
    network: GREENFIELD_TESTNET_NETWORK,
    chainId: GREENFIELD_TESTNET_CHAIN_ID,
    rpcUrl: "https://rpc.example",
    bucket: "greenfield-test",
    creator,
    keyReference: "GREENFIELD_PUBLISHER_PRIVATE_KEY",
    loadSecret: () => configuredPrivateKey,
    sdkModule: {
      Client: { create: () => client },
      Long: { fromString: (value) => ({ toString: () => value }) },
      VisibilityType: { VISIBILITY_TYPE_PUBLIC_READ: 1 }
    },
    sdkClient: client,
    standardsPins: {
      ...GREENFIELD_CANDIDATE_STANDARDS_PINS,
      storageProviders: [{ providerLabel: "test-sp", endpoint: "https://sp.example", operatorAddress: operator }]
    },
    spEndpoint: "https://sp.example"
  });
  return {
    publisher,
    counts: () => ({ headCalls, metaCalls, createCalls, simulateCalls, broadcastCalls }),
    createMessage: () => seenCreateMessage,
    simulation: () => seenSimulation,
    broadcast: () => seenBroadcast
  };
}

describe("official Greenfield SDK adapter boundary", () => {
  it("creates with canonical Reed-Solomon checksums, uploads, reads seal hash, and reads back bytes", async () => {
    const fixture = sdkFixture();
    const objectName = "evidence/hackathon/agent_profile/agent-1/versions/1/agent_profile.json";
    const created = await fixture.publisher.createObject({ objectName, sizeBytes: fixture.bytes.byteLength, mimeType: "application/json", canonicalBytes: fixture.bytes });
    expect(created.creationTransactionHash).toBe(createHash);
    expect(created.objectReference).toBe(greenfieldObjectReference("greenfield-test", objectName));
    expect(fixture.createMessage()?.expectChecksums).toEqual([new Uint8Array([1])]);
    expect(fixture.createMessage()?.visibility).toBe(1);
    expect(fixture.createMessage()?.redundancyType).toBe(0);
    await fixture.publisher.uploadObject({
      bytes: fixture.bytes,
      objectName,
      sha256Digest: "a".repeat(64),
      keccak256Digest: "b".repeat(64),
      sizeBytes: fixture.bytes.byteLength,
      mimeType: "application/json",
      objectReference: created.objectReference!,
      creationTransactionHash: created.creationTransactionHash
    });
    expect(fixture.upload()?.params.txnHash).toBe(createHash);
    fixture.seal();
    expect(await fixture.publisher.waitForSeal({ objectReference: created.objectReference!, attempt: 1 })).toEqual({ status: "sealed", sealTransactionHash: sealHash });
    expect(await fixture.publisher.readObject({ objectReference: created.objectReference! })).toEqual(fixture.bytes);
    expect(fixture.counts()).toEqual({ createCalls: 1, uploadCalls: 1, broadcastCalls: 1 });
  });

  it("normalizes a bare private key for object create, upload, and readback", async () => {
    const fixture = sdkFixture({ privateKeyValue: "4".repeat(64) });
    const objectName = "evidence/hackathon/agent_profile/agent-1/versions/1/agent_profile.json";
    const created = await fixture.publisher.createObject({
      objectName,
      sizeBytes: fixture.bytes.byteLength,
      mimeType: "application/json",
      canonicalBytes: fixture.bytes
    });
    await fixture.publisher.uploadObject({
      bytes: fixture.bytes,
      objectName,
      sha256Digest: "a".repeat(64),
      keccak256Digest: "b".repeat(64),
      sizeBytes: fixture.bytes.byteLength,
      mimeType: "application/json",
      objectReference: created.objectReference!,
      creationTransactionHash: created.creationTransactionHash
    });
    fixture.seal();
    await fixture.publisher.waitForSeal({ objectReference: created.objectReference!, attempt: 1 });
    await fixture.publisher.readObject({ objectReference: created.objectReference! });
    expect(fixture.counts()).toEqual({ createCalls: 1, uploadCalls: 1, broadcastCalls: 1 });
  });

  it.each([
    "",
    "0x",
    "0x" + "a".repeat(63),
    "0x" + "a".repeat(65),
    "g".repeat(64),
    "0x" + "a".repeat(64) + "\n"
  ])("rejects a private key that is not exactly 64 hex characters (%s)", async (invalidPrivateKey) => {
    const fixture = sdkFixture({ privateKeyValue: invalidPrivateKey });
    await expect(fixture.publisher.uploadObject({
      bytes: fixture.bytes,
      objectName: "evidence/x",
      sha256Digest: "a".repeat(64),
      keccak256Digest: "b".repeat(64),
      sizeBytes: fixture.bytes.byteLength,
      mimeType: "application/json",
      objectReference: "greenfield-test/evidence/x"
    })).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(fixture.counts().uploadCalls).toBe(0);
  });

  it("recovers an unknown create outcome and does not submit a duplicate", async () => {
    const fixture = sdkFixture({ unknownCreate: true });
    const objectName = "evidence/hackathon/agent_profile/agent-1/versions/1/agent_profile.json";
    const input = { objectName, sizeBytes: fixture.bytes.byteLength, mimeType: "application/json" as const, canonicalBytes: fixture.bytes };
    const recovered = await fixture.publisher.createObject(input);
    const retried = await fixture.publisher.createObject(input);
    expect(recovered.creationTransactionHash).toBe(createHash);
    expect(retried.creationTransactionHash).toBe(createHash);
    expect(fixture.counts()).toEqual({ createCalls: 1, uploadCalls: 0, broadcastCalls: 1 });
  });

  it("keeps an unknown create blocked until delayed chain/SP indexing resolves", async () => {
    const fixture = sdkFixture({ unknownCreate: true, metadataDelay: 2 });
    const objectName = "evidence/hackathon/agent_profile/agent-1/versions/1/agent_profile.json";
    const input = { objectName, sizeBytes: fixture.bytes.byteLength, mimeType: "application/json" as const, canonicalBytes: fixture.bytes };
    await expect(fixture.publisher.createObject(input)).rejects.toMatchObject({ code: "CREATE_UNKNOWN", retryable: false });
    const recovered = await fixture.publisher.createObject(input);
    expect(recovered.creationTransactionHash).toBe(createHash);
    expect(fixture.counts()).toEqual({ createCalls: 1, uploadCalls: 0, broadcastCalls: 1 });
  });

  it("fails closed when metadata inspection cannot distinguish an object", async () => {
    const fixture = sdkFixture({ providerFailure: true });
    await expect(fixture.publisher.inspectObject({ objectName: "evidence/x" })).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(fixture.counts().createCalls).toBe(0);
  });

  it("rejects malformed successful metadata instead of treating it as missing", async () => {
    const fixture = sdkFixture({ malformedMetadata: true });
    await expect(fixture.publisher.inspectObject({ objectName: "evidence/x" })).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
  });

  it("reuses an existing matching public-read canary bucket", async () => {
    const fixture = bucketSdkFixture({ bucketExists: true });
    await expect(fixture.publisher.ensureCanaryBucket()).resolves.toEqual({
      status: "reused",
      bucketName: "greenfield-test",
      owner: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      primarySpAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      visibility: "public-read",
      creationTransactionHash: createHash
    });
    expect(fixture.counts()).toMatchObject({ headCalls: 1, metaCalls: 1, createCalls: 0 });
  });

  it("treats the official no-such-bucket query as missing and creates once", async () => {
    const fixture = bucketSdkFixture({ headError: "no-such-bucket" });
    await expect(fixture.publisher.ensureCanaryBucket()).resolves.toMatchObject({
      status: "created",
      creationTransactionHash: createHash
    });
    expect(fixture.counts()).toMatchObject({ createCalls: 1, broadcastCalls: 1 });
  });

  it("keeps unrelated bucket query errors unknown and does not create", async () => {
    const fixture = bucketSdkFixture({ headError: "timeout" });
    await expect(fixture.publisher.ensureCanaryBucket()).resolves.toMatchObject({ status: "unknown" });
    expect(fixture.counts()).toMatchObject({ createCalls: 0, broadcastCalls: 0 });
  });

  it("creates a missing canary bucket with the official bounded message and simulated gas", async () => {
    const fixture = bucketSdkFixture();
    await expect(fixture.publisher.ensureCanaryBucket()).resolves.toMatchObject({
      status: "created",
      creationTransactionHash: createHash,
      bucketName: "greenfield-test",
      visibility: "public-read"
    });
    const message = fixture.createMessage();
    expect(message?.bucketName).toBe("greenfield-test");
    expect(message?.creator).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(message?.paymentAddress).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(message?.primarySpAddress).toBe("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(message?.visibility).toBe(1);
    expect((message?.chargedReadQuota as { readonly toString: () => string }).toString()).toBe("0");
    expect(fixture.simulation()).toEqual({ denom: "BNB" });
    expect(fixture.broadcast()).toMatchObject({ privateKey });
    expect(fixture.counts()).toMatchObject({ headCalls: 1, createCalls: 1, simulateCalls: 1, broadcastCalls: 1 });
  });

  it("normalizes a bare private key before sending the bucket transaction", async () => {
    const barePrivateKey = "4".repeat(64);
    const fixture = bucketSdkFixture({ privateKeyValue: barePrivateKey });
    await expect(fixture.publisher.ensureCanaryBucket()).resolves.toMatchObject({ status: "created" });
    expect(fixture.broadcast()).toMatchObject({ privateKey: `0x${barePrivateKey}` });
  });

  it("does not rebroadcast an unknown bucket create while indexing is delayed", async () => {
    const fixture = bucketSdkFixture({ unknownBroadcast: true, delayedIndexPolls: 1 });
    await expect(fixture.publisher.ensureCanaryBucket()).resolves.toMatchObject({ status: "unknown", creationTransactionHash: null });
    await expect(fixture.publisher.ensureCanaryBucket()).resolves.toMatchObject({ status: "reused", creationTransactionHash: createHash });
    expect(fixture.counts()).toMatchObject({ createCalls: 1, broadcastCalls: 1, metaCalls: 1 });
  });

  it.each(["owner", "sp", "visibility", "payment"] as const)("rejects a canary bucket with a %s binding mismatch", async (mismatch) => {
    const fixture = bucketSdkFixture({ bucketExists: true, mismatch });
    await expect(fixture.publisher.ensureCanaryBucket()).rejects.toMatchObject({ code: "DURABLE_GRAPH_INVALID" });
    expect(fixture.counts().createCalls).toBe(0);
  });

  it("treats malformed successful chain metadata as an error", async () => {
    const fixture = bucketSdkFixture({ bucketExists: true, malformedHead: true });
    await expect(fixture.publisher.ensureCanaryBucket()).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(fixture.counts().createCalls).toBe(0);
  });

  it("does not treat an SP 404 as proof that a chain bucket is absent", async () => {
    const fixture = bucketSdkFixture({ bucketExists: true, spNotFound: true });
    await expect(fixture.publisher.ensureCanaryBucket()).resolves.toMatchObject({ status: "unknown", creationTransactionHash: null });
    expect(fixture.counts().createCalls).toBe(0);
  });

  it("reconciles missing or unknown buckets read-only after a fresh adapter instance", async () => {
    const missing = bucketSdkFixture();
    await expect(missing.publisher.reconcileCanaryBucket()).resolves.toMatchObject({
      status: "missing",
      bucketName: "greenfield-test",
      owner: null,
      primarySpAddress: null,
      visibility: null,
      creationTransactionHash: null
    });
    expect(missing.counts()).toMatchObject({ createCalls: 0, broadcastCalls: 0 });

    const unknown = bucketSdkFixture({ bucketExists: true, spNotFound: true });
    await expect(unknown.publisher.reconcileCanaryBucket()).resolves.toMatchObject({
      status: "unknown",
      creationTransactionHash: null
    });
    expect(unknown.counts()).toMatchObject({ createCalls: 0, broadcastCalls: 0 });
  });

  it("rejects malformed successful SP metadata", async () => {
    const fixture = bucketSdkFixture({ bucketExists: true, malformedSp: true });
    await expect(fixture.publisher.ensureCanaryBucket()).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(fixture.counts().createCalls).toBe(0);
  });
});
