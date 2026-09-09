import { describe, expect, it } from "vitest";
import { hiredJobMatches, resumedOperationMatches } from "./hired-presentation";
import type { BuyerJobSummary } from "./commerce-job-list";
import type { CommerceOperationStatusResponse } from "./commerce-contract";
describe("buyer history presentation guards", () => {
  it("requires canonical completion rather than application acceptance", () => {
    const job = { lifecycle: { status: "accepted", canonicalState: "funded" }, nextAction: "wait_for_agent" } as BuyerJobSummary;
    expect(hiredJobMatches(job, "Completed")).toBe(false);
    expect(hiredJobMatches(job, "In progress")).toBe(true);
    expect(hiredJobMatches({ ...job, lifecycle: { status: "settled", canonicalState: "completed" } }, "Completed")).toBe(true);
  });
  it("flags recovery and result review as attention", () => {
    for (const nextAction of ["reconcile_transaction", "review_result", "claim_refund"] as const) expect(hiredJobMatches({ nextAction } as BuyerJobSummary, "Needs attention")).toBe(true);
    expect(hiredJobMatches({ nextAction: "wait_for_agent" } as BuyerJobSummary, "Needs attention")).toBe(false);
  });
  it("rejects a different operation, job, registry or missing immutable binding", () => {
    const identity = { namespace: "eip155", chainId: 97, identityRegistry: `0x${"1".repeat(40)}`, agentId: "42" };
    const body = { operation: { operationId: "op" }, job: { job: { jobKey: { jobId: "10" }, providerBinding: { identity } } } } as CommerceOperationStatusResponse;
    const key = `eip155:97:${identity.identityRegistry}:42`;
    expect(resumedOperationMatches(body, "op", "10", key)).toBe(true);
    expect(resumedOperationMatches(body, "different", "10", key)).toBe(false);
    expect(resumedOperationMatches(body, "op", "11", key)).toBe(false);
    expect(resumedOperationMatches(body, "op", "10", key.replace("1111", "2222"))).toBe(false);
    expect(resumedOperationMatches({ ...body, job: { ...body.job!, job: { ...body.job!.job, providerBinding: null } } }, "op", "10", key)).toBe(false);
  });
});
