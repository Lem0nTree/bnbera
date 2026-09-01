import { AltanaBoundaryError } from "./errors.ts";
import type {
  ActionRequest,
  Address,
  CallPermission,
  ChainId,
  CumulativeSpend,
  PermissionPeriod,
  ScopedPolicy,
  SpendCharge,
  SpendPermission,
} from "./types.ts";

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const SELECTOR_PATTERN = /^0x[a-fA-F0-9]{8}$/;
const PERMISSION_PERIODS = new Set<PermissionPeriod>([
  "call",
  "hour",
  "day",
  "week",
  "lifetime",
]);

export const EXPIRY_PRESETS = {
  hour: 60 * 60,
  day: 24 * 60 * 60,
  week: 7 * 24 * 60 * 60,
} as const;

export type ExpiryPreset = keyof typeof EXPIRY_PRESETS;

export interface PolicyDraft {
  readonly chainId: ChainId;
  readonly adminAddress: string;
  readonly walletAddress: string;
  readonly sessionPublicAddress: string;
  readonly calls: readonly CallPermission[];
  readonly spend: readonly SpendPermission[];
  readonly expiry: ExpiryPreset;
  readonly nowUnix?: number;
}

export interface PolicyBounds {
  /** Maximum number of allowlisted contract entries. */
  readonly maxCallEntries: number;
  /** Maximum number of selectors in one contract entry. */
  readonly maxSelectorsPerCall: number;
  /** Maximum lifetime from grant time. */
  readonly maxLifetimeSeconds: number;
  /** Optional maximum per-token limit. */
  readonly maxSpendAtomic?: bigint;
}

export function normalizeAddress(value: string): Address {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) {
    throw new AltanaBoundaryError(
      "INVALID_ADDRESS",
      "An allowlist address must be a 20-byte hexadecimal address.",
    );
  }
  return `0x${value.slice(2).toLowerCase()}` as Address;
}

export function normalizeSelector(value: string): `0x${string}` {
  if (typeof value !== "string" || !SELECTOR_PATTERN.test(value)) {
    throw new AltanaBoundaryError(
      "INVALID_SELECTOR",
      "An allowlist selector must be exactly four bytes.",
    );
  }
  return `0x${value.slice(2).toLowerCase()}` as `0x${string}`;
}

function assertBigint(value: unknown, message: string): asserts value is bigint {
  if (typeof value !== "bigint") {
    throw new AltanaBoundaryError("INVALID_SPEND_LIMIT", message);
  }
}

function normalizeCallPermission(permission: CallPermission): CallPermission {
  assertBigint(
    permission.maxNativeValueWei,
    "Native-value limits must use bigint atomic values.",
  );
  if (permission.maxNativeValueWei < 0n) {
    throw new AltanaBoundaryError(
      "INVALID_SPEND_LIMIT",
      "A native-value limit cannot be negative.",
    );
  }

  const selectors = permission.selectors.map(normalizeSelector);
  if (selectors.length === 0) {
    throw new AltanaBoundaryError(
      "EMPTY_ALLOWLIST",
      "Every allowlisted contract must name at least one selector.",
    );
  }

  return {
    target: normalizeAddress(permission.target),
    selectors: [...new Set(selectors)].sort(),
    maxNativeValueWei: permission.maxNativeValueWei,
  };
}

function normalizeSpendPermission(permission: SpendPermission): SpendPermission {
  assertBigint(permission.limitAtomic, "Token spend limits must use bigint atomic values.");
  if (permission.limitAtomic < 0n) {
    throw new AltanaBoundaryError(
      "INVALID_SPEND_LIMIT",
      "A token spend limit cannot be negative.",
    );
  }

  if (!PERMISSION_PERIODS.has(permission.period)) {
    throw new AltanaBoundaryError(
      "INVALID_SPEND_LIMIT",
      "A spend permission must use a supported bounded period.",
    );
  }

  return {
    token:
      permission.token === "native" ? "native" : normalizeAddress(permission.token),
    limitAtomic: permission.limitAtomic,
    period: permission.period,
  };
}

export function normalizePolicy(policy: ScopedPolicy): ScopedPolicy {
  if (policy.chainId !== 56 && policy.chainId !== 97) {
    throw new AltanaBoundaryError("INVALID_CHAIN", "Only BSC chain 56 or 97 is supported.");
  }

  if (!Number.isSafeInteger(policy.expiresAtUnix) || policy.expiresAtUnix <= 0) {
    throw new AltanaBoundaryError(
      "INVALID_EXPIRY",
      "Policy expiry must be a positive Unix-second integer.",
    );
  }

  if (policy.calls.length === 0) {
    throw new AltanaBoundaryError(
      "EMPTY_ALLOWLIST",
      "A runtime session must contain at least one explicit call permission.",
    );
  }

  const calls = policy.calls.map(normalizeCallPermission);
  const spend = policy.spend.map(normalizeSpendPermission);

  if (spend.some((entry) => entry.limitAtomic === 0n)) {
    throw new AltanaBoundaryError(
      "INVALID_SPEND_LIMIT",
      "A spend permission must have a positive limit or be omitted.",
    );
  }

  return {
    chainId: policy.chainId,
    adminAddress: normalizeAddress(policy.adminAddress),
    walletAddress: normalizeAddress(policy.walletAddress),
    sessionPublicAddress: normalizeAddress(policy.sessionPublicAddress),
    calls: calls
      .sort((left, right) => left.target.localeCompare(right.target))
      .map((entry) => ({ ...entry, selectors: [...entry.selectors] })),
    spend: spend
      .sort((left, right) => `${left.token}:${left.period}`.localeCompare(`${right.token}:${right.period}`))
      .map((entry) => ({ ...entry })),
    expiresAtUnix: policy.expiresAtUnix,
  };
}

export function createScopedPolicy(draft: PolicyDraft): ScopedPolicy {
  const nowUnix = draft.nowUnix ?? Math.floor(Date.now() / 1000);
  const policy: ScopedPolicy = {
    chainId: draft.chainId,
    adminAddress: normalizeAddress(draft.adminAddress),
    walletAddress: normalizeAddress(draft.walletAddress),
    sessionPublicAddress: normalizeAddress(draft.sessionPublicAddress),
    calls: draft.calls,
    spend: draft.spend,
    expiresAtUnix: nowUnix + EXPIRY_PRESETS[draft.expiry],
  };

  return assertPolicyValidAt(policy, nowUnix);
}

export function assertPolicyValidAt(policy: ScopedPolicy, nowUnix: number): ScopedPolicy {
  const normalized = normalizePolicy(policy);
  if (!Number.isSafeInteger(nowUnix) || nowUnix >= normalized.expiresAtUnix) {
    throw new AltanaBoundaryError(
      "INVALID_EXPIRY",
      "Policy must expire after the current Unix-second time.",
    );
  }
  return normalized;
}

export function assertPolicyWithinBounds(
  policy: ScopedPolicy,
  bounds: PolicyBounds,
  nowUnix: number,
): ScopedPolicy {
  const normalized = assertPolicyValidAt(policy, nowUnix);
  const lifetime = normalized.expiresAtUnix - nowUnix;

  if (
    normalized.calls.length > bounds.maxCallEntries ||
    normalized.calls.some((entry) => entry.selectors.length > bounds.maxSelectorsPerCall) ||
    lifetime > bounds.maxLifetimeSeconds
  ) {
    throw new AltanaBoundaryError(
      "POLICY_BOUND_EXCEEDED",
      "The requested authority exceeds the configured call or lifetime bound.",
    );
  }

  if (
    bounds.maxSpendAtomic !== undefined &&
    normalized.spend.some((entry) => entry.limitAtomic > bounds.maxSpendAtomic!)
  ) {
    throw new AltanaBoundaryError(
      "POLICY_BOUND_EXCEEDED",
      "The requested authority exceeds the configured spend bound.",
    );
  }

  return normalized;
}

export function isCallAllowed(policy: ScopedPolicy, request: ActionRequest): boolean {
  if (typeof request.valueWei !== "bigint") return false;
  const target = normalizeAddress(request.target);
  const selector = normalizeSelector(request.selector);
  return policy.calls.some(
    (entry) =>
      entry.target === target &&
      entry.selectors.includes(selector) &&
      request.valueWei >= 0n &&
      request.valueWei <= entry.maxNativeValueWei,
  );
}

export function assertCallAllowed(
  policy: ScopedPolicy,
  request: ActionRequest,
  nowUnix: number,
): void {
  assertPolicyValidAt(policy, nowUnix);
  if (!isCallAllowed(policy, request)) {
    throw new AltanaBoundaryError(
      typeof request.valueWei === "bigint" && request.valueWei > 0n
        ? "NATIVE_VALUE_EXCEEDED"
        : "CALL_NOT_ALLOWED",
      "The requested target, selector, or native value is outside the scoped policy.",
    );
  }
}

function normalizeSpendCharge(charge: SpendCharge): SpendCharge {
  assertBigint(charge.amountAtomic, "Spend charges must use bigint atomic values.");
  if (charge.amountAtomic < 0n) {
    throw new AltanaBoundaryError(
      "INVALID_SPEND_REQUEST",
      "A spend charge cannot be negative.",
    );
  }
  if (!PERMISSION_PERIODS.has(charge.period)) {
    throw new AltanaBoundaryError(
      "INVALID_SPEND_REQUEST",
      "A spend charge must use a supported bounded period.",
    );
  }
  return {
    token: charge.token === "native" ? "native" : normalizeAddress(charge.token),
    amountAtomic: charge.amountAtomic,
    period: charge.period,
  };
}

function normalizeCumulativeSpend(entry: CumulativeSpend): CumulativeSpend {
  assertBigint(entry.amountAtomic, "Cumulative spend must use bigint atomic values.");
  if (entry.amountAtomic < 0n) {
    throw new AltanaBoundaryError(
      "INVALID_SPEND_REQUEST",
      "Cumulative spend cannot be negative.",
    );
  }
  if (!PERMISSION_PERIODS.has(entry.period)) {
    throw new AltanaBoundaryError(
      "INVALID_SPEND_REQUEST",
      "Cumulative spend must use a supported bounded period.",
    );
  }
  return {
    token: entry.token === "native" ? "native" : normalizeAddress(entry.token),
    amountAtomic: entry.amountAtomic,
    period: entry.period,
  };
}

function sameSpendBucket(
  left: Pick<SpendPermission, "token" | "period">,
  right: Pick<SpendPermission, "token" | "period">,
): boolean {
  return left.token === right.token && left.period === right.period;
}

/**
 * Validate both call permissions and token/native spend limits. Callers must
 * provide the usage already charged in each matching period; missing usage is
 * treated as zero, while malformed usage fails closed.
 */
export function assertActionWithinPolicy(
  policy: ScopedPolicy,
  request: ActionRequest,
  nowUnix: number,
  cumulativeSpend: readonly CumulativeSpend[],
): void {
  assertPolicyValidAt(policy, nowUnix);
  assertCallAllowed(policy, request, nowUnix);

  if (!Array.isArray(request.spends) || !Array.isArray(cumulativeSpend)) {
    throw new AltanaBoundaryError(
      "SPEND_UNVERIFIED",
      "Token and native spend must be provided explicitly before execution.",
    );
  }

  const normalizedPolicy = normalizePolicy(policy);
  const charges = request.spends.map(normalizeSpendCharge);
  const usage = cumulativeSpend.map(normalizeCumulativeSpend);

  const nativeCharge = charges
    .filter((charge) => charge.token === "native")
    .reduce((total, charge) => total + charge.amountAtomic, 0n);
  if (nativeCharge !== request.valueWei) {
    throw new AltanaBoundaryError(
      "SPEND_UNVERIFIED",
      "Native call value must match the explicit native spend charge.",
    );
  }

  for (const previous of usage) {
    const permission = normalizedPolicy.spend.find((candidate) =>
      sameSpendBucket(candidate, previous),
    );
    if (permission === undefined) {
      throw new AltanaBoundaryError(
        "SPEND_UNVERIFIED",
        "Cumulative spend contains an unsupported token or period.",
      );
    }
  }

  for (const permission of normalizedPolicy.spend) {
    const prior = usage
      .filter((entry) => sameSpendBucket(entry, permission))
      .reduce((total, entry) => total + entry.amountAtomic, 0n);
    if (prior > permission.limitAtomic) {
      throw new AltanaBoundaryError(
        "SPEND_LIMIT_EXCEEDED",
        "Existing cumulative spend is already outside the scoped limit.",
      );
    }
  }

  const chargeTotals = new Map<string, SpendCharge>();
  for (const charge of charges) {
    const key = `${charge.token}:${charge.period}`;
    const existing = chargeTotals.get(key);
    chargeTotals.set(key, {
      ...charge,
      amountAtomic: (existing?.amountAtomic ?? 0n) + charge.amountAtomic,
    });
  }

  for (const charge of chargeTotals.values()) {
    const permission = normalizedPolicy.spend.find((candidate) =>
      sameSpendBucket(candidate, charge),
    );
    if (permission === undefined) {
      throw new AltanaBoundaryError(
        "SPEND_NOT_ALLOWED",
        "The requested token or spend period is outside the scoped policy.",
      );
    }

    const prior = usage
      .filter((entry) => sameSpendBucket(entry, charge))
      .reduce((total, entry) => total + entry.amountAtomic, 0n);
    if (prior + charge.amountAtomic > permission.limitAtomic) {
      throw new AltanaBoundaryError(
        "SPEND_LIMIT_EXCEEDED",
        "The requested spend exceeds the scoped cumulative limit.",
      );
    }
  }
}

/**
 * Stable, secret-free representation suitable for hashing by the caller.
 * Bigints are encoded as decimal strings to make accidental JSON leakage
 * impossible and to preserve atomic values exactly.
 */
export function serializePolicy(policy: ScopedPolicy): string {
  const normalized = normalizePolicy(policy);
  return JSON.stringify({
    chainId: normalized.chainId,
    adminAddress: normalized.adminAddress,
    walletAddress: normalized.walletAddress,
    sessionPublicAddress: normalized.sessionPublicAddress,
    calls: normalized.calls.map((entry) => ({
      target: entry.target,
      selectors: [...entry.selectors],
      maxNativeValueWei: entry.maxNativeValueWei.toString(10),
    })),
    spend: normalized.spend.map((entry) => ({
      token: entry.token,
      limitAtomic: entry.limitAtomic.toString(10),
      period: entry.period,
    })),
    expiresAtUnix: normalized.expiresAtUnix,
  });
}

export interface PublicPolicySummary {
  readonly chainId: ChainId;
  readonly adminAddress: Address;
  readonly walletAddress: Address;
  readonly sessionPublicAddress: Address;
  readonly calls: readonly {
    readonly target: Address;
    readonly selectors: readonly `0x${string}`[];
    readonly maxNativeValueWei: string;
  }[];
  readonly spend: readonly {
    token: Address | "native";
    limitAtomic: string;
    period: PermissionPeriod;
  }[];
  readonly expiresAtUnix: number;
}

export function toPublicPolicySummary(policy: ScopedPolicy): PublicPolicySummary {
  const normalized = normalizePolicy(policy);
  return {
    chainId: normalized.chainId,
    adminAddress: normalized.adminAddress,
    walletAddress: normalized.walletAddress,
    sessionPublicAddress: normalized.sessionPublicAddress,
    calls: normalized.calls.map((entry) => ({
      target: entry.target,
      selectors: [...entry.selectors],
      maxNativeValueWei: entry.maxNativeValueWei.toString(10),
    })),
    spend: normalized.spend.map((entry) => ({
      token: entry.token,
      limitAtomic: entry.limitAtomic.toString(10),
      period: entry.period,
    })),
    expiresAtUnix: normalized.expiresAtUnix,
  };
}
