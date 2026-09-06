import { canonicalSha256Hex, erc8004IdentitySchema, type Erc8004Identity } from "@bnbera/domain";
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

export const healthFactorTaskInputSchema = z.object({
  account: nonZeroAddressSchema,
  chainId: bscChainIdSchema,
  protocol: z.string().trim().min(1).max(120),
  requestedAtUnix: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
}).strict();
export type HealthFactorTaskInput = z.infer<typeof healthFactorTaskInputSchema>;

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

export const healthFactorResultOutputSchema = z.object({
  fixture: z.literal(true),
  source: z.literal("bnbera.fixture.health-factor"),
  account: nonZeroAddressSchema,
  chainId: bscChainIdSchema,
  protocol: z.string().trim().min(1).max(120),
  observedAtUnix: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  healthFactor: z.number().finite().nonnegative(),
  unit: z.literal("ratio"),
  interpretation: z.enum(["safe", "watch", "critical"])
}).strict();
export type HealthFactorResultOutput = z.infer<typeof healthFactorResultOutputSchema>;

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
}): Erc8183ProviderTask {
  const parsedIdentity = erc8004IdentitySchema.parse(input.providerBinding.identity) as Erc8004Identity;
  const providerBinding = erc8183ProviderBindingSchema.parse({ ...input.providerBinding, identity: parsedIdentity });
  const taskInput = healthFactorTaskInputSchema.parse({ account: input.account, chainId: input.jobKey.chainId, protocol: input.protocol, requestedAtUnix: input.requestedAtUnix });
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
