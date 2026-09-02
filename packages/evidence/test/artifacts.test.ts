import { describe, expect, it } from "vitest";
import { canonicalizeJson } from "@bnbera/domain";
import {
  ArtifactSecurityError,
  createEvidenceLocator,
  deterministicObjectName,
  digestArtifact,
  keccak256Hex
} from "../src/index.js";

const identity = {
  namespace: "eip155",
  chainId: 97,
  identityRegistry: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  agentId: "7"
} as const;

function profile(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "bnbera.evidence/v1",
    artifactType: "agent_profile",
    artifactId: "agent-7",
    version: 1,
    environment: "hackathon",
    createdAt: "2026-09-02T08:00:00+00:00",
    payload: {
      identity,
      name: "Example agent",
      description: "A deterministic test profile.",
      category: "rebalancing",
      services: [],
      supportedProtocols: ["a2a"],
      capabilityManifestHash: null,
      template: null,
      pricing: { currency: "USD", amount: "1" },
      authoritySummary: null,
      evidenceReferences: []
    },
    ...overrides
  };
}

describe("canonical public artifacts", () => {
  it("normalizes public addresses and produces stable bytes and both digests", () => {
    const first = digestArtifact(profile());
    const second = digestArtifact(profile({ createdAt: "2026-09-02T10:00:00Z" }));

    const normalized = first.artifact as Extract<typeof first.artifact, { readonly artifactType: "agent_profile" }>;
    expect(normalized.payload.identity.identityRegistry).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    expect(first.canonicalJson).toBe(canonicalizeJson(first.artifact));
    expect(first.sizeBytes).toBe(first.canonicalBytes.byteLength);
    expect(first.sha256Digest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.keccak256Digest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.sha256Digest).not.toBe(second.sha256Digest);
  });

  it("uses a deterministic immutable object name", () => {
    const artifact = digestArtifact(profile()).artifact;
    expect(deterministicObjectName(artifact)).toBe(
      "evidence/hackathon/agent_profile/agent-7/versions/1/agent_profile.json"
    );
    expect(deterministicObjectName(artifact)).toBe(deterministicObjectName(artifact));
  });

  it("uses EVM Keccak rather than SHA3-256", () => {
    expect(keccak256Hex("")).toBe("c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  });

  it.each(["secretKey", "apiKey", "mnemonic", "awsSecretAccessKey"])(
    "rejects unknown credential-shaped public key %s",
    (key) => {
      expect(() =>
        digestArtifact(
          profile({
            payload: {
              ...profile().payload,
              pricing: { currency: "USD", amount: "1", [key]: "never" }
            }
          })
        )
      ).toThrow();
    }
  );

  it("rejects unknown public keys even when they do not look secret", () => {
    expect(() =>
      digestArtifact(
        profile({
          payload: {
            ...profile().payload,
            pricing: { currency: "USD", amount: "1", unsupportedField: "never" }
          }
        })
      )
    ).toThrow();
  });

  it("rejects secret-like values even when nested under a public field", () => {
    expect(() =>
      digestArtifact(
        profile({
          payload: {
            ...profile().payload,
            pricing: { currency: "USD", amount: "1", asset: "-----BEGIN PRIVATE KEY-----not-public-----END PRIVATE KEY-----" }
          }
        })
      )
    ).toThrow(ArtifactSecurityError);
  });

  it("models a submission claim as a correlated storage and protocol evidence graph", () => {
    const referenced = digestArtifact(profile());
    const ipfs = createEvidenceLocator({
      provider: "ipfs",
      providerLabel: "ipfs-test",
      network: "ipfs-test",
      uri: "ipfs://claim-evidence",
      providerReference: "cid-claim-evidence",
      version: referenced.artifact.version,
      sha256Digest: referenced.sha256Digest,
      keccak256Digest: referenced.keccak256Digest,
      sizeBytes: referenced.sizeBytes
    });
    const greenfield = createEvidenceLocator({
      provider: "greenfield",
      providerLabel: "greenfield-test",
      network: "greenfield_5600-1",
      uri: "greenfield://greenfield-test/evidence/hackathon/agent_profile/agent-7/versions/1/agent_profile.json",
      bucket: "greenfield-test",
      objectName: "evidence/hackathon/agent_profile/agent-7/versions/1/agent_profile.json",
      providerReference: "greenfield-ref",
      version: referenced.artifact.version,
      sha256Digest: referenced.sha256Digest,
      keccak256Digest: referenced.keccak256Digest,
      sizeBytes: referenced.sizeBytes
    });
    const submission = {
      schemaVersion: "bnbera.evidence/v1",
      artifactType: "submission_index",
      artifactId: "submission-1",
      version: 1,
      environment: "hackathon",
      createdAt: "2026-09-02T08:00:00Z",
      payload: {
        generatedAt: "2026-09-02T08:00:00Z",
        entries: [
          {
            claimId: "claim-1",
            claim: "The run produced verified immutable evidence.",
            proofType: "object",
            evidence: {
              artifactId: referenced.artifact.artifactId,
              version: referenced.artifact.version,
              sha256Digest: referenced.sha256Digest,
              keccak256Digest: referenced.keccak256Digest
            },
            status: "verified",
            correlation: { runId: "run-1", jobId: "job-1", deploymentId: "deployment-1", requestId: "request-1" },
            storage: {
              ipfs: {
                provider: "ipfs",
                network: ipfs.network,
                locator: ipfs,
                storageState: "uploaded",
                creationTransactionHash: null,
                sealTransactionHash: null,
                readbackState: "matched",
                providerReference: ipfs.providerReference
              },
              greenfield: {
                provider: "greenfield",
                network: greenfield.network,
                locator: greenfield,
                storageState: "sealed",
                creationTransactionHash: `0x${"1".repeat(64)}`,
                sealTransactionHash: `0x${"2".repeat(64)}`,
                readbackState: "matched",
                providerReference: greenfield.providerReference
              }
            },
            references: {
              bsc: [{ kind: "bsc", network: "bsc-testnet", reference: "run-1", transactionHash: `0x${"3".repeat(64)}`, state: "confirmed" }],
              altana: [{ kind: "altana", network: "altana-testnet", reference: "session-1", transactionHash: null, state: "observed" }],
              erc8183: [{ kind: "erc8183", network: "bsc-testnet", reference: "job-1", transactionHash: `0x${"4".repeat(64)}`, state: "confirmed" }],
              x402: [{ kind: "x402", network: "bsc-testnet", reference: "payment-1", transactionHash: `0x${"5".repeat(64)}`, state: "confirmed" }]
            }
          }
        ]
      }
    } as const;
    expect(digestArtifact(submission).sizeBytes).toBeGreaterThan(0);
  });
});
