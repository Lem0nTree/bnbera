import { canonicalSha256Hex, canonicalizeJson, erc8004IdentitySchema, type Erc8004Identity } from "@bnbera/domain";
import { z } from "zod";
import { CommerceError } from "./errors.js";
import { assertPublicPayloadSafe } from "./validation.js";
import {
  bscChainIdSchema,
  erc8183JobKeySchema,
  erc8183ProviderBindingSchema,
  nonZeroAddressSchema,
  type Erc8183JobKey,
  type Erc8183ProviderBinding
} from "./types.js";

/** A small useful provider boundary used by the hire API and tests. */
export const erc8183ProviderTaskKinds = ["health_factor_monitor"] as const;
export const erc8183ProviderTaskKindSchema = z.enum(erc8183ProviderTaskKinds);
export type Erc8183ProviderTaskKind = z.infer<typeof erc8183ProviderTaskKindSchema>;

const publicReferenceStringSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), "The public reference contains control characters.");

/**
 * A caller-supplied lending snapshot. The reference provider does not invent
 * balances or query an unpinned protocol: it computes a ratio from this
 * explicitly timestamped, provenance-bearing input. Decimal strings avoid
 * silently changing the result through JavaScript floating-point rounding.
 */
export const healthFactorLendingSnapshotSchema = z.object({
  collateralValueUsd: z.string().trim().regex(/^(?:0|[1-9][0-9]{0,29})(?:\.[0-9]{1,18})?$/u),
  debtValueUsd: z.string().trim().regex(/^(?:0|[1-9][0-9]{0,29})(?:\.[0-9]{1,18})?$/u),
  liquidationThresholdBps: z.number().int().min(1).max(10_000),
  sourceKind: z.enum(["protocol_snapshot", "caller_attested"]),
  sourceReference: publicReferenceStringSchema,
  observedAtUnix: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  observedBlock: z.string().regex(/^(?:0|[1-9][0-9]*)$/u).optional(),
  observedBlockHash: z.string().regex(/^0x[0-9a-f]{64}$/iu).optional()
}).strict().superRefine((value, ctx) => {
  if (/^0(?:\.0+)?$/u.test(value.debtValueUsd)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["debtValueUsd"], message: "A health factor requires a positive debt value." });
  }
  if (value.sourceKind === "protocol_snapshot" && !/^https:\/\//iu.test(value.sourceReference) && !/^0x[0-9a-f]{64}$/iu.test(value.sourceReference)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceReference"], message: "A protocol snapshot requires an HTTPS source or transaction hash." });
  }
  if (value.observedBlockHash !== undefined && value.observedBlock === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["observedBlockHash"], message: "An observed block hash requires an observed block number." });
  }
});
export type HealthFactorLendingSnapshot = z.infer<typeof healthFactorLendingSnapshotSchema>;

export const healthFactorTaskInputSchema = z.object({
  account: nonZeroAddressSchema,
  chainId: bscChainIdSchema,
  protocol: z.string().trim().min(1).max(120),
  requestedAtUnix: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  lendingSnapshot: healthFactorLendingSnapshotSchema.optional()
}).strict();
export type HealthFactorTaskInput = z.infer<typeof healthFactorTaskInputSchema>;

/** Structured input accepted by the BNBEra-operated reference provider. */
export const healthFactorReferenceTaskInputSchema = healthFactorTaskInputSchema.superRefine((value, ctx) => {
  if (value.lendingSnapshot === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lendingSnapshot"], message: "The reference provider requires a provenance-bearing lending snapshot." });
  }
});
export type HealthFactorReferenceTaskInput = z.infer<typeof healthFactorReferenceTaskInputSchema> & {
  readonly lendingSnapshot: HealthFactorLendingSnapshot;
};

export const erc8183ProviderTaskSchema = z.object({
  schemaVersion: z.literal("bnbera.erc8183.task/v1"),
  kind: erc8183ProviderTaskKindSchema,
  jobKey: erc8183JobKeySchema,
  providerBinding: erc8183ProviderBindingSchema,
  input: healthFactorTaskInputSchema,
  inputDigest: z.string().regex(/^[0-9a-f]{64}$/iu)
}).strict().superRefine((value, ctx) => {
  if (value.input.chainId !== value.jobKey.chainId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["input", "chainId"], message: "Task input chain must match the job key." });
  if (value.providerBinding.identity.chainId !== value.jobKey.chainId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["providerBinding", "identity", "chainId"], message: "Provider identity chain must match the job key." });
  if (canonicalSha256Hex(value.input) !== value.inputDigest.toLowerCase()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inputDigest"], message: "Task input digest does not match the input." });
});
export type Erc8183ProviderTask = z.infer<typeof erc8183ProviderTaskSchema>;

const healthFactorResultBaseSchema = z.object({
  source: z.literal("bnbera.fixture.health-factor"),
  account: nonZeroAddressSchema,
  chainId: bscChainIdSchema,
  protocol: z.string().trim().min(1).max(120),
  observedAtUnix: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  healthFactor: z.number().finite().nonnegative(),
  unit: z.literal("ratio"),
  interpretation: z.enum(["safe", "watch", "critical"])
});

const fixtureHealthFactorResultOutputSchema = healthFactorResultBaseSchema.extend({
  fixture: z.literal(true),
  source: z.literal("bnbera.fixture.health-factor")
}).strict();

const referenceHealthFactorResultOutputSchema = healthFactorResultBaseSchema.extend({
  fixture: z.literal(false),
  source: z.literal("bnbera.reference.health-factor"),
  collateralValueUsd: z.string().regex(/^(?:0|[1-9][0-9]{0,29})(?:\.[0-9]{1,18})?$/u),
  debtValueUsd: z.string().regex(/^(?:0|[1-9][0-9]{0,29})(?:\.[0-9]{1,18})?$/u),
  liquidationThresholdBps: z.number().int().min(1).max(10_000),
  /** Exact ratio rounded down to 18 decimal places for reproducible display. */
  healthFactorExact: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/u),
  provenance: z.object({
    sourceKind: z.enum(["protocol_snapshot", "caller_attested"]),
    sourceReference: publicReferenceStringSchema,
    observedAtUnix: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    observedBlock: z.string().regex(/^(?:0|[1-9][0-9]*)$/u).optional(),
    observedBlockHash: z.string().regex(/^0x[0-9a-f]{64}$/iu).optional()
  }).strict()
}).strict();

export const healthFactorResultOutputSchema = z.union([
  fixtureHealthFactorResultOutputSchema,
  referenceHealthFactorResultOutputSchema
]);
export type HealthFactorResultOutput = z.infer<typeof healthFactorResultOutputSchema>;

/** Stable bytes served by the provider and copied into the ERC-8183 manifest. */
export function canonicalHealthFactorResultBytes(result: HealthFactorResultOutput): string {
  return canonicalizeJson(healthFactorResultOutputSchema.parse(result));
}

export const erc8183ProviderResultSchema = z.object({
  schemaVersion: z.literal("bnbera.erc8183.result/v1"),
  kind: erc8183ProviderTaskKindSchema,
  jobKey: erc8183JobKeySchema,
  providerBinding: erc8183ProviderBindingSchema,
  taskInputDigest: z.string().regex(/^[0-9a-f]{64}$/iu),
  result: healthFactorResultOutputSchema,
  /** BNBEra's local result identity (SHA-256), separate from APEX's hash. */
  resultDigest: z.string().regex(/^[0-9a-f]{64}$/iu),
  /** APEX/ERC-8183 deliverable hash (Keccak-256 of exact manifest bytes). */
  chainDeliverable: z.string().regex(/^0x[0-9a-f]{64}$/iu).nullable(),
  deliverableUrl: z.string().url().nullable(),
  producedAtUnix: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
}).strict().superRefine((value, ctx) => {
  if (value.providerBinding.identity.chainId !== value.jobKey.chainId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["providerBinding", "identity", "chainId"], message: "Provider identity chain must match the job key." });
  if (value.result.chainId !== value.jobKey.chainId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["result", "chainId"], message: "Result chain must match the job key." });
  if (canonicalSha256Hex(value.result) !== value.resultDigest.toLowerCase()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["resultDigest"], message: "Result digest does not match the result payload." });
});
export type Erc8183ProviderResult = z.infer<typeof erc8183ProviderResultSchema>;

export function providerTaskDigest(input: HealthFactorTaskInput): string {
  return canonicalSha256Hex(healthFactorTaskInputSchema.parse(input));
}

export function providerResultDigest(result: HealthFactorResultOutput): string {
  return canonicalSha256Hex(healthFactorResultOutputSchema.parse(result));
}

export function createHealthFactorTask(input: {
  readonly jobKey: Erc8183JobKey;
  readonly providerBinding: Erc8183ProviderBinding;
  readonly account: string;
  readonly protocol: string;
  readonly requestedAtUnix: number;
  readonly lendingSnapshot?: HealthFactorLendingSnapshot;
}): Erc8183ProviderTask {
  const parsedIdentity = erc8004IdentitySchema.parse(input.providerBinding.identity) as Erc8004Identity;
  const providerBinding = erc8183ProviderBindingSchema.parse({ ...input.providerBinding, identity: parsedIdentity });
  const taskInput = healthFactorTaskInputSchema.parse({
    account: input.account,
    chainId: input.jobKey.chainId,
    protocol: input.protocol,
    requestedAtUnix: input.requestedAtUnix,
    ...(input.lendingSnapshot === undefined ? {} : { lendingSnapshot: input.lendingSnapshot })
  });
  assertPublicPayloadSafe(taskInput, "task.input");
  return erc8183ProviderTaskSchema.parse({
    schemaVersion: "bnbera.erc8183.task/v1",
    kind: "health_factor_monitor",
    jobKey: input.jobKey,
    providerBinding,
    input: taskInput,
    inputDigest: providerTaskDigest(taskInput)
  });
}

export function createReferenceHealthFactorTask(input: {
  readonly jobKey: Erc8183JobKey;
  readonly providerBinding: Erc8183ProviderBinding;
  readonly account: string;
  readonly protocol: string;
  readonly requestedAtUnix: number;
  readonly lendingSnapshot: HealthFactorLendingSnapshot;
}): Erc8183ProviderTask {
  const snapshot = healthFactorLendingSnapshotSchema.parse(input.lendingSnapshot);
  return erc8183ProviderTaskSchema.parse(createHealthFactorTask({ ...input, lendingSnapshot: snapshot }));
}

const DECIMAL_SCALE = 18n;
const DECIMAL_SCALE_FACTOR = 10n ** DECIMAL_SCALE;

function decimalToScaled(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * DECIMAL_SCALE_FACTOR + BigInt((fraction + "0".repeat(Number(DECIMAL_SCALE))).slice(0, Number(DECIMAL_SCALE)));
}

function scaledToDecimal(value: bigint): string {
  const whole = value / DECIMAL_SCALE_FACTOR;
  const fraction = (value % DECIMAL_SCALE_FACTOR).toString(10).padStart(Number(DECIMAL_SCALE), "0").replace(/0+$/u, "");
  return fraction.length === 0 ? whole.toString(10) : `${whole.toString(10)}.${fraction}`;
}

function healthFactorInterpretation(healthFactor: number): "safe" | "watch" | "critical" {
  return healthFactor < 1.1 ? "critical" : healthFactor < 1.5 ? "watch" : "safe";
}

export type ReferenceHealthFactorCalculation = {
  readonly healthFactor: number;
  readonly healthFactorExact: string;
  readonly interpretation: "safe" | "watch" | "critical";
};

/** Compute a health factor without floating-point input or implicit protocol assumptions. */
export function calculateReferenceHealthFactor(input: HealthFactorLendingSnapshot): ReferenceHealthFactorCalculation {
  const snapshot = healthFactorLendingSnapshotSchema.parse(input);
  const collateral = decimalToScaled(snapshot.collateralValueUsd);
  const debt = decimalToScaled(snapshot.debtValueUsd);
  // HF = collateral * liquidation threshold / debt. The bps denominator is
  // applied before converting back to the canonical 18-decimal ratio.
  const numerator = collateral * BigInt(snapshot.liquidationThresholdBps) * DECIMAL_SCALE_FACTOR;
  const denominator = debt * 10_000n;
  const exactScaled = numerator / denominator;
  const healthFactorExact = scaledToDecimal(exactScaled);
  const healthFactor = Number(healthFactorExact);
  if (!Number.isFinite(healthFactor)) throw new CommerceError({ code: "INVALID_JOB", message: "The lending snapshot produces an unrepresentable health factor." });
  return { healthFactor, healthFactorExact, interpretation: healthFactorInterpretation(healthFactor) };
}

export function createReferenceHealthFactorResult(input: {
  readonly task: Erc8183ProviderTask;
  readonly observedAtUnix?: number;
  readonly deliverableUrl?: string | null;
  readonly chainDeliverable?: `0x${string}` | null;
}): Erc8183ProviderResult {
  const task = erc8183ProviderTaskSchema.parse(input.task);
  const referenceInput = healthFactorReferenceTaskInputSchema.parse(task.input);
  const snapshot = referenceInput.lendingSnapshot;
  // The refinement above proves this branch to callers, while the explicit
  // guard keeps the invariant obvious to TypeScript and future maintainers.
  if (snapshot === undefined) throw new CommerceError({ code: "INVALID_JOB", message: "The reference provider task has no lending snapshot." });
  const calculation = calculateReferenceHealthFactor(snapshot);
  const observedAtUnix = input.observedAtUnix ?? snapshot.observedAtUnix;
  if (!Number.isSafeInteger(observedAtUnix) || observedAtUnix < snapshot.observedAtUnix) {
    throw new CommerceError({ code: "INVALID_JOB", message: "The reference result timestamp cannot precede its source snapshot." });
  }
  const result = referenceHealthFactorResultOutputSchema.parse({
    fixture: false,
    source: "bnbera.reference.health-factor",
    account: task.input.account,
    chainId: task.input.chainId,
    protocol: task.input.protocol,
    observedAtUnix,
    healthFactor: calculation.healthFactor,
    unit: "ratio",
    interpretation: calculation.interpretation,
    collateralValueUsd: snapshot.collateralValueUsd,
    debtValueUsd: snapshot.debtValueUsd,
    liquidationThresholdBps: snapshot.liquidationThresholdBps,
    healthFactorExact: calculation.healthFactorExact,
    provenance: {
      sourceKind: snapshot.sourceKind,
      sourceReference: snapshot.sourceReference,
      observedAtUnix: snapshot.observedAtUnix,
      ...(snapshot.observedBlock === undefined ? {} : { observedBlock: snapshot.observedBlock }),
      ...(snapshot.observedBlockHash === undefined ? {} : { observedBlockHash: snapshot.observedBlockHash })
    }
  });
  assertPublicPayloadSafe(result, "reference.result");
  return erc8183ProviderResultSchema.parse({
    schemaVersion: "bnbera.erc8183.result/v1",
    kind: task.kind,
    jobKey: task.jobKey,
    providerBinding: task.providerBinding,
    taskInputDigest: task.inputDigest,
    result,
    resultDigest: providerResultDigest(result),
    chainDeliverable: input.chainDeliverable ?? null,
    deliverableUrl: input.deliverableUrl ?? null,
    producedAtUnix: observedAtUnix
  });
}

export function createHealthFactorResult(input: {
  readonly task: Erc8183ProviderTask;
  readonly observedAtUnix: number;
  readonly healthFactor: number;
  readonly interpretation?: "safe" | "watch" | "critical";
  readonly deliverableUrl?: string | null;
  readonly chainDeliverable?: `0x${string}` | null;
}): Erc8183ProviderResult {
  const task = erc8183ProviderTaskSchema.parse(input.task);
  const interpretation = input.interpretation ?? (input.healthFactor < 1.1 ? "critical" : input.healthFactor < 1.5 ? "watch" : "safe");
  const result = healthFactorResultOutputSchema.parse({
    fixture: true,
    source: "bnbera.fixture.health-factor",
    account: task.input.account,
    chainId: task.input.chainId,
    protocol: task.input.protocol,
    observedAtUnix: input.observedAtUnix,
    healthFactor: input.healthFactor,
    unit: "ratio",
    interpretation
  });
  assertPublicPayloadSafe(result, "result");
  return erc8183ProviderResultSchema.parse({
    schemaVersion: "bnbera.erc8183.result/v1",
    kind: task.kind,
    jobKey: task.jobKey,
    providerBinding: task.providerBinding,
    taskInputDigest: task.inputDigest,
    result,
    resultDigest: providerResultDigest(result),
    chainDeliverable: input.chainDeliverable ?? null,
    deliverableUrl: input.deliverableUrl ?? null,
    producedAtUnix: input.observedAtUnix
  });
}

/** Deterministic fixture; explicitly marked fixture so it cannot be shown as live data. */
export function healthFactorFixture(input: {
  readonly jobKey: Erc8183JobKey;
  readonly providerBinding: Erc8183ProviderBinding;
  readonly account: string;
  readonly protocol?: string;
  readonly nowUnix: number;
  readonly healthFactor?: number;
}): { readonly task: Erc8183ProviderTask; readonly result: Erc8183ProviderResult } {
  const task = createHealthFactorTask({
    jobKey: input.jobKey,
    providerBinding: input.providerBinding,
    account: input.account,
    protocol: input.protocol ?? "venus",
    requestedAtUnix: input.nowUnix
  });
  return { task, result: createHealthFactorResult({ task, observedAtUnix: input.nowUnix, healthFactor: input.healthFactor ?? 1.72 }) };
}

export function assertProviderResultMatchesTask(task: Erc8183ProviderTask, result: Erc8183ProviderResult): void {
  const parsedTask = erc8183ProviderTaskSchema.parse(task);
  const parsedResult = erc8183ProviderResultSchema.parse(result);
  if (
    parsedResult.taskInputDigest !== parsedTask.inputDigest ||
    parsedResult.jobKey.jobId !== parsedTask.jobKey.jobId ||
    parsedResult.providerBinding.agentVersionId !== parsedTask.providerBinding.agentVersionId ||
    parsedResult.result.account.toLowerCase() !== parsedTask.input.account.toLowerCase() ||
    parsedResult.result.protocol !== parsedTask.input.protocol ||
    parsedResult.result.chainId !== parsedTask.input.chainId
  ) {
    throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "Provider result is not bound to the requested task identity." });
  }
}
