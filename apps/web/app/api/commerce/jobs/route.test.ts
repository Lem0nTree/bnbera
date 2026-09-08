import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireIdentity: vi.fn(),
  getPool: vi.fn(),
  list: vi.fn()
}));

vi.mock("@/lib/commerce-auth", () => ({
  requireAuthenticatedCommerceIdentity: mocks.requireIdentity,
  getCommerceAuthDatabasePool: mocks.getPool
}));
vi.mock("@/lib/commerce-job-list", async (original) => {
  const actual = await original<typeof import("@/lib/commerce-job-list")>();
  return { ...actual, listBuyerJobs: mocks.list };
});

import { AppError } from "@bnbera/config";
import { GET } from "./route";

describe("GET /api/commerce/jobs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when no validated session exists", async () => {
    mocks.requireIdentity.mockRejectedValue(new AppError({
      code: "AUTH_REQUIRED",
      safeMessage: "Connect and sign in with your wallet to continue.",
      requestId: "req_auth_test",
      nextAction: "sign_in"
    }));
    const response = await GET(new Request("https://example.test/api/commerce/jobs"));
    expect(response.status).toBe(401);
    expect(mocks.getPool).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("derives list ownership exclusively from the validated server session", async () => {
    const userId = "00000000-0000-4000-8000-000000000001";
    const database = { query: vi.fn() };
    mocks.requireIdentity.mockResolvedValue({ authenticated: true, userId, requesterAddress: "0x1111111111111111111111111111111111111111", chainId: 97, sessionId: "session-1" });
    mocks.getPool.mockReturnValue(database);
    mocks.list.mockResolvedValue({ contractVersion: "bnbera.erc8183-commerce/v1", status: "ready", jobs: [], nextCursor: null, error: null });
    const response = await GET(new Request("https://example.test/api/commerce/jobs?limit=5"));
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(database, userId, { limit: 5 });
  });
});
