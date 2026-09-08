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

function sdkFixture(options: { readonly unknownCreate?: boolean; readonly providerFailure?: boolean; readonly malformedMetadata?: boolean; readonly metadataDelay?: number } = {}) {
  const bytes = new TextEncoder().encode("canonical bytes");
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
            expect(params.privateKey).toBe(privateKey);
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
        expect(auth.privateKey).toBe(privateKey);
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
      return privateKey;
    },
    sdkModule: {
      Client: { create: () => client },
      Long: { fromNumber: (value) => ({ toNumber: () => value }) }
    },
    sdkClient: client,
    standardsPins: {
      ...GREENFIELD_CANDIDATE_STANDARDS_PINS,
      storageProviders: [{ providerLabel: "test-sp", endpoint: "https://sp.example" }]
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
});
