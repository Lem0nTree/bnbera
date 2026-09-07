import { Buffer } from "node:buffer";
import {
  encodeErc8183Manifest,
  erc8183ManifestHash,
  type Erc8183DeliverableManifest
} from "@altananetwork/sdk";
import {
  canonicalSha256Hex,
  canonicalizeJson,
  erc8004IdentitySchema,
  sameErc8004Identity,
  type Erc8004Identity
} from "@bnbera/domain";
import { z } from "zod";
import { CommerceError } from "./errors.js";
import type { Erc8183AltanaAuthority } from "./chain.js";
import type { Erc8183CommerceService } from "./service.js";
import type { Erc8183OperationRecord } from "./operations.js";
import {
  canonicalHealthFactorResultBytes,
  createReferenceHealthFactorResult,
  createReferenceHealthFactorTask,
  healthFactorLendingSnapshotSchema,
  healthFactorResultOutputSchema,
  type Erc8183ProviderResult,
  type HealthFactorResultOutput,
  type HealthFactorLendingSnapshot
} from "./provider.js";
import {
  erc8183JobRecordSchema,
  erc8183JobKeySchema,
  erc8183ProviderBindingSchema,
  nonZeroAddressSchema,
  positiveDecimalUintSchema,
  type Erc8183JobKey,
  type Erc8183JobRecord,
  type Erc8183ProviderBinding
} from "./types.js";
import { assertPinMatchesJob, normalizeAddress } from "./validation.js";

/** A reference provider is never allowed to spend more than the reviewed T4 cap. */
export const REFERENCE_PROVIDER_MAX_BUDGET_ATOMIC = "10000000000000000";
export const REFERENCE_PROVIDER_IDEMPOTENCY_PREFIX = "t5-reference-provider-submit";
export const REFERENCE_PROVIDER_MAX_RESPONSE_BYTES = 64 * 1024;

const publicHttpUrlSchema = z.string().trim().url().superRefine((value, ctx) => {
  try {
    const parsed = new URL(value);
    if (parsed.username !== "" || parsed.password !== "" || parsed.hash !== "" || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The provider endpoint must be a credential-free HTTP(S) URL." });
    }
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The provider endpoint must be a valid URL." });
  }
});

/** Readiness is tied to the publicly published A2A card, which must be HTTPS. */
const publicHttpsUrlSchema = publicHttpUrlSchema.superRefine((value, ctx) => {
  try {
    if (new URL(value).protocol !== "https:") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The provider card URL must be a credential-free HTTPS URL." });
    }
  } catch {
    // `publicHttpUrlSchema` reports malformed URLs and credential-bearing URLs.
  }
});

/** Secret-manager references only; the resolved signer never enters this package's public data. */
export const referenceProviderSecretReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^(?:(?:secret|vault|env):\/\/[^\s]+|arn:aws:secretsmanager:[^\s]+)$/u, "The provider authority must be a secret reference.");
export type ReferenceProviderSecretReference = z.infer<typeof referenceProviderSecretReferenceSchema>;

/**
 * The idempotency identity is server-derived from the protocol job. A caller
 * cannot select a second key to obtain a second provider submission.
 */
export function referenceProviderIdempotencyKey(jobKey: Erc8183JobKey): string {
  const parsed = erc8183JobKeySchema.parse(jobKey);
  return `${REFERENCE_PROVIDER_IDEMPOTENCY_PREFIX}:${parsed.chainId}:${parsed.commerceContract.toLowerCase()}:${parsed.jobId}`;
}

const referenceProviderConfigBaseSchema = z.object({
  /** Defaults off. Enabling requires every local testnet guard below. */
  enabled: z.boolean().default(false),
  runtimeEnvironment: z.enum(["development", "test", "production"]).default("production"),
  developmentCanaryEnabled: z.boolean().default(false),
  /** Release remains disabled for this bounded reference worker. */
  releaseEnabled: z.literal(false).default(false),
  chainId: z.literal(97).default(97),
  identity: erc8004IdentitySchema.optional(),
  /** The commerce contract pin is needed before a protocol job exists. */
  commerceContract: nonZeroAddressSchema.optional(),
  /** The ERC-721 owner is independent from the provider execution wallet. */
  expectedOwnerAddress: nonZeroAddressSchema.optional(),
  providerAddress: nonZeroAddressSchema.optional(),
  providerEndpoint: publicHttpUrlSchema.optional(),
  authoritySecretReference: referenceProviderSecretReferenceSchema.optional(),
  routerContract: nonZeroAddressSchema.optional(),
  policyContract: nonZeroAddressSchema.optional(),
  maxBudgetAtomic: positiveDecimalUintSchema.default(REFERENCE_PROVIDER_MAX_BUDGET_ATOMIC)
}).strict();

type ReferenceProviderConfigBase = z.infer<typeof referenceProviderConfigBaseSchema>;

function refineReferenceProviderConfig(value: ReferenceProviderConfigBase, ctx: z.RefinementCtx, requireCommerceContract: boolean): void {
  if (BigInt(value.maxBudgetAtomic) > BigInt(REFERENCE_PROVIDER_MAX_BUDGET_ATOMIC)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxBudgetAtomic"], message: "The reference provider cap cannot exceed 0.01 U." });
  }
  if (!value.enabled) return;
  if (value.runtimeEnvironment === "production" || !value.developmentCanaryEnabled) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["developmentCanaryEnabled"], message: "The reference provider is local-development-only and requires the explicit testnet canary flag." });
  }
  if (value.identity === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["identity"], message: "An enabled reference provider requires one configured ERC-8004 identity." });
  if (requireCommerceContract && value.commerceContract === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["commerceContract"], message: "An enabled reference provider requires the standards-locked commerce contract." });
  if (value.expectedOwnerAddress === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expectedOwnerAddress"], message: "An enabled reference provider requires the expected ERC-8004 owner address." });
  if (value.providerAddress === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["providerAddress"], message: "An enabled reference provider requires one configured provider wallet." });
  if (value.providerEndpoint === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["providerEndpoint"], message: "An enabled reference provider requires its configured public endpoint." });
  if (value.authoritySecretReference === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["authoritySecretReference"], message: "An enabled reference provider requires a secret reference for its signing authority." });
  if (value.routerContract === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["routerContract"], message: "An enabled reference provider requires the existing router contract seam." });
  if (value.policyContract === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["policyContract"], message: "An enabled reference provider requires the existing policy contract seam." });
  if (value.identity !== undefined && value.identity.chainId !== 97) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["identity", "chainId"], message: "The reference identity must be on BSC testnet." });
}

/**
 * Job-independent public configuration used while composing commerce
 * readiness. A quote may be the operation that creates the protocol job, so
 * this parser deliberately has no job ID or task input. It still requires the
 * same identity, owner, provider, public-card endpoint, secret-reference,
 * deployment and bounded-budget fields as the worker configuration.
 */
export const referenceProviderReadinessConfigSchema = referenceProviderConfigBaseSchema
  .extend({ providerEndpoint: publicHttpsUrlSchema.optional() })
  .superRefine((value, ctx) => refineReferenceProviderConfig(value, ctx, true));
export type ReferenceProviderReadinessConfig = z.infer<typeof referenceProviderReadinessConfigSchema>;

/**
 * The worker configuration remains job-bound. Do not replace this with the
 * readiness schema: a provider submit must select one confirmed persisted
 * ERC-8183 job before it can invoke the endpoint or authority.
 */
export const referenceProviderRunnerConfigSchema = referenceProviderConfigBaseSchema.extend({
  jobKey: erc8183JobKeySchema.optional()
}).strict().superRefine((value, ctx) => {
  refineReferenceProviderConfig(value, ctx, false);
  if (value.enabled && value.jobKey === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["jobKey"], message: "An enabled reference provider requires one configured ERC-8183 job." });
  if (value.jobKey !== undefined && value.jobKey.chainId !== 97) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["jobKey", "chainId"], message: "The reference job must be on BSC testnet." });
  if (value.commerceContract !== undefined && value.jobKey !== undefined && value.commerceContract.toLowerCase() !== value.jobKey.commerceContract.toLowerCase()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["commerceContract"], message: "The reference commerce contract must match the configured ERC-8183 job." });
});
export type ReferenceProviderRunnerConfig = z.infer<typeof referenceProviderRunnerConfigSchema>;

function requiredReferenceProviderEnvironment(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value === "") throw new CommerceError({ code: "COMMERCE_DISABLED", message: `The enabled reference provider is missing ${name}.`, nextAction: "configure_reference_provider" });
  return value;
}

function requiredReferenceProviderEnvironmentAny(env: Readonly<Record<string, string | undefined>>, names: readonly string[]): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value !== undefined && value !== "") return value;
  }
  const first = names[0] ?? "the expected owner address";
  throw new CommerceError({ code: "COMMERCE_DISABLED", message: `The enabled reference provider is missing ${first}.`, nextAction: "configure_reference_provider" });
}

function referenceProviderEnvironmentFields(
  env: Readonly<Record<string, string | undefined>>,
  endpointEnvironmentName: "T5_REFERENCE_PROVIDER_SERVICE_URL" | "T5_REFERENCE_PROVIDER_CARD_URL"
): ReferenceProviderConfigBase {
  const chainIdText = env.T5_REFERENCE_PROVIDER_CHAIN_ID?.trim() || "97";
  // The schema below performs the runtime validation; this assertion keeps
  // the shared config projection aligned with its testnet-only literal type.
  const chainId = Number(chainIdText) as 97;
  const identityRegistry = requiredReferenceProviderEnvironment(env, "T5_REFERENCE_PROVIDER_IDENTITY_REGISTRY");
  const agentId = requiredReferenceProviderEnvironment(env, "T5_REFERENCE_PROVIDER_AGENT_ID");
  const commerceContract = requiredReferenceProviderEnvironment(env, "T5_REFERENCE_PROVIDER_COMMERCE_CONTRACT");
  const expectedOwnerAddress = requiredReferenceProviderEnvironmentAny(env, [
    "T5_REFERENCE_PROVIDER_EXPECTED_OWNER_ADDRESS",
    "T5_REFERENCE_PROVIDER_OWNER_ADDRESS",
    // The registration harness already uses WALLET_ADDRESS for the owner.
    "WALLET_ADDRESS"
  ]);
  const providerAddress = requiredReferenceProviderEnvironment(env, "T5_REFERENCE_PROVIDER_ADDRESS");
  const providerEndpoint = requiredReferenceProviderEnvironment(env, endpointEnvironmentName);
  const routerContract = requiredReferenceProviderEnvironment(env, "T5_REFERENCE_PROVIDER_ROUTER_CONTRACT");
  const policyContract = requiredReferenceProviderEnvironment(env, "T5_REFERENCE_PROVIDER_POLICY_CONTRACT");
  const authoritySecretReference = requiredReferenceProviderEnvironment(env, "T5_REFERENCE_PROVIDER_SECRET_REFERENCE");
  return {
    enabled: true,
    runtimeEnvironment: env.NODE_ENV === "test" ? "test" : env.NODE_ENV === "development" ? "development" : "production",
    developmentCanaryEnabled: env.T5_REFERENCE_PROVIDER_LOCAL_TESTNET === "true",
    releaseEnabled: false,
    chainId,
    identity: { namespace: "eip155", chainId, identityRegistry, agentId },
    commerceContract,
    expectedOwnerAddress,
    providerAddress,
    providerEndpoint,
    authoritySecretReference,
    routerContract,
    policyContract,
    maxBudgetAtomic: env.T5_REFERENCE_PROVIDER_MAX_BUDGET_ATOMIC ?? REFERENCE_PROVIDER_MAX_BUDGET_ATOMIC
  };
}

/**
 * Parse the public provider configuration needed before a quote creates a
 * protocol job. Raw private keys are deliberately not read, and an absent
 * enable flag stays disabled without requiring any other environment value.
 */
export function referenceProviderReadinessConfigFromEnvironment(env: Readonly<Record<string, string | undefined>>): ReferenceProviderReadinessConfig {
  if (env.T5_REFERENCE_PROVIDER_WORKER_ENABLED !== "true") return referenceProviderReadinessConfigSchema.parse({ enabled: false });
  // Readiness proves the canonical published A2A card, not the worker's
  // POST invocation endpoint. Keep these environment contracts separate.
  return referenceProviderReadinessConfigSchema.parse(referenceProviderEnvironmentFields(env, "T5_REFERENCE_PROVIDER_CARD_URL"));
}

/**
 * Parse only public worker configuration and secret references from the
 * existing environment boundary. Raw private keys are deliberately not read.
 * An absent enable flag produces a disabled config without requiring any other
 * environment value.
 */
export function referenceProviderRunnerConfigFromEnvironment(env: Readonly<Record<string, string | undefined>>): ReferenceProviderRunnerConfig {
  if (env.T5_REFERENCE_PROVIDER_WORKER_ENABLED !== "true") return referenceProviderRunnerConfigSchema.parse({ enabled: false });
  // The runner invokes the existing health-factor POST service URL.
  const fields = referenceProviderEnvironmentFields(env, "T5_REFERENCE_PROVIDER_SERVICE_URL");
  const jobId = requiredReferenceProviderEnvironment(env, "T5_REFERENCE_PROVIDER_JOB_ID");
  const { commerceContract, ...runnerFields } = fields;
  return referenceProviderRunnerConfigSchema.parse({
    ...runnerFields,
    jobKey: { chainId: fields.chainId, commerceContract, jobId }
  });
}

type EnabledReferenceProviderRunnerConfig = ReferenceProviderRunnerConfig & {
  readonly enabled: true;
  readonly identity: Erc8004Identity;
  readonly jobKey: Erc8183JobKey;
  readonly expectedOwnerAddress: string;
  readonly providerAddress: string;
  readonly providerEndpoint: string;
  readonly authoritySecretReference: ReferenceProviderSecretReference;
  readonly routerContract: string;
  readonly policyContract: string;
};

function enabledRunnerConfig(config: ReferenceProviderRunnerConfig): EnabledReferenceProviderRunnerConfig {
  const parsed = referenceProviderRunnerConfigSchema.parse(config);
  if (!parsed.enabled) throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The reference provider worker is disabled by default.", nextAction: "enable_local_testnet_worker" });
  if (parsed.identity === undefined || parsed.jobKey === undefined || parsed.expectedOwnerAddress === undefined || parsed.providerAddress === undefined || parsed.providerEndpoint === undefined || parsed.authoritySecretReference === undefined || parsed.routerContract === undefined || parsed.policyContract === undefined) {
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The enabled reference provider worker is incompletely configured.", nextAction: "configure_reference_provider" });
  }
  return parsed as EnabledReferenceProviderRunnerConfig;
}

export const referenceHealthFactorInvocationSchema = z.object({
  schemaVersion: z.literal("bnbera.reference.health-factor.request/v1"),
  jobKey: erc8183JobKeySchema,
  providerBinding: erc8183ProviderBindingSchema,
  account: nonZeroAddressSchema,
  protocol: z.string().trim().min(1).max(120),
  requestedAtUnix: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  lendingSnapshot: healthFactorLendingSnapshotSchema
}).strict().superRefine((value, ctx) => {
  if (value.lendingSnapshot.observedAtUnix > value.requestedAtUnix) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lendingSnapshot", "observedAtUnix"], message: "The source snapshot cannot be observed after the request." });
  }
  if (value.providerBinding.identity.chainId !== value.jobKey.chainId || value.lendingSnapshot.sourceKind === "protocol_snapshot" && value.jobKey.chainId !== 97) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["jobKey", "chainId"], message: "The reference provider only accepts a matching BSC task identity." });
  }
});
export type ReferenceHealthFactorInvocation = z.infer<typeof referenceHealthFactorInvocationSchema>;

export type ReferenceHealthFactorProviderResponse = {
  /** The exact UTF-8 bytes returned by the existing provider endpoint. */
  readonly resultBytes: string;
  readonly result: HealthFactorResultOutput;
  readonly resultDigest: string;
};

const referenceHealthFactorProviderResponseSchema = z.object({
  resultBytes: z.string().max(REFERENCE_PROVIDER_MAX_RESPONSE_BYTES),
  result: healthFactorResultOutputSchema,
  resultDigest: z.string().regex(/^[0-9a-f]{64}$/iu)
}).strict();

export interface ReferenceHealthFactorProviderClient {
  invoke(input: ReferenceHealthFactorInvocation): Promise<ReferenceHealthFactorProviderResponse>;
}

function assertCredentialFreeProviderEndpoint(endpoint: string): string {
  const parsed = publicHttpUrlSchema.safeParse(endpoint);
  if (!parsed.success) throw new CommerceError({ code: "INVALID_JOB", message: "The reference provider endpoint is not a credential-free HTTP(S) URL." });
  return parsed.data;
}

/**
 * Call the existing HTTP health-factor provider and retain its exact response
 * bytes. Non-canonical output, an absent/mismatched digest header, and an
 * oversized response are rejected before anything reaches the Altana seam.
 */
export function createReferenceHealthFactorProviderClient(input: {
  readonly endpoint: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly maxResponseBytes?: number;
}): ReferenceHealthFactorProviderClient {
  const endpoint = assertCredentialFreeProviderEndpoint(input.endpoint);
  const fetcher = input.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The reference provider has no HTTP client.", nextAction: "configure_reference_provider" });
  const maxResponseBytes = input.maxResponseBytes ?? REFERENCE_PROVIDER_MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > REFERENCE_PROVIDER_MAX_RESPONSE_BYTES) {
    throw new CommerceError({ code: "INVALID_JOB", message: "The reference provider response cap is invalid." });
  }

  return {
    async invoke(invocation): Promise<ReferenceHealthFactorProviderResponse> {
      const parsedInvocation = referenceHealthFactorInvocationSchema.parse(invocation);
      const body = canonicalizeJson(parsedInvocation);
      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body
        });
      } catch (cause) {
        throw new CommerceError({ code: "CHAIN_PROVIDER_INVALID", message: "The reference health-factor provider could not be reached.", retriable: true, nextAction: "retry_provider", cause });
      }
      if (!response.ok) throw new CommerceError({ code: "CHAIN_PROVIDER_INVALID", message: "The reference health-factor provider rejected the task.", retriable: true, nextAction: "retry_provider" });
      const contentLength = response.headers.get("content-length");
      if (contentLength !== null) {
        if (!/^[0-9]+$/u.test(contentLength)) throw new CommerceError({ code: "CHAIN_PROVIDER_INVALID", message: "The reference provider returned an invalid content length.", nextAction: "inspect_provider_result" });
        let declaredLength: bigint;
        try {
          declaredLength = BigInt(contentLength);
        } catch (cause) {
          throw new CommerceError({ code: "CHAIN_PROVIDER_INVALID", message: "The reference provider returned an invalid content length.", nextAction: "inspect_provider_result", cause });
        }
        if (declaredLength > BigInt(maxResponseBytes)) throw new CommerceError({ code: "INVALID_JOB", message: "The reference provider response exceeds the bounded result size." });
      }
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await response.arrayBuffer());
      } catch (cause) {
        throw new CommerceError({ code: "CHAIN_PROVIDER_INVALID", message: "The reference provider response could not be read.", retriable: true, nextAction: "retry_provider", cause });
      }
      if (bytes.byteLength > maxResponseBytes) throw new CommerceError({ code: "INVALID_JOB", message: "The reference provider response exceeds the bounded result size." });
      const resultBytes = Buffer.from(bytes).toString("utf8");
      let result: HealthFactorResultOutput;
      try {
        result = healthFactorResultOutputSchema.parse(JSON.parse(resultBytes) as unknown);
      } catch (cause) {
        throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The reference provider returned an invalid health-factor result.", nextAction: "inspect_provider_result", cause });
      }
      const canonicalBytes = canonicalHealthFactorResultBytes(result);
      if (resultBytes !== canonicalBytes) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The reference provider did not return canonical result bytes.", nextAction: "inspect_provider_result" });
      const resultDigest = canonicalSha256Hex(result);
      const digestHeader = response.headers.get("X-BNBEra-Result-SHA256");
      if (digestHeader === null || digestHeader.trim().toLowerCase() !== resultDigest) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The reference provider result digest header does not match its exact bytes.", nextAction: "inspect_provider_result" });
      return { resultBytes, result, resultDigest };
    }
  };
}

export type ReferenceProviderSubmission = {
  readonly task: ReturnType<typeof createReferenceHealthFactorTask>;
  readonly result: Erc8183ProviderResult;
  /** Exact canonical result bytes served by the endpoint and copied to the manifest. */
  readonly resultBytes: string;
  readonly manifest: Erc8183DeliverableManifest;
  readonly manifestText: string;
  readonly chainDeliverable: `0x${string}`;
  readonly deliverableUrl: string;
};

export type ReferenceProviderSubmissionInput = {
  readonly jobKey: Erc8183JobKey;
  readonly providerBinding: Erc8183ProviderBinding;
  readonly account: string;
  readonly protocol: string;
  readonly requestedAtUnix: number;
  readonly lendingSnapshot: HealthFactorLendingSnapshot;
  readonly routerContract: `0x${string}`;
  readonly policyContract: `0x${string}`;
  readonly producedAtUnix?: number;
  /** Exact output returned by the existing provider endpoint, when used by the worker. */
  readonly providerResult?: HealthFactorResultOutput;
  readonly providerResultBytes?: string;
  readonly providerResultDigest?: string;
};

function dataTextUrl(value: string): string {
  return `data:text/plain;base64,${Buffer.from(value, "utf8").toString("base64")}`;
}

function safeJobNumber(jobId: string): number {
  const number = Number(jobId);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new CommerceError({ code: "INVALID_JOB", message: "The reference provider job ID is not a safe protocol integer." });
  }
  return number;
}

/**
 * Build a complete, replayable result package without invoking a wallet. This
 * is the provider's deterministic boundary: the caller supplies a validated
 * snapshot, and every submitted byte is derived from the same parsed object.
 */
export function prepareReferenceProviderSubmission(input: ReferenceProviderSubmissionInput): ReferenceProviderSubmission {
  const parsed = referenceHealthFactorInvocationSchema.parse({
    schemaVersion: "bnbera.reference.health-factor.request/v1",
    jobKey: input.jobKey,
    providerBinding: input.providerBinding,
    account: input.account,
    protocol: input.protocol,
    requestedAtUnix: input.requestedAtUnix,
    lendingSnapshot: input.lendingSnapshot
  });
  const routerContract = nonZeroAddressSchema.parse(input.routerContract) as `0x${string}`;
  const policyContract = nonZeroAddressSchema.parse(input.policyContract) as `0x${string}`;
  const task = createReferenceHealthFactorTask({
    jobKey: parsed.jobKey,
    providerBinding: parsed.providerBinding,
    account: parsed.account,
    protocol: parsed.protocol,
    requestedAtUnix: parsed.requestedAtUnix,
    lendingSnapshot: parsed.lendingSnapshot
  });
  const producedAtUnix = input.producedAtUnix ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(producedAtUnix) || producedAtUnix < parsed.lendingSnapshot.observedAtUnix) {
    throw new CommerceError({ code: "INVALID_JOB", message: "The reference provider result timestamp is invalid." });
  }

  // The result envelope's chain fields are deliberately omitted while the
  // manifest is built. This makes the served result bytes independent of the
  // Keccak digest that commits the outer manifest, avoiding a circular hash.
  const provisional = createReferenceHealthFactorResult({ task, observedAtUnix: producedAtUnix });
  const resultBytes = canonicalHealthFactorResultBytes(provisional.result);
  if (input.providerResult !== undefined || input.providerResultBytes !== undefined || input.providerResultDigest !== undefined) {
    if (input.providerResult === undefined || input.providerResultBytes === undefined || input.providerResultDigest === undefined) {
      throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "A provider response must include its result, exact bytes, and digest together." });
    }
    let providerResult: HealthFactorResultOutput;
    let providerResultBytes: string;
    let providerResultDigest: string;
    try {
      providerResult = healthFactorResultOutputSchema.parse(input.providerResult);
      providerResultBytes = z.string().max(REFERENCE_PROVIDER_MAX_RESPONSE_BYTES).parse(input.providerResultBytes);
      providerResultDigest = z.string().regex(/^[0-9a-f]{64}$/iu).parse(input.providerResultDigest);
    } catch (cause) {
      throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The existing health-factor provider returned an invalid result envelope.", nextAction: "inspect_provider_result", cause });
    }
    const providerBytes = canonicalHealthFactorResultBytes(providerResult);
    if (providerResultBytes !== providerBytes || providerResultDigest.toLowerCase() !== canonicalSha256Hex(providerResult).toLowerCase() || providerResultBytes !== resultBytes) {
      throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The existing health-factor provider returned bytes or a digest different from the validated task result.", nextAction: "inspect_provider_result" });
    }
  }
  const jobId = safeJobNumber(parsed.jobKey.jobId);
  const manifest: Erc8183DeliverableManifest = {
    version: 1,
    job_id: jobId,
    chain_id: parsed.jobKey.chainId,
    contracts: {
      commerce: parsed.jobKey.commerceContract as `0x${string}`,
      router: routerContract,
      policy: policyContract
    },
    response: { content: resultBytes, content_type: "application/json" },
    metadata: {
      source: "bnbera.reference.health-factor",
      result_sha256: provisional.resultDigest,
      provenance_sha256: canonicalSha256Hex(parsed.lendingSnapshot)
    }
  };
  const manifestText = encodeErc8183Manifest(manifest);
  const chainDeliverable = erc8183ManifestHash(manifest);
  const deliverableUrl = dataTextUrl(manifestText);
  const result = createReferenceHealthFactorResult({ task, observedAtUnix: producedAtUnix, chainDeliverable, deliverableUrl });
  if (result.resultDigest !== provisional.resultDigest) {
    throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The reference provider result changed while preparing its manifest." });
  }
  return { task, result, resultBytes, manifest, manifestText, chainDeliverable, deliverableUrl };
}

export type ReferenceProviderAuthorityResolver = (
  reference: ReferenceProviderSecretReference
) => Promise<Erc8183AltanaAuthority>;

export type ReferenceProviderSubmitInput = ReferenceProviderSubmissionInput & {
  readonly idempotencyKey: string;
  readonly providerAddress: string;
  readonly requesterAddress: string;
  readonly authoritySecretReference: string;
};

/**
 * Thin worker adapter over the already-reviewed T4 service.submit path. It
 * resolves only a secret reference and never accepts a private key, session
 * export, or signer object from a task/request body.
 */
export class Erc8183ReferenceProviderAdapter {
  public constructor(
    private readonly service: Pick<Erc8183CommerceService, "submit">,
    private readonly resolveAuthority: ReferenceProviderAuthorityResolver
  ) {}

  public async submit(input: ReferenceProviderSubmitInput): Promise<{
    readonly submission: ReferenceProviderSubmission;
    readonly operation: Awaited<ReturnType<Erc8183CommerceService["submit"]>>;
  }> {
    const reference = referenceProviderSecretReferenceSchema.parse(input.authoritySecretReference);
    const providerAddress = normalizeAddress(input.providerAddress, "provider address");
    const requesterAddress = normalizeAddress(input.requesterAddress, "requester address");
    if (providerAddress !== requesterAddress) {
      throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The reference provider requester does not match its configured provider address." });
    }
    const expectedIdempotencyKey = referenceProviderIdempotencyKey(input.jobKey);
    if (input.idempotencyKey !== expectedIdempotencyKey) {
      throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "Reference provider submission idempotency is server-bound to the configured protocol job." });
    }
    const submission = prepareReferenceProviderSubmission(input);
    const authority = await this.resolveAuthority(reference);
    const authorityAddress = normalizeAddress("session" in authority ? authority.session.walletAddress : authority.wallet.address, "provider authority address");
    if (authorityAddress !== providerAddress) {
      throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The resolved provider authority does not match the configured provider address." });
    }
    // A wallet handle is not independent proof of the key that will sign the
    // relay request. For a server-side wallet authority, require both the
    // wallet address and the derived signer address to equal the configured
    // ERC-8183 provider actor before entering the write boundary. Session
    // authorities expose only their already-bound wallet address.
    if ("wallet" in authority) {
      const signerAddress = normalizeAddress(authority.signer.address, "provider signer address");
      if (signerAddress !== providerAddress) {
        throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The resolved provider signer does not match the configured provider address." });
      }
    }
    const operation = await this.service.submit({
      idempotencyKey: input.idempotencyKey,
      jobId: input.jobKey.jobId,
      authority,
      requesterAddress: authorityAddress,
      resultDigest: submission.result.resultDigest,
      chainDeliverable: submission.chainDeliverable,
      deliverableUrl: submission.deliverableUrl,
      manifest: submission.manifest,
      task: submission.task,
      result: submission.result,
      providerBinding: input.providerBinding
    });
    return { submission, operation };
  }
}

export type ReferenceProviderOwnedJob = {
  /** Canonical persisted ERC-8183 projection; no ad-hoc job identity is accepted. */
  readonly job: Erc8183JobRecord;
  /** Finalized ERC-8004 owner evidence for the configured identity. */
  readonly identityOwnerAddress: string;
  /** The independent execution-wallet axis; delegated submission requires it. */
  readonly identityAgentWallet: string | null;
  readonly account: string;
  readonly protocol: string;
  readonly requestedAtUnix: number;
  readonly lendingSnapshot: HealthFactorLendingSnapshot;
};

export interface ReferenceProviderJobSelector {
  /** Implementations must query one exact full identity tuple and job key. */
  select(input: {
    readonly identity: Erc8004Identity;
    readonly jobKey: Erc8183JobKey;
    readonly providerAddress: string;
  }): Promise<ReferenceProviderOwnedJob | null>;
}

export interface ReferenceProviderOperationStore {
  getByIdempotencyKey(idempotencyKey: string): Promise<Erc8183OperationRecord | null>;
}

export interface ReferenceProviderRecoveryService {
  submit: Erc8183CommerceService["submit"];
  reconcile: Erc8183CommerceService["reconcile"];
}

export type ReferenceProviderRunStatus = "disabled" | "submitted" | "replayed" | "reconciled" | "pending" | "manual_review" | "reverted";

export type ReferenceProviderRunResult = {
  readonly status: ReferenceProviderRunStatus;
  readonly idempotencyKey: string;
  /** Durable operation evidence, including callsId/transactionHash when observed. */
  readonly operation: Erc8183OperationRecord | null;
  readonly submission?: ReferenceProviderSubmission;
};

function operationRunStatus(operation: Erc8183OperationRecord, replayed: boolean): ReferenceProviderRunStatus {
  if (operation.status === "confirmed") return replayed ? "replayed" : "submitted";
  if (operation.status === "reconciled") return "reconciled";
  if (operation.status === "unknown" || operation.status === "submitted" || operation.status === "awaiting_signature") return "pending";
  if (operation.status === "manual_review") return "manual_review";
  return "reverted";
}

function assertOperationMatchesConfig(operation: Erc8183OperationRecord, config: EnabledReferenceProviderRunnerConfig, providerAddress: string, idempotencyKey: string): void {
  const operationBinding = operation.context?.parameters?.providerBinding;
  const parsedBinding = erc8183ProviderBindingSchema.safeParse(operationBinding);
  if (
    operation.idempotencyKey !== idempotencyKey ||
    operation.kind !== "submit" ||
    operation.signerRole !== "provider" ||
    operation.context?.sdkAction !== "submit" ||
    operation.chainId !== 97 ||
    operation.commerceContract.toLowerCase() !== config.jobKey.commerceContract.toLowerCase() ||
    operation.jobId !== config.jobKey.jobId ||
    operation.context?.signerAddress.toLowerCase() !== providerAddress ||
    !parsedBinding.success ||
    !sameErc8004Identity(parsedBinding.data.identity, config.identity)
  ) {
    throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "The persisted reference-provider operation is bound to a different job, chain, or provider actor." });
  }
}

function assertSelectedOwnedJob(selection: ReferenceProviderOwnedJob, config: EnabledReferenceProviderRunnerConfig, providerAddress: string): Erc8183JobRecord {
  let job: Erc8183JobRecord;
  try {
    job = erc8183JobRecordSchema.parse(selection.job);
  } catch (cause) {
    throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "The configured reference job is not a valid canonical ERC-8183 projection.", nextAction: "reconcile_job", cause });
  }
  if (job.jobKey.chainId !== 97 || job.jobKey.commerceContract.toLowerCase() !== config.jobKey.commerceContract.toLowerCase() || job.jobKey.jobId !== config.jobKey.jobId) {
    throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The selected reference job does not match the configured protocol job." });
  }
  assertPinMatchesJob(job.terms, job.deploymentPin);
  if (job.state !== "funded") throw new CommerceError({ code: "STALE_JOB", message: "The configured reference job is not awaiting provider submission.", retriable: true, nextAction: "reconcile_job" });
  if (job.terms.providerAddress === null || normalizeAddress(job.terms.providerAddress, "job provider address") !== providerAddress) throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The selected reference job provider actor does not match the configured authority.", nextAction: "authenticate_actor" });
  if (job.providerBinding === null || !sameErc8004Identity(job.providerBinding.identity, config.identity)) throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The selected reference job identity is not the configured owned ERC-8004 identity.", nextAction: "reload_identity" });
  if (normalizeAddress(selection.identityOwnerAddress, "reference identity owner") !== normalizeAddress(config.expectedOwnerAddress, "expected reference identity owner")) {
    throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The configured ERC-8004 identity owner does not match the expected owner.", nextAction: "reload_identity" });
  }
  if (selection.identityAgentWallet === null || normalizeAddress(selection.identityAgentWallet, "reference identity agent wallet") !== providerAddress) {
    throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The configured ERC-8004 identity agent wallet does not match the provider authority.", nextAction: "reload_identity" });
  }
  if (!/^[1-9][0-9]*$/u.test(job.terms.budgetAtomic) || BigInt(job.terms.budgetAtomic) > BigInt(config.maxBudgetAtomic) || BigInt(job.terms.budgetAtomic) > BigInt(REFERENCE_PROVIDER_MAX_BUDGET_ATOMIC)) {
    throw new CommerceError({ code: "INVALID_AMOUNT", message: "The reference provider job exceeds its bounded local testnet budget cap." });
  }
  healthFactorLendingSnapshotSchema.parse(selection.lendingSnapshot);
  if (!Number.isSafeInteger(selection.requestedAtUnix) || selection.requestedAtUnix <= 0) throw new CommerceError({ code: "INVALID_JOB", message: "The reference provider request timestamp is invalid." });
  return job;
}

async function recoverReferenceProviderOperation(input: {
  readonly operation: Erc8183OperationRecord;
  readonly idempotencyKey: string;
  readonly operations: ReferenceProviderOperationStore;
  readonly service: Pick<ReferenceProviderRecoveryService, "reconcile">;
}): Promise<ReferenceProviderRunResult> {
  if (["confirmed", "reconciled", "reverted", "manual_review"].includes(input.operation.status)) {
    return { status: operationRunStatus(input.operation, true), idempotencyKey: input.idempotencyKey, operation: input.operation };
  }
  try {
    const reconciled = await input.service.reconcile(input.operation.operationId);
    return { status: operationRunStatus(reconciled.operation, true), idempotencyKey: input.idempotencyKey, operation: reconciled.operation };
  } catch (cause) {
    if (!(cause instanceof CommerceError) || cause.code !== "TRANSACTION_UNKNOWN") throw cause;
    const latest = await input.operations.getByIdempotencyKey(input.idempotencyKey);
    return { status: latest === null ? "pending" : operationRunStatus(latest, true), idempotencyKey: input.idempotencyKey, operation: latest ?? input.operation };
  }
}

/**
 * One bounded provider run. It performs no work unless explicitly enabled for
 * local BSC testnet, selects one exact owned identity/job, calls the existing
 * health-factor endpoint, and delegates the write/persistence boundary to the
 * already-reviewed commerce service. A durable operation always wins over a
 * fresh provider call, so reloads and unknown outcomes never rebroadcast.
 */
export class Erc8183ReferenceProviderRunner {
  private readonly config: ReferenceProviderRunnerConfig;
  private readonly selector: ReferenceProviderJobSelector;
  private readonly provider: ReferenceHealthFactorProviderClient | undefined;
  private readonly service: ReferenceProviderRecoveryService;
  private readonly operations: ReferenceProviderOperationStore;
  private readonly resolveAuthority: ReferenceProviderAuthorityResolver;

  public constructor(input: {
    readonly config: ReferenceProviderRunnerConfig;
    readonly selector: ReferenceProviderJobSelector;
    readonly provider?: ReferenceHealthFactorProviderClient;
    readonly service: ReferenceProviderRecoveryService;
    readonly operations: ReferenceProviderOperationStore;
    readonly resolveAuthority: ReferenceProviderAuthorityResolver;
  }) {
    this.config = referenceProviderRunnerConfigSchema.parse(input.config);
    this.selector = input.selector;
    this.provider = input.provider;
    this.service = input.service;
    this.operations = input.operations;
    this.resolveAuthority = input.resolveAuthority;
  }

  public async run(): Promise<ReferenceProviderRunResult> {
    if (!this.config.enabled) return { status: "disabled", idempotencyKey: "disabled", operation: null };
    const config = enabledRunnerConfig(this.config);
    const providerAddress = normalizeAddress(config.providerAddress, "reference provider address");
    const idempotencyKey = referenceProviderIdempotencyKey(config.jobKey);
    const existing = await this.operations.getByIdempotencyKey(idempotencyKey);
    if (existing !== null) {
      assertOperationMatchesConfig(existing, config, providerAddress, idempotencyKey);
      return recoverReferenceProviderOperation({ operation: existing, idempotencyKey, operations: this.operations, service: this.service });
    }

    const selection = await this.selector.select({ identity: config.identity, jobKey: config.jobKey, providerAddress });
    if (selection === null) throw new CommerceError({ code: "UNKNOWN_JOB", message: "The configured owned reference identity/job was not found.", nextAction: "configure_reference_job" });
    const job = assertSelectedOwnedJob(selection, config, providerAddress);
    const binding = job.providerBinding;
    if (binding === null) throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The configured reference job has no provider identity binding." });
    const invocation = referenceHealthFactorInvocationSchema.parse({
      schemaVersion: "bnbera.reference.health-factor.request/v1",
      jobKey: job.jobKey,
      providerBinding: binding,
      account: selection.account,
      protocol: selection.protocol,
      requestedAtUnix: selection.requestedAtUnix,
      lendingSnapshot: selection.lendingSnapshot
    });
    const provider = this.provider ?? createReferenceHealthFactorProviderClient({ endpoint: config.providerEndpoint });
    let providerResponse: ReferenceHealthFactorProviderResponse;
    try {
      providerResponse = referenceHealthFactorProviderResponseSchema.parse(await provider.invoke(invocation));
    } catch (cause) {
      if (cause instanceof CommerceError) throw cause;
      throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The existing health-factor provider returned an invalid result envelope.", nextAction: "inspect_provider_result", cause });
    }
    const task = createReferenceHealthFactorTask({
      jobKey: invocation.jobKey,
      providerBinding: invocation.providerBinding,
      account: invocation.account,
      protocol: invocation.protocol,
      requestedAtUnix: invocation.requestedAtUnix,
      lendingSnapshot: invocation.lendingSnapshot
    });
    const expected = createReferenceHealthFactorResult({ task, observedAtUnix: providerResponse.result.observedAtUnix });
    if (providerResponse.resultBytes !== canonicalHealthFactorResultBytes(expected.result) || providerResponse.resultDigest.toLowerCase() !== expected.resultDigest.toLowerCase()) {
      throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The existing health-factor provider result is not bound to the selected task bytes.", nextAction: "inspect_provider_result" });
    }
    const submissionInput: ReferenceProviderSubmitInput = {
      idempotencyKey,
      jobKey: job.jobKey,
      providerBinding: binding,
      account: invocation.account,
      protocol: invocation.protocol,
      requestedAtUnix: invocation.requestedAtUnix,
      lendingSnapshot: invocation.lendingSnapshot,
      routerContract: config.routerContract as `0x${string}`,
      policyContract: config.policyContract as `0x${string}`,
      producedAtUnix: providerResponse.result.observedAtUnix,
      providerResult: providerResponse.result,
      providerResultBytes: providerResponse.resultBytes,
      providerResultDigest: providerResponse.resultDigest,
      providerAddress,
      requesterAddress: providerAddress,
      authoritySecretReference: config.authoritySecretReference
    };
    const adapter = new Erc8183ReferenceProviderAdapter(this.service, this.resolveAuthority);
    try {
      const submitted = await adapter.submit(submissionInput);
      return { status: operationRunStatus(submitted.operation.operation, false), idempotencyKey, operation: submitted.operation.operation, submission: submitted.submission };
    } catch (cause) {
      if (!(cause instanceof CommerceError) || cause.code !== "TRANSACTION_UNKNOWN") throw cause;
      const operation = await this.operations.getByIdempotencyKey(idempotencyKey);
      if (operation === null) {
        throw new CommerceError({
          code: "RECONCILIATION_REQUIRED",
          message: "The provider submit outcome is unknown and has no durable operation row; no retry is safe.",
          nextAction: "manual_review",
          ...(cause.relayCallsId === undefined ? {} : { relayCallsId: cause.relayCallsId }),
          ...(cause.transactionHash === undefined ? {} : { transactionHash: cause.transactionHash })
        });
      }
      assertOperationMatchesConfig(operation, config, providerAddress, idempotencyKey);
      // Reconcile the persisted operation once. This path intentionally has no
      // retry branch: an unknown provider write must never be rebroadcast.
      return recoverReferenceProviderOperation({ operation, idempotencyKey, operations: this.operations, service: this.service });
    }
  }
}
