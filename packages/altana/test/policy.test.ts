import assert from "node:assert/strict";
import test from "node:test";
import {
  AltanaBoundaryError,
  assertActionWithinPolicy,
  assertCallAllowed,
  assertPolicyWithinBounds,
  createScopedPolicy,
  serializePolicy,
  toPublicPolicySummary,
} from "../src/index.ts";

const addresses = {
  admin: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  wallet: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  session: "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  router: "0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
} as const;

function makePolicy(nowUnix = 1_700_000_000) {
  return createScopedPolicy({
    chainId: 97,
    adminAddress: addresses.admin,
    walletAddress: addresses.wallet,
    sessionPublicAddress: addresses.session,
    calls: [
      {
        target: addresses.router,
        selectors: ["0xabcdef01", "0xABCDEF01"],
        maxNativeValueWei: 5n,
      },
    ],
    spend: [
      {
        token: "native",
        limitAtomic: 10n,
        period: "day",
      },
    ],
    expiry: "hour",
    nowUnix,
  });
}

test("normalizes addresses/selectors and serializes bigint limits safely", () => {
  const policy = makePolicy();

  assert.equal(policy.adminAddress, addresses.admin.toLowerCase());
  assert.equal(policy.calls[0]?.target, addresses.router.toLowerCase());
  assert.deepEqual(policy.calls[0]?.selectors, ["0xabcdef01"]);
  assert.equal(serializePolicy(policy).includes('"limitAtomic":"10"'), true);
  assert.doesNotThrow(() => JSON.parse(serializePolicy(policy)));
});

test("allows only explicitly listed target, selector, and native value", () => {
  const policy = makePolicy();
  const nowUnix = 1_700_000_001;

  assert.doesNotThrow(() =>
    assertCallAllowed(
      policy,
      { target: addresses.router, selector: "0xabcdef01", valueWei: 5n, spends: [{ token: "native", amountAtomic: 5n, period: "day" }] },
      nowUnix,
    ),
  );

  assert.throws(
    () =>
      assertCallAllowed(
        policy,
        { target: addresses.router, selector: "0xabcdef02", valueWei: 0n, spends: [] },
        nowUnix,
      ),
    (error: unknown) => error instanceof AltanaBoundaryError && error.code === "CALL_NOT_ALLOWED",
  );

  assert.throws(
    () =>
      assertCallAllowed(
        policy,
        { target: addresses.router, selector: "0xabcdef01", valueWei: 6n, spends: [{ token: "native", amountAtomic: 6n, period: "day" }] },
        nowUnix,
      ),
    (error: unknown) => error instanceof AltanaBoundaryError && error.code === "NATIVE_VALUE_EXCEEDED",
  );
});

test("preserves target-selector relationships and per-call native caps publicly", () => {
  const policy = makePolicy();
  const summary = toPublicPolicySummary(policy);

  assert.deepEqual(summary.calls, [{
    target: addresses.router.toLowerCase(),
    selectors: ["0xabcdef01"],
    maxNativeValueWei: "5",
  }]);
  assert.deepEqual(summary.spend, [{ token: "native", limitAtomic: "10", period: "day" }]);
});

test("enforces explicit spend charges and cumulative limits", () => {
  const policy = makePolicy();
  const valid = {
    target: addresses.router,
    selector: "0xabcdef01" as const,
    valueWei: 5n,
    spends: [{ token: "native" as const, amountAtomic: 5n, period: "day" as const }],
  };

  assert.doesNotThrow(() => assertActionWithinPolicy(policy, valid, 1_700_000_001, [
    { token: "native", amountAtomic: 4n, period: "day" },
  ]));
  assert.throws(
    () => assertActionWithinPolicy(policy, valid, 1_700_000_001, [
      { token: "native", amountAtomic: 6n, period: "day" },
    ]),
    (error: unknown) => error instanceof AltanaBoundaryError && error.code === "SPEND_LIMIT_EXCEEDED",
  );
  assert.throws(
    () => assertActionWithinPolicy(policy, {
      ...valid,
      spends: [
        { token: "native", amountAtomic: 2n, period: "day" },
        { token: "native", amountAtomic: 3n, period: "day" },
      ],
    }, 1_700_000_001, [
      { token: "native", amountAtomic: 6n, period: "day" },
    ]),
    (error: unknown) => error instanceof AltanaBoundaryError && error.code === "SPEND_LIMIT_EXCEEDED",
  );
  assert.throws(
    () => assertActionWithinPolicy(policy, {
      ...valid,
      spends: [
        { token: "native", amountAtomic: 5n, period: "day" },
        { token: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", amountAtomic: 0n, period: "day" },
      ],
    }, 1_700_000_001, []),
    (error: unknown) => error instanceof AltanaBoundaryError && error.code === "SPEND_NOT_ALLOWED",
  );
  assert.throws(
    () => assertActionWithinPolicy(policy, {
      ...valid,
      spends: [],
    }, 1_700_000_001, []),
    (error: unknown) => error instanceof AltanaBoundaryError && error.code === "SPEND_UNVERIFIED",
  );
  assert.throws(
    () => assertActionWithinPolicy(policy, {
      ...valid,
      valueWei: 0n,
      spends: [],
    }, 1_700_000_001, [
      { token: "native", amountAtomic: 11n, period: "day" },
    ]),
    (error: unknown) => error instanceof AltanaBoundaryError && error.code === "SPEND_LIMIT_EXCEEDED",
  );
});

test("rejects policies that exceed configured lifetime or entry limits", () => {
  const policy = makePolicy();

  assert.throws(
    () =>
      assertPolicyWithinBounds(policy, {
        maxCallEntries: 1,
        maxSelectorsPerCall: 1,
        maxLifetimeSeconds: 30,
        maxSpendAtomic: 10n,
      }, 1_700_000_000),
    (error: unknown) => error instanceof AltanaBoundaryError && error.code === "POLICY_BOUND_EXCEEDED",
  );
});
