import {
  canonicalSha256Hex,
  normalizeEvmAddress
} from "@bnbera/domain";
import { CommerceError } from "./errors.js";
import {
  decimalUintSchema,
  erc8183DeploymentPinSchema,
  erc8183JobKeySchema,
  erc8183JobTermsSchema,
  erc8183QuoteSchema,
  nonZeroAddressSchema,
  type EnabledErc8183DeploymentPin,
  type Erc8183DeploymentPin,
  type Erc8183JobKey,
  type Erc8183JobTerms,
  type Erc8183Quote
} from "./types.js";

const FORBIDDEN_FIELD = /(?:private.?key|seed|mnemonic|password|secret|credential|session.?token|access.?token|raw.?signature|wallet.?key)/i;

export function parseAtomic(value: string, label = "atomic amount"): bigint {
  if (!decimalUintSchema.safeParse(value).success) {
    throw new CommerceError({ code: "INVALID_AMOUNT", message: `${label} must be a non-negative decimal integer.` });
  }
  try {
    const parsed = BigInt(value);
    if (parsed > (1n << 256n) - 1n) throw new Error("overflow");
    return parsed;
  } catch (cause) {
    throw new CommerceError({ code: "INVALID_AMOUNT", message: `${label} is outside the uint256 range.`, cause });
  }
}

export function normalizeAddress(value: string, label = "address"): `0x${string}` {
  try {
    const normalized = normalizeEvmAddress(value);
    if (/^0x0{40}$/i.test(normalized)) {
      throw new Error("zero address");
    }
    return normalized as `0x${string}`;
  } catch (cause) {
    throw new CommerceError({ code: "INVALID_ADDRESS", message: `${label} must be a non-zero EVM address.`, cause });
  }
}

export function normalizeJobKey(input: unknown): Erc8183JobKey {
  const parsed = erc8183JobKeySchema.safeParse(input);
  if (!parsed.success) {
    throw new CommerceError({ code: "INVALID_JOB", message: "The ERC-8183 job identity is invalid.", cause: parsed.error });
  }
  return {
    chainId: parsed.data.chainId,
    commerceContract: normalizeAddress(parsed.data.commerceContract, "commerce contract"),
    jobId: parsed.data.jobId
  };
}

export function assertPublicPayloadSafe(value: unknown, path = "payload"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPublicPayloadSafe(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIELD.test(key)) {
      throw new CommerceError({ code: "INVALID_JOB", message: `Sensitive field rejected at ${path}.${key}.` });
    }
    assertPublicPayloadSafe(child, `${path}.${key}`);
  }
}

export function parseEnabledDeploymentPin(input: unknown): EnabledErc8183DeploymentPin {
  const parsed = erc8183DeploymentPinSchema.safeParse(input);
  if (!parsed.success) {
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: "ERC-8183 deployment configuration is not valid.", cause: parsed.error });
  }
  if (!parsed.data.enabled) {
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: `ERC-8183 is disabled: ${parsed.data.disabledReason}.`, nextAction: "verify_standards_lock" });
  }
  return parsed.data;
}

export function assertPinMatchesJob(
  terms: Erc8183JobTerms,
  pin: EnabledErc8183DeploymentPin
): void {
  if (terms.chainId !== pin.chainId) {
    throw new CommerceError({ code: "INVALID_CHAIN", message: "Job chain does not match the pinned ERC-8183 network." });
  }
  if (normalizeAddress(terms.commerceContract, "commerce contract") !== normalizeAddress(pin.commerceContract, "commerce contract")) {
    throw new CommerceError({ code: "INVALID_CONTRACT", message: "Job commerce contract does not match the pinned deployment." });
  }
  if (normalizeAddress(terms.paymentToken, "payment token") !== normalizeAddress(pin.paymentToken, "payment token")) {
    throw new CommerceError({ code: "INVALID_TOKEN", message: "Job payment token does not match the pinned deployment." });
  }
  if (terms.paymentDecimals !== pin.paymentDecimals) {
    throw new CommerceError({ code: "INVALID_TOKEN", message: "Payment-token decimals do not match the pinned deployment." });
  }
}

export function assertBudgetMatchesPin(
  budgetAtomic: string,
  pin: EnabledErc8183DeploymentPin
): void {
  parseAtomic(budgetAtomic, "Job budget");
  const budget = BigInt(budgetAtomic);
  if (budget < BigInt(pin.minBudgetAtomic) || budget > BigInt(pin.maxBudgetAtomic)) {
    throw new CommerceError({ code: "INVALID_AMOUNT", message: "Job budget is outside the pinned min/max range." });
  }
}

export function validateJobTerms(
  input: unknown,
  pin: Erc8183DeploymentPin,
  nowUnix: number
): Erc8183JobTerms {
  const terms = erc8183JobTermsSchema.safeParse(input);
  if (!terms.success) {
    throw new CommerceError({ code: "INVALID_JOB", message: "ERC-8183 job terms are invalid.", cause: terms.error });
  }
  const enabled = parseEnabledDeploymentPin(pin);
  assertPinMatchesJob(terms.data, enabled);
  assertBudgetMatchesPin(terms.data.budgetAtomic, enabled);
  if (!Number.isSafeInteger(nowUnix) || nowUnix <= 0 || terms.data.expiresAtUnix <= nowUnix + enabled.minExpiryLeadSeconds) {
    throw new CommerceError({ code: "INVALID_EXPIRY", message: "Job expiry must leave the configured execution lead time." });
  }
  if (terms.data.expiresAtUnix > nowUnix + enabled.maxExpiryHorizonSeconds) {
    throw new CommerceError({ code: "INVALID_EXPIRY", message: "Job expiry exceeds the pinned maximum horizon." });
  }
  return {
    ...terms.data,
    commerceContract: normalizeAddress(terms.data.commerceContract, "commerce contract"),
    paymentToken: normalizeAddress(terms.data.paymentToken, "payment token"),
    clientAddress: normalizeAddress(terms.data.clientAddress, "client address"),
    providerAddress: terms.data.providerAddress === null ? null : normalizeAddress(terms.data.providerAddress, "provider address"),
    evaluatorAddress: normalizeAddress(terms.data.evaluatorAddress, "evaluator address"),
    hookAddress: terms.data.hookAddress === null ? null : normalizeAddress(terms.data.hookAddress, "hook address")
  };
}

export function validateQuote(
  input: unknown,
  pin: Erc8183DeploymentPin,
  nowUnix: number
): Erc8183Quote {
  const quote = erc8183QuoteSchema.safeParse(input);
  if (!quote.success) {
    throw new CommerceError({ code: "INVALID_QUOTE", message: "The ERC-8183 quote is invalid.", cause: quote.error });
  }
  const enabled = parseEnabledDeploymentPin(pin);
  if (quote.data.jobKey.chainId !== quote.data.chainId || normalizeAddress(quote.data.jobKey.commerceContract, "job commerce contract") !== normalizeAddress(quote.data.commerceContract, "commerce contract")) {
    throw new CommerceError({ code: "INVALID_QUOTE", message: "Quote job identity does not match its network and commerce contract." });
  }
  if (quote.data.chainId !== enabled.chainId || normalizeAddress(quote.data.commerceContract, "commerce contract") !== normalizeAddress(enabled.commerceContract, "commerce contract")) {
    throw new CommerceError({ code: "INVALID_CHAIN", message: "Quote network or commerce contract does not match the pinned deployment." });
  }
  if (normalizeAddress(quote.data.paymentToken, "payment token") !== normalizeAddress(enabled.paymentToken, "payment token") || quote.data.paymentDecimals !== enabled.paymentDecimals) {
    throw new CommerceError({ code: "INVALID_TOKEN", message: "Quote payment asset does not match the pinned deployment." });
  }
  const min = parseAtomic(quote.data.minPriceAtomic, "Minimum quote price");
  const max = parseAtomic(quote.data.maxPriceAtomic, "Maximum quote price");
  const price = parseAtomic(quote.data.priceAtomic, "Quote price");
  if (min < BigInt(enabled.minBudgetAtomic) || max > BigInt(enabled.maxBudgetAtomic) || price < min || price > max) {
    throw new CommerceError({ code: "INVALID_AMOUNT", message: "Quote price is outside the pinned range." });
  }
  if (!Number.isSafeInteger(nowUnix) || nowUnix <= 0 || quote.data.expiresAtUnix <= nowUnix) {
    throw new CommerceError({ code: "INVALID_EXPIRY", message: "Quote has expired." });
  }
  if (quote.data.expiresAtUnix > nowUnix + enabled.maxExpiryHorizonSeconds) {
    throw new CommerceError({ code: "INVALID_EXPIRY", message: "Quote expiry exceeds the pinned horizon." });
  }
  return {
    ...quote.data,
    jobKey: {
      ...quote.data.jobKey,
      commerceContract: normalizeAddress(quote.data.jobKey.commerceContract, "job commerce contract")
    },
    commerceContract: normalizeAddress(quote.data.commerceContract, "commerce contract"),
    paymentToken: normalizeAddress(quote.data.paymentToken, "payment token"),
    providerAddress: normalizeAddress(quote.data.providerAddress, "provider address")
  };
}

export function quoteDigest(quote: Erc8183Quote): string {
  return canonicalSha256Hex(quote);
}

export function assertChainId(value: number): asserts value is 56 | 97 {
  if (value !== 56 && value !== 97) {
    throw new CommerceError({ code: "INVALID_CHAIN", message: "Only BSC chain 56 or 97 is supported." });
  }
}

export function assertAddress(value: string, label: string): void {
  const parsed = nonZeroAddressSchema.safeParse(value);
  if (!parsed.success) {
    throw new CommerceError({ code: "INVALID_ADDRESS", message: `${label} must be a non-zero EVM address.`, cause: parsed.error });
  }
}
