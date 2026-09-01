import assert from "node:assert/strict";
import test from "node:test";
import {
  EphemeralSessionMaterial,
  handoffRuntimeSession,
  type RuntimeSessionDescriptor,
} from "../src/index.ts";

const descriptor: RuntimeSessionDescriptor = {
  sessionId: "test-session-1",
  policy: {
    chainId: 97,
    adminAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    sessionPublicAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
    calls: [
      {
        target: "0xdddddddddddddddddddddddddddddddddddddddd",
        selectors: ["0xabcdef01"],
        maxNativeValueWei: 0n,
      },
    ],
    spend: [],
    expiresAtUnix: 1_800_000_000,
  },
  policyDigest: null,
  grantTransactionHash: null,
  secretReference: null,
  grantedAtUnix: 1_700_000_000,
};

test("session material is one-time, redacted, and zeroed after handoff", async () => {
  const original = new TextEncoder().encode("bounded-session-test-material");
  const material = new EphemeralSessionMaterial(original);
  const destination = {
    provider: "local-test-only" as const,
    reference: "test/altana/session-1",
  };
  let received: Uint8Array | undefined;
  const receipt = await handoffRuntimeSession({
    material,
    descriptor,
    destination,
    sink: {
      async putRuntimeSession({ bytes }) {
        received = new Uint8Array(bytes);
        return {
          handoffId: "handoff-1",
          destination,
          acceptedAtUnix: 1_700_000_001,
          consumed: true,
        };
      },
    },
  });

  assert.equal(receipt.consumed, true);
  assert.deepEqual(received, original);
  assert.equal(material.consumed, true);
  assert.deepEqual(JSON.stringify(material), JSON.stringify({ redacted: true }));
  assert.throws(() => material.consume(), /one-time/);
});

test("handoff refuses a descriptor that already carries a secret reference", async () => {
  const material = new EphemeralSessionMaterial(new Uint8Array([1, 2, 3]));
  await assert.rejects(
    handoffRuntimeSession({
      material,
      descriptor: { ...descriptor, secretReference: "secret/value" },
      destination: { provider: "local-test-only", reference: "test/altana/session-1" },
      sink: {
        async putRuntimeSession() {
          throw new Error("must not be called");
        },
      },
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "A descriptor cannot already contain a destination secret value or reference.",
  );
  assert.equal(material.consumed, false);
});

