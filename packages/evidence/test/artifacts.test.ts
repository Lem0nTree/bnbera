import { describe, expect, it } from "vitest";
import { canonicalizeJson } from "@bnbera/domain";
import {
  ArtifactSecurityError,
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

  it("rejects secret-bearing fields before bytes are generated", () => {
    expect(() =>
      digestArtifact(
        profile({
          payload: {
            ...profile().payload,
            pricing: { privateKey: "never" }
          }
        })
      )
    ).toThrow(ArtifactSecurityError);
  });

  it("rejects secret-like values even when nested under a public field", () => {
    expect(() =>
      digestArtifact(
        profile({
          payload: {
            ...profile().payload,
            pricing: { note: "-----BEGIN PRIVATE KEY-----not-public-----END PRIVATE KEY-----" }
          }
        })
      )
    ).toThrow(ArtifactSecurityError);
  });
});
