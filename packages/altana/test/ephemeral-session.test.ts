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
  policyDigest: `0x${"aa".repeat(32)}`,
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
          sessionId: descriptor.sessionId,
          policyDigest: descriptor.policyDigest,
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

test("handoff rejects a grant descriptor outside the current session window", async () => {
  const material = new EphemeralSessionMaterial(new Uint8Array([1, 2, 3]));
  await assert.rejects(
    handoffRuntimeSession({
      material,
      descriptor: { ...descriptor, grantedAtUnix: 1_700_000_010 },
      destination: { provider: "local-test-only", reference: "test/altana/session-1" },
      nowUnix: 1_700_000_009,
      sink: {
        async putRuntimeSession() {
          throw new Error("must not be called");
        },
      },
    }),
    (error: unknown) => error instanceof Error && error.message.includes("grant time is outside"),
  );
  assert.equal(material.consumed, false);
});

test("handoff rejects an unapproved destination before consuming material", async () => {
  const material = new EphemeralSessionMaterial(new Uint8Array([1, 2, 3]));
  await assert.rejects(
    handoffRuntimeSession({
      material,
      descriptor,
      destination: { provider: "arbitrary-secret-store" as "local-test-only", reference: "test/session" },
      sink: {
        async putRuntimeSession() {
          throw new Error("must not be called");
        },
      },
    }),
    (error: unknown) => error instanceof Error && error.message.includes("approved typed destination"),
  );
  assert.equal(material.consumed, false);
});

test("handoff rejects a receipt not bound to the approved destination or session window", async () => {
  const material = new EphemeralSessionMaterial(new Uint8Array([1, 2, 3]));
  const destination = { provider: "local-test-only" as const, reference: "test/altana/session-1" };
  await assert.rejects(
    handoffRuntimeSession({
      material,
      descriptor,
      destination,
      sink: {
        async putRuntimeSession() {
          return {
            handoffId: "handoff-1",
            destination: { provider: "local-test-only", reference: "other/session" },
            sessionId: descriptor.sessionId,
            policyDigest: descriptor.policyDigest,
            acceptedAtUnix: 1_700_000_001,
            consumed: true,
          };
        },
      },
    }),
    (error: unknown) => error instanceof Error && error.message.includes("not bound"),
  );

  const expiredMaterial = new EphemeralSessionMaterial(new Uint8Array([1, 2, 3]));
  await assert.rejects(
    handoffRuntimeSession({
      material: expiredMaterial,
      descriptor,
      destination,
      nowUnix: 1_800_000_000,
      sink: {
        async putRuntimeSession() {
          throw new Error("must not be called");
        },
      },
    }),
    (error: unknown) => error instanceof Error && error.message.includes("Policy must expire"),
  );
  assert.equal(expiredMaterial.consumed, false);
});

test("handoff rejects receipts bound to a different session or policy digest", async () => {
  const destination = { provider: "local-test-only" as const, reference: "test/altana/session-1" };
  for (const receiptBinding of [
    { sessionId: "other-session", policyDigest: descriptor.policyDigest },
    { sessionId: descriptor.sessionId, policyDigest: `0x${"bb".repeat(32)}` as `0x${string}` },
  ]) {
    const material = new EphemeralSessionMaterial(new Uint8Array([1, 2, 3]));
    await assert.rejects(
      handoffRuntimeSession({
        material,
        descriptor,
        destination,
        sink: {
          async putRuntimeSession() {
            return {
              handoffId: "handoff-1",
              destination,
              ...receiptBinding,
              acceptedAtUnix: 1_700_000_001,
              consumed: true,
            };
          },
        },
      }),
      (error: unknown) => error instanceof Error && error.message.includes("not bound"),
    );
  }
});
