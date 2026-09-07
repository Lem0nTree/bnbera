import { describe, expect, it } from "vitest";
import {
  PostgresErc8183OperationRepository,
  type Erc8183OperationQueryPool
} from "../src/index.js";

const HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

class FakeOperationPool implements Erc8183OperationQueryPool {
  private row: Record<string, unknown> | null = null;

  public async connect(): Promise<this & { readonly release: () => void }> {
    return Object.assign(this, { release: () => undefined });
  }

  public async query<T = Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<{ readonly rows: readonly T[] }> {
    if (text.includes("INSERT INTO erc8183_operations")) {
      if (this.row !== null) return { rows: [] };
      this.row = {
        id: values[0], idempotency_key: values[1], request_digest: values[2], chain_id: values[3], commerce_contract: values[4],
        erc8183_job_id: values[5] ?? null, operation_kind: values[6], signer_role: values[7], status: "awaiting_signature",
        transaction_hash: null, block_number: null, block_hash: null, log_index: null, failure_code: null,
        operation_context: values[8] ?? null, created_at_unix: values[9], updated_at_unix: values[9]
      };
      return { rows: [this.row as T] };
    }
    if (text.includes("SELECT") && text.includes("erc8183_operations")) {
      const matches = text.includes("idempotency_key = $1")
        ? this.row?.idempotency_key === values[0]
        : this.row?.id === values[0];
      return { rows: matches && this.row !== null ? [this.row as T] : [] };
    }
    if (text.includes("UPDATE erc8183_operations")) {
      if (this.row === null || this.row.id !== values[0]) return { rows: [] };
      if (text.includes("operation_context = jsonb_set")) {
        const context = (this.row.operation_context ?? {}) as Record<string, unknown>;
        if (text.includes("{dispatchClaimed}")) {
          if (this.row.status !== "awaiting_signature" || context.dispatchClaimed === true) return { rows: [] };
          this.row.operation_context = { ...context, dispatchClaimed: true };
        } else {
          if (context.callsId !== undefined && context.callsId !== null) return { rows: [] };
          this.row.operation_context = { ...context, callsId: values[1] };
        }
      } else if (text.includes("SET status = 'submitted'")) {
        if (!(this.row.status === "awaiting_signature" || (this.row.status === "unknown" && (this.row.transaction_hash === null || this.row.transaction_hash === values[1])))) return { rows: [] };
        this.row.status = "submitted";
        this.row.transaction_hash = values[1];
        this.row.updated_at_unix = values[2];
      } else if (text.includes("erc8183_job_id = $2")) {
        if (this.row.erc8183_job_id !== null) return { rows: [] };
        this.row.erc8183_job_id = values[1];
      } else if (text.includes("status = $2, transaction_hash")) {
        if (!["submitted", "unknown", "manual_review"].includes(String(this.row.status))) return { rows: [] };
        this.row.status = values[1];
        this.row.transaction_hash = values[2];
        this.row.block_number = values[3];
        this.row.block_hash = values[4];
        this.row.log_index = values[5];
        this.row.failure_code = values[6];
        this.row.updated_at_unix = values[7];
      } else if (text.includes("status = 'unknown'")) {
        if (!["awaiting_signature", "submitted"].includes(String(this.row.status))) return { rows: [] };
        this.row.status = "unknown";
        this.row.failure_code = values[1];
        this.row.updated_at_unix = values[2];
      } else if (text.includes("status = 'reverted'")) {
        if (!(this.row.status === "awaiting_signature" || this.row.status === "submitted" || this.row.status === "unknown") || this.row.transaction_hash !== null) return { rows: [] };
        this.row.status = "reverted";
        this.row.failure_code = values[1];
        this.row.updated_at_unix = values[2];
      } else if (text.includes("status = $2")) {
        if (!["unknown", "manual_review", "confirmed"].includes(String(this.row.status))) return { rows: [] };
        this.row.status = values[1];
        this.row.updated_at_unix = values[2];
      }
      return { rows: [this.row as T] };
    }
    throw new Error(`Unhandled SQL: ${text}`);
  }
}

describe("ERC-8183 operation persistence", () => {
  it("reserves idempotently, records relay identity, and never retries unknown outcomes", async () => {
    const repository = new PostgresErc8183OperationRepository(new FakeOperationPool());
    const input = {
      idempotencyKey: "hire-operation-1",
      requestDigest: "a".repeat(64),
      chainId: 97 as const,
      commerceContract: "0x1111111111111111111111111111111111111111",
      kind: "create" as const,
      signerRole: "client" as const,
      nowUnix: 2_000_000,
      context: { signerAddress: "0x5555555555555555555555555555555555555555", sdkAction: "hire" as const, parameters: { budgetAtomic: "1000" } }
    };
    const first = await repository.reserve(input);
    expect((await repository.reserve(input)).replayed).toBe(true);
    const withCalls = await repository.attachCallsId({ operationId: first.operation.operationId, callsId: HASH });
    expect(withCalls.context?.callsId).toBe(HASH);
    const submitted = await repository.markSubmitted({ operationId: first.operation.operationId, transactionHash: HASH, nowUnix: 2_000_001 });
    expect(submitted.status).toBe("submitted");
    const unknown = await repository.markUnknown({ operationId: first.operation.operationId, failureCode: "RPC_TIMEOUT", nowUnix: 2_000_002 });
    expect(unknown.status).toBe("unknown");
    const reconciled = await repository.reconcile({ operationId: first.operation.operationId, status: "reconciled", nowUnix: 2_000_003 });
    expect(reconciled.status).toBe("reconciled");
    await expect(repository.reserve({ ...input, requestDigest: "b".repeat(64) })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("persists a created protocol job ID exactly once", async () => {
    const repository = new PostgresErc8183OperationRepository(new FakeOperationPool());
    const { operation } = await repository.reserve({
      idempotencyKey: "hire-create-operation-1",
      requestDigest: "c".repeat(64),
      chainId: 97,
      commerceContract: "0x1111111111111111111111111111111111111111",
      kind: "create",
      signerRole: "client",
      nowUnix: 2_000_000
    });
    expect((await repository.attachJobId({ operationId: operation.operationId, jobId: "7" })).jobId).toBe("7");
    expect((await repository.attachJobId({ operationId: operation.operationId, jobId: "7" })).jobId).toBe("7");
    // The original hire request has no job ID; after confirmation the
    // persisted operation does. Repeating that same hire must replay rather
    // than conflict with the newly attached protocol identity.
    expect((await repository.reserve({
      idempotencyKey: "hire-create-operation-1",
      requestDigest: "c".repeat(64),
      chainId: 97,
      commerceContract: "0x1111111111111111111111111111111111111111",
      kind: "create",
      signerRole: "client",
      nowUnix: 2_000_001
    })).replayed).toBe(true);
  });

  it("claims one browser dispatch and treats relay failure without a hash as terminal", async () => {
    const repository = new PostgresErc8183OperationRepository(new FakeOperationPool());
    const { operation } = await repository.reserve({
      idempotencyKey: "single-browser-dispatch",
      requestDigest: "f".repeat(64),
      chainId: 97,
      commerceContract: "0x1111111111111111111111111111111111111111",
      kind: "create",
      signerRole: "client",
      nowUnix: 2_000_000,
      context: { signerAddress: "0x5555555555555555555555555555555555555555", sdkAction: "hire" }
    });
    const first = await repository.claimExternalDispatch({ operationId: operation.operationId });
    const replay = await repository.claimExternalDispatch({ operationId: operation.operationId });
    expect(first.claimed).toBe(true);
    expect(first.operation.context?.dispatchClaimed).toBe(true);
    expect(replay.claimed).toBe(false);
    const failed = await repository.markFailed({ operationId: operation.operationId, failureCode: "RELAY_FAILED_300", nowUnix: 2_000_001 });
    expect(failed.status).toBe("reverted");
    expect(failed.transactionHash).toBeNull();
  });

  it("binds an idempotency key to protocol identity and authenticated execution wallet", async () => {
    const repository = new PostgresErc8183OperationRepository(new FakeOperationPool());
    const input = {
      idempotencyKey: "identity-bound-operation-1",
      requestDigest: "d".repeat(64),
      chainId: 97 as const,
      commerceContract: "0x1111111111111111111111111111111111111111",
      jobId: "7",
      kind: "submit" as const,
      signerRole: "provider" as const,
      nowUnix: 2_000_000,
      context: { signerAddress: "0x4444444444444444444444444444444444444444", sdkAction: "submit" as const, parameters: { chainDeliverable: HASH } }
    };
    await repository.reserve(input);
    await expect(repository.reserve({ ...input, context: { ...input.context, signerAddress: "0x5555555555555555555555555555555555555555" } })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(repository.reserve({ ...input, jobId: "8" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("attaches a late transaction hash to the same unknown operation without reopening dispatch", async () => {
    const repository = new PostgresErc8183OperationRepository(new FakeOperationPool());
    const input = {
      idempotencyKey: "late-browser-evidence",
      requestDigest: "e".repeat(64),
      chainId: 97 as const,
      commerceContract: "0x1111111111111111111111111111111111111111",
      kind: "create" as const,
      signerRole: "client" as const,
      nowUnix: 2_000_000,
      context: { signerAddress: "0x5555555555555555555555555555555555555555", sdkAction: "hire" as const, parameters: { budgetAtomic: "1000" } }
    };
    const reserved = await repository.reserve(input);
    await repository.markUnknown({ operationId: reserved.operation.operationId, failureCode: "BROWSER_RELAY_PENDING", nowUnix: 2_000_001 });
    const submitted = await repository.markSubmitted({ operationId: reserved.operation.operationId, transactionHash: HASH, nowUnix: 2_000_002 });
    expect(submitted.status).toBe("submitted");
    expect(submitted.transactionHash).toBe(HASH);
  });
});
