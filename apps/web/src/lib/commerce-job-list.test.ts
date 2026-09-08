import { describe, expect, it } from "vitest";
import type { Erc8183OperationQueryPool } from "@bnbera/agent-commerce";
import {
  commerceJobsMaximumLimit,
  listBuyerJobs,
  parseCommerceJobsQuery
} from "./commerce-job-list";

const BUYER_USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const VERSION_ID = "00000000-0000-4000-8000-000000000003";
const IDENTITY = {
  namespace: "eip155",
  chainId: 97,
  identityRegistry: "0x1111111111111111111111111111111111111111",
  agentId: "42"
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    commerce_job_id: "00000000-0000-4000-8000-000000000010",
    parent_protocol_job_id: "draft:00000000-0000-4000-8000-000000000010",
    quote: {
      identity: IDENTITY,
      agentVersionId: VERSION_ID,
      agentVersion: 2,
      paymentToken: "0x2222222222222222222222222222222222222222",
      paymentDecimals: 18,
      tokenSymbol: "U",
      chainId: 97,
      expiresAt: "2026-09-08T13:00:00.000Z"
    },
    price_atomic: "1000",
    parent_status: "draft",
    created_at: "2026-09-08T10:00:00.000Z",
    updated_at: "2026-09-08T12:00:00.000Z",
    canonical_protocol_job_id: null,
    canonical_state: null,
    canonical_chain_id: null,
    payment_token: null,
    payment_decimals: null,
    expires_at: null,
    provider_binding: null,
    refund_transaction_hash: null,
    result_state: null,
    review_id: null,
    agent_name: "Health Sentinel",
    agent_slug: "health-sentinel",
    operation_id: null,
    operation_status: null,
    operation_kind: null,
    operation_transaction_hash: null,
    operation_updated_at_unix: null,
    ...overrides
  };
}

function pool(rows: readonly ReturnType<typeof row>[], capture: { values: readonly unknown[] | undefined; sql?: string } = { values: undefined }): Erc8183OperationQueryPool {
  return {
    async query<T = Record<string, unknown>>(text: string, values?: readonly unknown[]) {
      capture.sql = text;
      capture.values = values;
      return { rows: rows as readonly T[] };
    },
    async connect() {
      throw new Error("list is read-only and must not open a transaction");
    }
  };
}

describe("authenticated buyer jobs list", () => {
  it("accepts only bounded pagination parameters and rejects buyer lookup input", () => {
    expect(parseCommerceJobsQuery("https://example.test/api/commerce/jobs")).toEqual({ limit: 20 });
    expect(parseCommerceJobsQuery(`https://example.test/api/commerce/jobs?limit=${commerceJobsMaximumLimit}`)).toEqual({ limit: commerceJobsMaximumLimit });
    expect(() => parseCommerceJobsQuery("https://example.test/api/commerce/jobs?limit=51")).toThrow(/invalid/i);
    expect(() => parseCommerceJobsQuery("https://example.test/api/commerce/jobs?buyer=0x1234")).toThrow(/unsupported/i);
  });

  it("passes only the authenticated user to the SQL ownership predicate", async () => {
    const capture: { values: readonly unknown[] | undefined; sql?: string } = { values: undefined };
    const result = await listBuyerJobs(pool([row()], capture), BUYER_USER_ID, { limit: 20 }, new Date("2026-09-08T12:30:00.000Z"));
    expect(capture.sql).toContain("WHERE c.buyer_user_id = $1");
    expect(capture.sql).toContain('ORDER BY c."updatedAt" DESC, c.id DESC');
    expect(capture.values?.[0]).toBe(BUYER_USER_ID);
    expect(capture.values).not.toContain(OTHER_USER_ID);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({
      commerceJobId: "00000000-0000-4000-8000-000000000010",
      protocolJobId: null,
      agent: { identity: IDENTITY, versionId: VERSION_ID, version: 2, name: "Health Sentinel", slug: "health-sentinel" },
      nextAction: "review_quote"
    });
    expect(JSON.stringify(result)).not.toContain("task");
  });

  it("caps pages, returns a deterministic cursor, and applies it to the next query", async () => {
    const rows = [
      row({ commerce_job_id: "00000000-0000-4000-8000-000000000011", updated_at: "2026-09-08T12:01:00.000Z" }),
      row({ commerce_job_id: "00000000-0000-4000-8000-000000000010", updated_at: "2026-09-08T12:00:00.000Z" })
    ];
    const first = await listBuyerJobs(pool(rows), BUYER_USER_ID, { limit: 1 });
    expect(first.jobs.map((job) => job.commerceJobId)).toEqual(["00000000-0000-4000-8000-000000000011"]);
    expect(first.nextCursor).not.toBeNull();

    const capture: { values: readonly unknown[] | undefined } = { values: undefined };
    await listBuyerJobs(pool([], capture), BUYER_USER_ID, { limit: 1, cursor: first.nextCursor! });
    expect(capture.values?.slice(1, 3)).toEqual(["2026-09-08T12:01:00.000Z", "00000000-0000-4000-8000-000000000011"]);
  });

  it("preserves canonical and reconciliation states when selecting a safe next action", async () => {
    const unknown = row({
      parent_status: "funded",
      canonical_protocol_job_id: "99",
      canonical_state: "funded",
      canonical_chain_id: 97,
      payment_token: "0x2222222222222222222222222222222222222222",
      payment_decimals: 18,
      expires_at: "2026-09-09T12:00:00.000Z",
      provider_binding: { identity: IDENTITY, agentVersionId: VERSION_ID, agentVersion: 2 },
      operation_id: "00000000-0000-4000-8000-000000000099",
      operation_status: "unknown",
      operation_kind: "fund",
      operation_transaction_hash: `0x${"a".repeat(64)}`,
      operation_updated_at_unix: 1_788_868_800
    });
    const result = await listBuyerJobs(pool([unknown]), BUYER_USER_ID, { limit: 20 });
    expect(result.jobs[0]).toMatchObject({
      lifecycle: { status: "funded", canonicalState: "funded" },
      latestOperation: { status: "unknown", step: "fund" },
      nextAction: "reconcile_transaction"
    });
  });

  it("never exposes rows omitted by the buyer-scoped repository query", async () => {
    const result = await listBuyerJobs(pool([]), BUYER_USER_ID, { limit: 20 });
    expect(result.jobs).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });
});
