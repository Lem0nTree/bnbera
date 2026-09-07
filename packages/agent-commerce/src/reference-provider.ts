import { Buffer } from "node:buffer";
import {
  encodeErc8183Manifest,
  erc8183ManifestHash,
  type Erc8183DeliverableManifest
} from "@altananetwork/sdk";
import { canonicalSha256Hex } from "@bnbera/domain";
import { z } from "zod";
import { CommerceError } from "./errors.js";
import type { Erc8183AltanaAuthority } from "./chain.js";
import type { Erc8183CommerceService } from "./service.js";
import {
  canonicalHealthFactorResultBytes,
  createReferenceHealthFactorResult,
  createReferenceHealthFactorTask,
  healthFactorLendingSnapshotSchema,
  type Erc8183ProviderResult,
  type HealthFactorLendingSnapshot
} from "./provider.js";
import {
  erc8183JobKeySchema,
  erc8183ProviderBindingSchema,
  nonZeroAddressSchema,
  type Erc8183JobKey,
  type Erc8183ProviderBinding
} from "./types.js";
import { normalizeAddress } from "./validation.js";

/** Secret-manager references only; the resolved signer never enters this package's public data. */
export const referenceProviderSecretReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^(?:secret:\/\/|vault:\/\/|env:\/\/|arn:aws:secretsmanager:)/u, "The provider authority must be a secret reference.");
export type ReferenceProviderSecretReference = z.infer<typeof referenceProviderSecretReferenceSchema>;

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
    const authority = await this.resolveAuthority(reference);
    const authorityAddress = normalizeAddress("session" in authority ? authority.session.walletAddress : authority.wallet.address, "provider authority address");
    if (authorityAddress !== providerAddress) {
      throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The resolved provider authority does not match the configured provider address." });
    }
    const submission = prepareReferenceProviderSubmission(input);
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
