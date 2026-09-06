import { z } from "zod";
import { canonicalSha256Hex, contentDigestSchema, transactionHashSchema } from "@bnbera/domain";
import { verifyErc8183ManifestText } from "@altananetwork/sdk";
import { CommerceError } from "./errors.js";
import {
  erc8183JobEventSchema,
  erc8183JobKeySchema,
  erc8183JobRecordSchema,
  type Erc8183JobEvent,
  type Erc8183JobKey,
  type Erc8183JobRecord
} from "./types.js";
import {
  erc8183ProviderResultSchema,
  type Erc8183ProviderResult
} from "./provider.js";
import type {
  Erc8183OperationRecord,
  Erc8183OperationStatus,
  Erc8183OperationQueryPool
} from "./operations.js";

/**
 * The event payload is deliberately narrower than the generic append-only
 * event payload. A status read may expose only bytes that were validated at
 * the provider/SDK boundary; arbitrary operation context is never returned.
 */
export const erc8183SubmissionPayloadSchema = z.object({
  operationId: z.string().uuid().optional().nullable(),
  callsId: transactionHashSchema.optional().nullable(),
  resultDigest: contentDigestSchema,
  chainDeliverable: transactionHashSchema,
  deliverableUrl: z.string().url().optional().nullable(),
  manifestText: z.string().max(262_144).optional().nullable(),
  manifest: z.unknown().optional().nullable(),
  result: erc8183ProviderResultSchema.optional().nullable()
}).strict();
export type Erc8183SubmissionPayload = z.infer<typeof erc8183SubmissionPayloadSchema>;

export const erc8183PublicOperationSchema = z.object({
  operationId: z.string().uuid(),
  jobId: z.string().regex(/^(0|[1-9][0-9]*)$/).nullable(),
  kind: z.string().trim().min(1).max(32),
  signerRole: z.string().trim().min(1).max(16),
  status: z.string().trim().min(1).max(32),
  callsId: transactionHashSchema.nullable(),
  transactionHash: transactionHashSchema.nullable(),
  blockNumber: z.string().regex(/^(0|[1-9][0-9]*)$/).nullable(),
  blockHash: transactionHashSchema.nullable(),
  failureCode: z.string().trim().max(80).nullable(),
  createdAtUnix: z.number().int().positive(),
  updatedAtUnix: z.number().int().positive()
}).strict();
export type Erc8183PublicOperation = z.infer<typeof erc8183PublicOperationSchema>;

export const erc8183ConfirmedSubmissionSchema = z.object({
  eventId: z.string().uuid(),
  eventKey: z.string().trim().min(1).max(240),
  confirmationState: z.literal("canonical"),
  status: z.literal("confirmed"),
  observedAtUnix: z.number().int().positive(),
  blockNumber: z.string().regex(/^(0|[1-9][0-9]*)$/),
  blockHash: transactionHashSchema,
  logIndex: z.number().int().nonnegative().nullable(),
  operationId: z.string().uuid().nullable(),
  callsId: transactionHashSchema.nullable(),
  transactionHash: transactionHashSchema,
  /** BNBEra's local SHA-256 result identity. */
  localSha256: contentDigestSchema,
  /** APEX/ERC-8183 Keccak digest of the exact manifest bytes. */
  chainKeccak: transactionHashSchema,
  /** Compatibility names used by the commerce package and T5 clients. */
  resultDigest: contentDigestSchema,
  chainDeliverable: transactionHashSchema,
  deliverableUrl: z.string().url().nullable(),
  manifestText: z.string().max(262_144).nullable(),
  manifest: z.unknown().nullable(),
  result: erc8183ProviderResultSchema.nullable(),
  operationStatus: z.string().trim().min(1).max(32).nullable()
}).strict();
export type Erc8183ConfirmedSubmission = z.infer<typeof erc8183ConfirmedSubmissionSchema>;

export const erc8183JobReadSchema = z.object({
  /** Canonical PostgreSQL ERC-8183 job projection, never a client-supplied view. */
  job: erc8183JobRecordSchema,
  submission: erc8183ConfirmedSubmissionSchema.nullable(),
  operations: z.array(erc8183PublicOperationSchema).max(128),
  approvalRequired: z.boolean()
}).strict();
export type Erc8183JobRead = z.infer<typeof erc8183JobReadSchema>;

/** Read seam implemented by the persistent canonical-job repository. */
export interface Erc8183ConfirmedSubmissionEventReader {
  getConfirmedSubmissionEvent(jobKey: Erc8183JobKey): Promise<Erc8183JobEvent | null>;
}

/** Read seam implemented by the persistent operation repository. */
export interface Erc8183OperationReadRepository {
  get(operationId: string): Promise<Erc8183OperationRecord | null>;
  listForJob?(jobKey: Erc8183JobKey): Promise<readonly Erc8183OperationRecord[]>;
}

export interface Erc8183JobReadRepository extends Erc8183ConfirmedSubmissionEventReader {
  get(jobKey: Erc8183JobKey): Promise<Erc8183JobRecord | null>;
}

function safePublicPayload(value: unknown, label: string): unknown {
  if (Array.isArray(value)) return value.map((entry) => safePublicPayload(entry, label));
  if (typeof value !== "object" || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (/(?:private.?key|seed|mnemonic|password|secret|credential|session.?token|access.?token|raw.?signature|wallet.?key)/iu.test(key)) {
      throw new CommerceError({ code: "INVALID_JOB", message: `Sensitive field rejected from ${label}.` });
    }
    result[key] = safePublicPayload(child, `${label}.${key}`);
  }
  return result;
}

function parseSubmissionEvent(
  event: Erc8183JobEvent,
  jobKey: Erc8183JobKey,
  job: Erc8183JobRecord,
  operation: Erc8183OperationRecord | null
): Erc8183ConfirmedSubmission {
  const parsedEvent = erc8183JobEventSchema.parse(event);
  if (canonicalSha256Hex(parsedEvent.payload).toLowerCase() !== parsedEvent.payloadDigest.toLowerCase()) {
    throw new CommerceError({
      code: "ONCHAIN_MISMATCH",
      message: "The persisted submission event payload digest does not match its public data.",
      nextAction: "reconcile_transaction"
    });
  }
  if (
    parsedEvent.eventType !== "job_submitted" ||
    parsedEvent.confirmationState !== "canonical" ||
    parsedEvent.transactionHash === null ||
    parsedEvent.blockNumber === null ||
    parsedEvent.blockHash === null
  ) {
    throw new CommerceError({
      code: "ONCHAIN_MISMATCH",
      message: "The submitted result is not backed by a confirmed canonical chain event.",
      nextAction: "reconcile_transaction"
    });
  }
  if (
    parsedEvent.jobKey.chainId !== jobKey.chainId ||
    parsedEvent.jobKey.commerceContract.toLowerCase() !== jobKey.commerceContract.toLowerCase() ||
    parsedEvent.jobKey.jobId !== jobKey.jobId
  ) {
    throw new CommerceError({
      code: "ONCHAIN_MISMATCH",
      message: "The submitted result event belongs to a different ERC-8183 job.",
      nextAction: "reconcile_job"
    });
  }

  const payloadResult = erc8183SubmissionPayloadSchema.safeParse(parsedEvent.payload);
  if (!payloadResult.success) {
    throw new CommerceError({
      code: "ONCHAIN_MISMATCH",
      message: "The confirmed submission event does not contain a complete public result manifest.",
      nextAction: "reconcile_transaction",
      cause: payloadResult.error
    });
  }
  const payload = payloadResult.data;
  const callsId = payload.callsId ?? operation?.context?.callsId ?? null;
  const operationId = payload.operationId ?? operation?.operationId ?? null;
  if (payload.operationId !== undefined && payload.operationId !== null && operation === null) {
    throw new CommerceError({
      code: "ONCHAIN_MISMATCH",
      message: "The confirmed submission event references a missing persisted operation.",
      nextAction: "reconcile_transaction"
    });
  }
  if (operation !== null && (operation.kind !== "submit" || operation.jobId !== jobKey.jobId)) {
    throw new CommerceError({
      code: "ONCHAIN_MISMATCH",
      message: "The confirmed submission event is not bound to its persisted submit operation.",
      nextAction: "manual_review"
    });
  }
  if (operation !== null && (
    operation.chainId !== jobKey.chainId ||
    operation.commerceContract.toLowerCase() !== jobKey.commerceContract.toLowerCase() ||
    operation.transactionHash?.toLowerCase() !== parsedEvent.transactionHash.toLowerCase() ||
    operation.blockNumber !== parsedEvent.blockNumber ||
    operation.blockHash?.toLowerCase() !== parsedEvent.blockHash.toLowerCase() ||
    (operation.context?.callsId !== undefined && operation.context.callsId !== null && operation.context.callsId.toLowerCase() !== callsId?.toLowerCase())
  )) {
    throw new CommerceError({
      code: "ONCHAIN_MISMATCH",
      message: "The confirmed submission event does not match its persisted operation receipt.",
      nextAction: "reconcile_transaction"
    });
  }
  if (parsedEvent.actorAddress === null || parsedEvent.actorAddress.toLowerCase() !== job.terms.providerAddress?.toLowerCase()) {
    throw new CommerceError({
      code: "ONCHAIN_MISMATCH",
      message: "The confirmed submission event actor does not match the canonical provider.",
      nextAction: "manual_review"
    });
  }
  if (operation !== null && parsedEvent.actorAddress.toLowerCase() !== operation.context?.signerAddress.toLowerCase()) {
    throw new CommerceError({
      code: "ONCHAIN_MISMATCH",
      message: "The confirmed submission event actor does not match its persisted provider operation.",
      nextAction: "manual_review"
    });
  }
  if (payload.manifestText !== undefined && payload.manifestText !== null && !verifyErc8183ManifestText(payload.manifestText, payload.chainDeliverable as `0x${string}`)) {
    throw new CommerceError({
      code: "ONCHAIN_MISMATCH",
      message: "The confirmed submission manifest bytes do not match the chain Keccak digest.",
      nextAction: "reconcile_transaction"
    });
  }
  const manifest = payload.manifest === undefined || payload.manifest === null
    ? null
    : safePublicPayload(payload.manifest, "submission.manifest");
  const result = payload.result === undefined || payload.result === null
    ? null
    : erc8183ProviderResultSchema.parse(safePublicPayload(payload.result, "submission.result"));
  if (result !== null && (
    result.jobKey.chainId !== jobKey.chainId ||
    result.jobKey.commerceContract.toLowerCase() !== jobKey.commerceContract.toLowerCase() ||
    result.jobKey.jobId !== jobKey.jobId ||
    result.resultDigest.toLowerCase() !== payload.resultDigest.toLowerCase() ||
    result.chainDeliverable === null ||
    result.chainDeliverable.toLowerCase() !== payload.chainDeliverable.toLowerCase() ||
    (job.providerBinding !== null && canonicalSha256Hex(result.providerBinding) !== canonicalSha256Hex(job.providerBinding))
  )) {
    throw new CommerceError({
      code: "ONCHAIN_MISMATCH",
      message: "The confirmed provider result is not bound to the canonical ERC-8183 job.",
      nextAction: "manual_review"
    });
  }

  return erc8183ConfirmedSubmissionSchema.parse({
    eventId: parsedEvent.eventId,
    eventKey: parsedEvent.eventKey,
    confirmationState: "canonical",
    status: "confirmed",
    observedAtUnix: parsedEvent.observedAtUnix,
    blockNumber: parsedEvent.blockNumber,
    blockHash: parsedEvent.blockHash,
    logIndex: parsedEvent.logIndex,
    operationId,
    callsId,
    transactionHash: parsedEvent.transactionHash,
    localSha256: payload.resultDigest,
    chainKeccak: payload.chainDeliverable,
    resultDigest: payload.resultDigest,
    chainDeliverable: payload.chainDeliverable,
    deliverableUrl: payload.deliverableUrl ?? (result?.deliverableUrl ?? null),
    manifestText: payload.manifestText ?? null,
    manifest,
    result,
    operationStatus: operation?.status ?? null
  });
}

export function toErc8183PublicOperation(operation: Erc8183OperationRecord): Erc8183PublicOperation {
  return erc8183PublicOperationSchema.parse({
    operationId: operation.operationId,
    jobId: operation.jobId,
    kind: operation.kind,
    signerRole: operation.signerRole,
    status: operation.status,
    callsId: operation.context?.callsId ?? null,
    transactionHash: operation.transactionHash,
    blockNumber: operation.blockNumber,
    blockHash: operation.blockHash,
    failureCode: operation.failureCode,
    createdAtUnix: operation.createdAtUnix,
    updatedAtUnix: operation.updatedAtUnix
  });
}

/**
 * Assemble the reload-safe T5 read model from canonical PostgreSQL state and
 * a confirmed submission event. This function never reads or writes a chain
 * and never returns the operation's private/context fields.
 */
export class Erc8183CommerceReadService {
  public constructor(
    private readonly jobs: Erc8183JobReadRepository,
    private readonly operations: Erc8183OperationReadRepository
  ) {}

  public async get(input: Erc8183JobKey): Promise<Erc8183JobRead> {
    const jobKey = erc8183JobKeySchema.parse(input);
    const job = await this.jobs.get(jobKey);
    if (job === null) throw new CommerceError({ code: "UNKNOWN_JOB", message: "The ERC-8183 job does not exist." });
    const event = await this.jobs.getConfirmedSubmissionEvent(jobKey);
    const eventOperationId = event === null || typeof event.payload !== "object" || event.payload === null || Array.isArray(event.payload)
      ? null
      : (() => {
          const value = (event.payload as Record<string, unknown>).operationId;
          return typeof value === "string" ? value : null;
        })();
    const eventOperation = eventOperationId === null ? null : await this.operations.get(eventOperationId);
    const operations = this.operations.listForJob === undefined
      ? (eventOperation === null ? [] : [eventOperation])
      : await this.operations.listForJob(jobKey);
    const uniqueOperations = new Map<string, Erc8183OperationRecord>();
    for (const operation of operations) uniqueOperations.set(operation.operationId, operation);
    if (eventOperation !== null) uniqueOperations.set(eventOperation.operationId, eventOperation);
    const submission = event === null ? null : parseSubmissionEvent(event, jobKey, job, eventOperation);
    return erc8183JobReadSchema.parse({
      job,
      submission,
      operations: [...uniqueOperations.values()].map(toErc8183PublicOperation),
      approvalRequired: job.state === "submitted" && job.buyerApproval === null
    });
  }
}

/** Keep the operation status type reachable to API composition consumers. */
export type Erc8183CommerceOperationStatus = Erc8183OperationStatus;

/** Typed PostgreSQL constructor seam used by the server composition. */
export type Erc8183CommerceQueryPool = Erc8183OperationQueryPool;

export type { Erc8183ProviderResult };
