import { describe, expect, it } from "vitest";
import {
  commerceAuthorityBoundaryError,
  createProductionCommerceComposition,
  getCommerceComposition,
  T4_AUTHORITY_BOUNDARY_BLOCKER,
  type CommerceAuthorityResolver
} from "./commerce-server";
import { GET as statusRoute } from "../../app/api/commerce/[jobId]/route";

const resolver: CommerceAuthorityResolver = {
  resolve: async () => {
    throw new Error("test resolver is not invoked by constructor checks");
  }
};

describe("T4 commerce server composition", () => {
  it("exposes the exact blocker when the web app has no auth/authority boundary", async () => {
    await expect(getCommerceComposition()).rejects.toMatchObject({
      code: "COMMERCE_DISABLED",
      message: expect.stringContaining(T4_AUTHORITY_BOUNDARY_BLOCKER),
      nextAction: "configure_auth_boundary"
    });
    expect(commerceAuthorityBoundaryError().message).toContain(T4_AUTHORITY_BOUNDARY_BLOCKER);
  });

  it("returns the blocker through the status API without leaking server internals", async () => {
    const response = await statusRoute(new Request("http://localhost/api/commerce/7"), { params: Promise.resolve({ jobId: "7" }) });
    const body = await response.json() as { readonly status: string; readonly error: { readonly code: string; readonly message: string } };
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ status: "error", error: { code: "COMMERCE_DISABLED" } });
    expect(body.error.message).toContain(T4_AUTHORITY_BOUNDARY_BLOCKER);
    expect(body.error.message).not.toMatch(/private.?key|password|secret|DATABASE_URL/iu);
  });

  it("requires an authoritative standards-lock snapshot before constructing a writer", () => {
    expect(() => createProductionCommerceComposition({
      standardsLock: null,
      pin: {} as never,
      pool: {} as never,
      authorityResolver: resolver
    })).toThrowError(/authoritative standards\.lock snapshot/i);
  });

  it("requires a server authority resolver even when lock and DB options are supplied", () => {
    expect(() => createProductionCommerceComposition({
      standardsLock: {},
      pin: {} as never,
      pool: {} as never,
      authorityResolver: undefined as never
    })).toThrowError(new RegExp(T4_AUTHORITY_BOUNDARY_BLOCKER));
  });
});
