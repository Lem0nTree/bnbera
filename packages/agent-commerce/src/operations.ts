import { randomUUID } from "node:crypto";
import { canonicalSha256Hex } from "@bnbera/domain";
import { CommerceError } from "./errors.js";
import { assertPublicPayloadSafe, normalizeAddress } from "./validation.js";
import { idempotencyKeySchema, type BscChainId } from "./types.js";

/** Roles and operation names are deliberately narrower than arbitrary calldata. */
export type Erc8183ChainRole = "client" | "provider" | "evaluator" | "voter" | "system";
export const erc8183OperationKinds = [
  "create", "register", "set_budget", "approve", "fund", "submit", "settle",
  "claim_refund", "mark_expired", "cancel", "reject", "dispute", "vote"
] as const;
export type Erc8183OperationKind = (typeof erc8183OperationKinds)[number];

export type Erc8183OperationStatus =
  | "awaiting_signature"
  | "submitted"
  | "confirmed"
  | "reverted"
  | "unknown"
  | "reconciled"
  | "manual_review";

export const erc8183OperationStatuses: readonly Erc8183OperationStatus[] = [
  "awaiting_signature", "submitted", "confirmed", "reverted", "unknown", "reconciled", "manual_review"
];

export type Erc8183SdkAction = "hire" | "submit" | "settle" | "dispute" | "claim_refund";

export interface Erc8183OperationExpectation {
  readonly providerAddress?: `0x${string}`;
  readonly amountAtomic?: string;
  readonly digest?: `0x${string}`;
  readonly expectedState?: "FUNDED" | "SUBMITTED" | "COMPLETED" | "REJECTED" | "EXPIRED";
}

/**
 * Public, replay-safe context for an operation. `to/data/valueAtomic` remain
 * optional for compatibility with legacy rows, but new SDK operations use the
 * named action and public parameters instead of persisting independently-built
 * calldata. No secret or signer material belongs in this object.
 */
export interface Erc8183OperationContext {
  readonly signerAddress: `0x${string}`;
  readonly sdkAction?: Erc8183SdkAction;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly callsId?: `0x${string}` | null;
  readonly to?: `0x${string}`;
  readonly data?: `0x${string}`;
  readonly valueAtomic?: string;
  readonly expectation?: Erc8183OperationExpectation | null;
}

export interface Erc8183OperationRecord {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly chainId: BscChainId;
  readonly commerceContract: `0x${string}`;
  readonly jobId: string | null;
  readonly kind: Erc8183OperationKind;
  readonly signerRole: Erc8183ChainRole;
  readonly status: Erc8183OperationStatus;
  readonly transactionHash: `0x${string}` | null;
  readonly blockNumber: string | null;
  readonly blockHash: `0x${string}` | null;
  readonly logIndex: number | null;
  readonly failureCode: string | null;
  readonly context: Erc8183OperationContext | null;
  readonly createdAtUnix: number;
  readonly updatedAtUnix: number;
}

export interface Erc8183OperationQueryResult<T> {
  readonly rows: readonly T[];
  readonly rowCount?: number | null;
}

export interface Erc8183OperationQueryClient {
  query<T = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<Erc8183OperationQueryResult<T>>;
}

export interface Erc8183OperationQueryPool extends Erc8183OperationQueryClient {
  connect(): Promise<Erc8183OperationQueryClient & { readonly release: () => void }>;
}

export interface ReserveErc8183OperationInput {
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly chainId: BscChainId;
  readonly commerceContract: string;
  readonly jobId?: string | null;
  readonly kind: Erc8183OperationKind;
  readonly signerRole: Erc8183ChainRole;
  readonly context?: Erc8183OperationContext | null;
  readonly nowUnix?: number;
}

export interface Erc8183PreparedOperation {
  readonly kind: Erc8183OperationKind;
  readonly signerRole: Erc8183ChainRole;
  readonly chainId: BscChainId;
  readonly commerceContract: `0x${string}`;
  readonly jobId: string | null;
  readonly requestDigest: string;
  readonly expectation: Erc8183OperationExpectation | null;
  readonly value: bigint;
  /** Legacy calldata fields are optional; Altana SDK actions do not use them. */
  readonly to?: `0x${string}`;
  readonly data?: `0x${string}`;
  readonly context?: Erc8183OperationContext;
}

export interface Erc8183ConfirmedOperation {
  readonly operation: Erc8183PreparedOperation;
  readonly transactionHash: `0x${string}`;
  readonly receipt: Erc8183RpcReceipt;
  readonly jobId: string | null;
  readonly finalStatus?: "funded" | "submitted" | "completed" | "rejected" | "expired";
}

export interface Erc8183RpcReceipt {
  readonly status: "success" | "reverted";
  readonly blockNumber: bigint;
  readonly blockHash: `0x${string}`;
  readonly transactionHash: `0x${string}`;
  readonly logs?: readonly Erc8183RpcLog[];
}

export interface Erc8183RpcLog {
  readonly address: `0x${string}`;
  readonly topics: readonly `0x${string}`[];
  readonly data: `0x${string}`;
  readonly blockNumber?: bigint;
  readonly blockHash?: `0x${string}`;
  readonly transactionHash?: `0x${string}`;
  readonly logIndex?: number;
}

type OperationRow = {
  readonly id: string;
  readonly idempotency_key: string;
  readonly request_digest: string;
  readonly chain_id: number;
  readonly commerce_contract: string;
  readonly erc8183_job_id: string | null;
  readonly operation_kind: string;
  readonly signer_role: string;
  readonly status: string;
  readonly transaction_hash: string | null;
  readonly block_number: string | number | null;
  readonly block_hash: string | null;
  readonly log_index: number | null;
  readonly failure_code: string | null;
  readonly operation_context: unknown | null;
  readonly created_at_unix: number | string;
  readonly updated_at_unix: number | string;
};

function assertDigest(value: string, label: string): string {
  if (!/^[0-9a-f]{64}$/iu.test(value)) {
    throw new CommerceError({ code: "INVALID_JOB", message: `${label} must be a 32-byte SHA-256 digest.` });
  }
  return value.toLowerCase();
}

function assertJobId(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new CommerceError({ code: "INVALID_JOB", message: "Operation job ID must be a decimal integer." });
  }
  return value;
}

function assertNow(nowUnix: number | undefined): number {
  const value = nowUnix ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CommerceError({ code: "INVALID_JOB", message: "Operation timestamps require a trusted Unix time." });
  }
  return value;
}

function normalizeHash(value: string, label: string): `0x${string}` {
  if (!/^0x[0-9a-f]{64}$/iu.test(value)) {
    throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The persisted ${label} is invalid.` });
  }
  return value.toLowerCase() as `0x${string}`;
}

function assertHex(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) {
    throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The persisted ${label} is invalid.` });
  }
  return value.toLowerCase() as `0x${string}`;
}

function parseContext(value: unknown): Erc8183OperationContext | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted operation context is invalid." });
  }
  const row = value as Record<string, unknown>;
  assertPublicPayloadSafe(row, "operationContext");
  if (typeof row.signerAddress !== "string") {
    throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted operation context has no signer address." });
  }
  const context: Erc8183OperationContext = {
    signerAddress: normalizeAddress(row.signerAddress, "operation signer")
  };
  const sdkActions: readonly Erc8183SdkAction[] = ["hire", "submit", "settle", "dispute", "claim_refund"];
  if (row.sdkAction !== undefined) {
    if (typeof row.sdkAction !== "string" || !sdkActions.includes(row.sdkAction as Erc8183SdkAction)) {
      throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted SDK operation action is invalid." });
    }
    (context as { sdkAction?: Erc8183SdkAction }).sdkAction = row.sdkAction as Erc8183SdkAction;
  }
  if (row.parameters !== undefined) {
    if (typeof row.parameters !== "object" || row.parameters === null || Array.isArray(row.parameters)) {
      throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted operation parameters are invalid." });
    }
    (context as { parameters?: Readonly<Record<string, unknown>> }).parameters = row.parameters as Record<string, unknown>;
  }
  if (row.callsId !== undefined && row.callsId !== null) {
    (context as { callsId?: `0x${string}` | null }).callsId = assertHex(row.callsId, "relay calls ID");
  } else if (row.callsId === null) {
    (context as { callsId?: `0x${string}` | null }).callsId = null;
  }
  if (row.to !== undefined) (context as { to?: `0x${string}` }).to = normalizeAddress(String(row.to), "operation target");
  if (row.data !== undefined) (context as { data?: `0x${string}` }).data = assertHex(row.data, "operation calldata");
  if (row.valueAtomic !== undefined) {
    if (typeof row.valueAtomic !== "string" || !/^(0|[1-9][0-9]*)$/u.test(row.valueAtomic)) {
      throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted operation value is invalid." });
    }
    (context as { valueAtomic?: string }).valueAtomic = row.valueAtomic;
  }
  const expectationValue = row.expectation;
  if (expectationValue !== undefined && expectationValue !== null) {
    if (typeof expectationValue !== "object" || Array.isArray(expectationValue)) {
      throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted operation expectation is invalid." });
    }
    const source = expectationValue as Record<string, unknown>;
    const expectation: Erc8183OperationExpectation = {};
    if (source.providerAddress !== undefined) (expectation as { providerAddress?: `0x${string}` }).providerAddress = normalizeAddress(String(source.providerAddress), "operation provider");
    if (source.amountAtomic !== undefined) {
      if (typeof source.amountAtomic !== "string" || !/^(0|[1-9][0-9]*)$/u.test(source.amountAtomic)) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted operation amount is invalid." });
      (expectation as { amountAtomic?: string }).amountAtomic = source.amountAtomic;
    }
    if (source.digest !== undefined) (expectation as { digest?: `0x${string}` }).digest = normalizeHash(String(source.digest), "operation digest");
    if (source.expectedState !== undefined) {
      const states = ["FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"] as const;
      if (typeof source.expectedState !== "string" || !states.includes(source.expectedState as typeof states[number])) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted operation expected state is invalid." });
      (expectation as { expectedState?: typeof states[number] }).expectedState = source.expectedState as typeof states[number];
    }
    (context as { expectation?: Erc8183OperationExpectation | null }).expectation = expectation;
  } else if (expectationValue === null) {
    (context as { expectation?: Erc8183OperationExpectation | null }).expectation = null;
  }
  return context;
}

function parseOperationRow(row: OperationRow): Erc8183OperationRecord {
  if (!erc8183OperationKinds.includes(row.operation_kind as Erc8183OperationKind)) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted operation has an unknown operation kind." });
  if (!erc8183OperationStatuses.includes(row.status as Erc8183OperationStatus)) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted operation has an unknown status." });
  if (!["client", "provider", "evaluator", "voter", "system"].includes(row.signer_role)) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted operation has an unknown signer role." });
  if (row.chain_id !== 56 && row.chain_id !== 97) throw new CommerceError({ code: "INVALID_CHAIN", message: "The persisted operation has an unsupported chain." });
  if (row.log_index !== null && (!Number.isSafeInteger(row.log_index) || row.log_index < 0)) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted operation has an invalid log index." });
  const createdAtUnix = Number(row.created_at_unix);
  const updatedAtUnix = Number(row.updated_at_unix);
  if (!Number.isSafeInteger(createdAtUnix) || createdAtUnix <= 0 || !Number.isSafeInteger(updatedAtUnix) || updatedAtUnix <= 0) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted operation timestamp is invalid." });
  return {
    operationId: row.id,
    idempotencyKey: row.idempotency_key,
    requestDigest: assertDigest(row.request_digest, "Operation request digest"),
    chainId: row.chain_id,
    commerceContract: normalizeAddress(row.commerce_contract, "commerce contract"),
    jobId: assertJobId(row.erc8183_job_id),
    kind: row.operation_kind as Erc8183OperationKind,
    signerRole: row.signer_role as Erc8183ChainRole,
    status: row.status as Erc8183OperationStatus,
    transactionHash: row.transaction_hash === null ? null : normalizeHash(row.transaction_hash, "transaction hash"),
    blockNumber: row.block_number === null ? null : String(row.block_number),
    blockHash: row.block_hash === null ? null : normalizeHash(row.block_hash, "block hash"),
    logIndex: row.log_index,
    failureCode: row.failure_code,
    context: parseContext(row.operation_context),
    createdAtUnix,
    updatedAtUnix
  };
}

function sameOperationJobId(existing: Erc8183OperationRecord, incoming: string | null): boolean {
  // A hire is reserved before the chain assigns its protocol job ID. Once a
  // confirmed receipt attaches that ID, the same idempotency key must still
  // replay when the caller repeats the original create request (which has a
  // null job ID). Every non-create operation, and every two non-null IDs,
  // remains strictly bound to the persisted identity.
  if (existing.kind === "create" && existing.jobId !== null && incoming === null) return true;
  return existing.jobId === incoming;
}

/**
 * The database uniqueness constraint is intentionally only on the client
 * supplied idempotency key. A replay must still prove that the key belongs to
 * the same protocol identity, actor, operation and public parameters; a
 * request digest alone is not enough to protect legacy callers that omitted a
 * material field from their digest.
 */
function assertReplayIdentity(existing: Erc8183OperationRecord, input: ReserveErc8183OperationInput, requestDigest: string, commerceContract: string, jobId: string | null, context: Erc8183OperationContext | null): void {
  if (
    existing.requestDigest !== requestDigest ||
    existing.chainId !== input.chainId ||
    existing.commerceContract.toLowerCase() !== commerceContract.toLowerCase() ||
    !sameOperationJobId(existing, jobId) ||
    existing.kind !== input.kind ||
    existing.signerRole !== input.signerRole
  ) throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "The idempotency key is bound to a different chain, contract, job, actor role, operation or material commerce input." });
  const existingContext = existing.context;
  if ((existingContext === null) !== (context === null)) throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "The idempotency key is bound to a different authenticated actor context." });
  if (existingContext !== null && context !== null) {
    if (existingContext.signerAddress.toLowerCase() !== context.signerAddress.toLowerCase()) throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "The idempotency key is bound to a different authenticated execution wallet." });
    if (existingContext.sdkAction !== context.sdkAction || canonicalSha256Hex(existingContext.parameters ?? null) !== canonicalSha256Hex(context.parameters ?? null) || canonicalSha256Hex(existingContext.expectation ?? null) !== canonicalSha256Hex(context.expectation ?? null)) {
      throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "The idempotency key is bound to different SDK action parameters." });
    }
  }
}

function safeFailureCode(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim() === "") return null;
  const normalized = value.trim().slice(0, 80);
  return /^[A-Za-z0-9_.:-]+$/u.test(normalized) ? normalized : "UNCLASSIFIED_FAILURE";
}

/** Durable pre-send/idempotency and receipt state. Unknown operations are never retried. */
export class PostgresErc8183OperationRepository {
  public constructor(private readonly pool: Erc8183OperationQueryPool) {}

  public async reserve(input: ReserveErc8183OperationInput): Promise<{ readonly operation: Erc8183OperationRecord; readonly replayed: boolean }> {
    const idempotencyKey = idempotencyKeySchema.parse(input.idempotencyKey);
    const requestDigest = assertDigest(input.requestDigest, "Operation request digest");
    const commerceContract = normalizeAddress(input.commerceContract, "commerce contract");
    const jobId = assertJobId(input.jobId);
    const nowUnix = assertNow(input.nowUnix);
    if (!erc8183OperationKinds.includes(input.kind)) throw new CommerceError({ code: "INVALID_JOB", message: "Unsupported ERC-8183 operation kind." });
    if (!["client", "provider", "evaluator", "voter", "system"].includes(input.signerRole)) throw new CommerceError({ code: "INVALID_JOB", message: "Unsupported ERC-8183 signer role." });
    const context = input.context === undefined || input.context === null ? null : parseContext(input.context);
    const operationId = randomUUID();
    const inserted = await this.pool.query<OperationRow>(`
      INSERT INTO erc8183_operations (
        id, idempotency_key, request_digest, chain_id, commerce_contract,
        erc8183_job_id, operation_kind, signer_role, status, operation_context, created_at_unix, updated_at_unix
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'awaiting_signature', $9, $10, $10)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id, idempotency_key, request_digest, chain_id, commerce_contract,
        erc8183_job_id, operation_kind, signer_role, status, transaction_hash,
        block_number, block_hash, log_index, failure_code, operation_context, created_at_unix, updated_at_unix
    `, [operationId, idempotencyKey, requestDigest, input.chainId, commerceContract, jobId, input.kind, input.signerRole, context, nowUnix]);
    if (inserted.rows[0] !== undefined) return { operation: parseOperationRow(inserted.rows[0]), replayed: false };
    const existing = await this.getByIdempotencyKey(idempotencyKey);
    if (existing === null) throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "The operation reservation disappeared during replay." });
    assertReplayIdentity(existing, input, requestDigest, commerceContract, jobId, context);
    return { operation: existing, replayed: true };
  }

  public async markSubmitted(input: { readonly operationId: string; readonly transactionHash: string; readonly nowUnix?: number }): Promise<Erc8183OperationRecord> {
    const hash = normalizeHash(input.transactionHash, "transaction hash");
    const nowUnix = assertNow(input.nowUnix);
    const result = await this.pool.query<OperationRow>(`
      UPDATE erc8183_operations SET status = 'submitted', transaction_hash = $2, updated_at_unix = $3
      WHERE id = $1 AND status = 'awaiting_signature'
      RETURNING id, idempotency_key, request_digest, chain_id, commerce_contract, erc8183_job_id, operation_kind, signer_role, status, transaction_hash, block_number, block_hash, log_index, failure_code, operation_context, created_at_unix, updated_at_unix
    `, [input.operationId, hash, nowUnix]);
    if (result.rows[0] !== undefined) return parseOperationRow(result.rows[0]);
    const existing = await this.get(input.operationId);
    if (existing !== null && existing.status === "submitted" && existing.transactionHash === hash) return existing;
    throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "The operation cannot be submitted from its current state." });
  }

  public async attachJobId(input: { readonly operationId: string; readonly jobId: string }): Promise<Erc8183OperationRecord> {
    const jobId = assertJobId(input.jobId);
    if (jobId === null) throw new CommerceError({ code: "INVALID_JOB", message: "A created operation requires a numeric protocol job ID." });
    const result = await this.pool.query<OperationRow>(`
      UPDATE erc8183_operations SET erc8183_job_id = $2
      WHERE id = $1 AND erc8183_job_id IS NULL
      RETURNING id, idempotency_key, request_digest, chain_id, commerce_contract, erc8183_job_id, operation_kind, signer_role, status, transaction_hash, block_number, block_hash, log_index, failure_code, operation_context, created_at_unix, updated_at_unix
    `, [input.operationId, jobId]);
    if (result.rows[0] !== undefined) return parseOperationRow(result.rows[0]);
    const existing = await this.get(input.operationId);
    if (existing !== null && existing.jobId === jobId) return existing;
    throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "The operation already has a different protocol job ID." });
  }

  /** Persist the Altana relay calls ID as soon as the SDK accepts an intent. */
  public async attachCallsId(input: { readonly operationId: string; readonly callsId: string }): Promise<Erc8183OperationRecord> {
    const callsId = assertHex(input.callsId, "relay calls ID");
    const result = await this.pool.query<OperationRow>(`
      UPDATE erc8183_operations
      SET operation_context = jsonb_set(COALESCE(operation_context, '{}'::jsonb), '{callsId}', to_jsonb($2::text), true)
      WHERE id = $1 AND (operation_context IS NULL OR operation_context->>'callsId' IS NULL)
      RETURNING id, idempotency_key, request_digest, chain_id, commerce_contract, erc8183_job_id, operation_kind, signer_role, status, transaction_hash, block_number, block_hash, log_index, failure_code, operation_context, created_at_unix, updated_at_unix
    `, [input.operationId, callsId]);
    if (result.rows[0] !== undefined) return parseOperationRow(result.rows[0]);
    const existing = await this.get(input.operationId);
    if (existing?.context?.callsId?.toLowerCase() === callsId.toLowerCase()) return existing;
    throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "The operation already has a different relay calls ID." });
  }

  public async markReceipt(input: {
    readonly operationId: string;
    readonly status: "confirmed" | "reverted";
    readonly transactionHash: string;
    readonly blockNumber: string;
    readonly blockHash: string;
    readonly logIndex?: number | null;
    readonly failureCode?: string | null;
    readonly nowUnix?: number;
  }): Promise<Erc8183OperationRecord> {
    const hash = normalizeHash(input.transactionHash, "transaction hash");
    const blockHash = normalizeHash(input.blockHash, "block hash");
    if (!/^(0|[1-9][0-9]*)$/u.test(input.blockNumber)) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The receipt block number is invalid." });
    const logIndex = input.logIndex ?? null;
    if (logIndex !== null && (!Number.isSafeInteger(logIndex) || logIndex < 0)) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The receipt log index is invalid." });
    const nowUnix = assertNow(input.nowUnix);
    const result = await this.pool.query<OperationRow>(`
      UPDATE erc8183_operations SET status = $2, transaction_hash = $3, block_number = $4, block_hash = $5, log_index = $6, failure_code = $7, updated_at_unix = $8
      WHERE id = $1 AND status IN ('submitted', 'unknown', 'manual_review')
      RETURNING id, idempotency_key, request_digest, chain_id, commerce_contract, erc8183_job_id, operation_kind, signer_role, status, transaction_hash, block_number, block_hash, log_index, failure_code, operation_context, created_at_unix, updated_at_unix
    `, [input.operationId, input.status, hash, input.blockNumber, blockHash, logIndex, safeFailureCode(input.failureCode), nowUnix]);
    if (result.rows[0] !== undefined) return parseOperationRow(result.rows[0]);
    const existing = await this.get(input.operationId);
    if (existing !== null && existing.status === input.status && existing.transactionHash === hash && existing.blockHash === blockHash) return existing;
    throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "The operation cannot accept this receipt from its current state." });
  }

  public async markUnknown(input: { readonly operationId: string; readonly failureCode?: string | null; readonly nowUnix?: number }): Promise<Erc8183OperationRecord> {
    const nowUnix = assertNow(input.nowUnix);
    const result = await this.pool.query<OperationRow>(`
      UPDATE erc8183_operations SET status = 'unknown', failure_code = $2, updated_at_unix = $3
      WHERE id = $1 AND status IN ('awaiting_signature', 'submitted')
      RETURNING id, idempotency_key, request_digest, chain_id, commerce_contract, erc8183_job_id, operation_kind, signer_role, status, transaction_hash, block_number, block_hash, log_index, failure_code, operation_context, created_at_unix, updated_at_unix
    `, [input.operationId, safeFailureCode(input.failureCode), nowUnix]);
    if (result.rows[0] !== undefined) return parseOperationRow(result.rows[0]);
    const existing = await this.get(input.operationId);
    if (existing !== null && existing.status === "unknown") return existing;
    throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "Only an unresolved operation can become unknown." });
  }

  public async reconcile(input: { readonly operationId: string; readonly status: "reconciled" | "manual_review"; readonly nowUnix?: number }): Promise<Erc8183OperationRecord> {
    const nowUnix = assertNow(input.nowUnix);
    const result = await this.pool.query<OperationRow>(`
      UPDATE erc8183_operations SET status = $2, updated_at_unix = $3
      WHERE id = $1 AND status IN ('unknown', 'manual_review', 'confirmed')
      RETURNING id, idempotency_key, request_digest, chain_id, commerce_contract, erc8183_job_id, operation_kind, signer_role, status, transaction_hash, block_number, block_hash, log_index, failure_code, operation_context, created_at_unix, updated_at_unix
    `, [input.operationId, input.status, nowUnix]);
    if (result.rows[0] !== undefined) return parseOperationRow(result.rows[0]);
    const existing = await this.get(input.operationId);
    if (existing !== null && existing.status === input.status) return existing;
    throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "Only an unresolved operation can be reconciled." });
  }

  public async markManualReview(input: { readonly operationId: string; readonly failureCode?: string | null; readonly nowUnix?: number }): Promise<Erc8183OperationRecord> {
    const nowUnix = assertNow(input.nowUnix);
    const result = await this.pool.query<OperationRow>(`
      UPDATE erc8183_operations SET status = 'manual_review', failure_code = $2, updated_at_unix = $3
      WHERE id = $1 AND status IN ('awaiting_signature', 'submitted', 'unknown', 'confirmed')
      RETURNING id, idempotency_key, request_digest, chain_id, commerce_contract, erc8183_job_id, operation_kind, signer_role, status, transaction_hash, block_number, block_hash, log_index, failure_code, operation_context, created_at_unix, updated_at_unix
    `, [input.operationId, safeFailureCode(input.failureCode), nowUnix]);
    if (result.rows[0] !== undefined) return parseOperationRow(result.rows[0]);
    const existing = await this.get(input.operationId);
    if (existing !== null && existing.status === "manual_review") return existing;
    throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "The operation cannot be moved to manual review from its current state." });
  }

  public async get(operationId: string): Promise<Erc8183OperationRecord | null> {
    const result = await this.pool.query<OperationRow>(`
      SELECT id, idempotency_key, request_digest, chain_id, commerce_contract, erc8183_job_id, operation_kind, signer_role, status, transaction_hash, block_number, block_hash, log_index, failure_code, operation_context, created_at_unix, updated_at_unix
      FROM erc8183_operations WHERE id = $1
    `, [operationId]);
    return result.rows[0] === undefined ? null : parseOperationRow(result.rows[0]);
  }

  public async getByIdempotencyKey(idempotencyKey: string): Promise<Erc8183OperationRecord | null> {
    const key = idempotencyKeySchema.parse(idempotencyKey);
    const result = await this.pool.query<OperationRow>(`
      SELECT id, idempotency_key, request_digest, chain_id, commerce_contract, erc8183_job_id, operation_kind, signer_role, status, transaction_hash, block_number, block_hash, log_index, failure_code, operation_context, created_at_unix, updated_at_unix
      FROM erc8183_operations WHERE idempotency_key = $1
    `, [key]);
    return result.rows[0] === undefined ? null : parseOperationRow(result.rows[0]);
  }

  /** Public read-model support for reload recovery; context is still parsed
   * server-side and never returned by the API projection. */
  public async listForJob(input: { readonly chainId: BscChainId; readonly commerceContract: string; readonly jobId: string }): Promise<readonly Erc8183OperationRecord[]> {
    const jobId = assertJobId(input.jobId);
    if (jobId === null) throw new CommerceError({ code: "INVALID_JOB", message: "A commerce operation read requires a protocol job ID." });
    const result = await this.pool.query<OperationRow>(`
      SELECT id, idempotency_key, request_digest, chain_id, commerce_contract, erc8183_job_id, operation_kind, signer_role, status, transaction_hash, block_number, block_hash, log_index, failure_code, operation_context, created_at_unix, updated_at_unix
      FROM erc8183_operations
      WHERE chain_id = $1 AND commerce_contract = $2 AND erc8183_job_id = $3
      ORDER BY created_at_unix ASC, id ASC
      LIMIT 128
    `, [input.chainId, normalizeAddress(input.commerceContract, "commerce contract"), jobId]);
    return result.rows.map(parseOperationRow);
  }

  public static requestDigest(value: unknown): string {
    assertPublicPayloadSafe(value, "operation");
    return canonicalSha256Hex(value);
  }
}
