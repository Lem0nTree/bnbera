import { describe, expect, it } from "vitest";
import { assertOriginUnchanged, assertStateTransition, canTransition } from "../states.js";

describe("independent marketplace state axes", () => {
  it("allows a claim to become stale without changing verification", () => {
    expect(canTransition("claimStatus", "claimed", "stale")).toBe(true);
    expect(canTransition("verificationStatus", "verified", "degraded")).toBe(true);
    expect(canTransition("listingStatus", "published", "draft")).toBe(false);
  });

  it("rejects illegal transitions and origin changes", () => {
    expect(() => assertStateTransition("listingStatus", "delisted", "published")).toThrow();
    expect(() => assertOriginUnchanged("discovered", "created")).toThrow(/immutable/);
  });
});
