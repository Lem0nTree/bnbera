import { describe, expect, it } from "vitest";
import { evidenceSealLabel, evidenceVersionLabel } from "./agent-detail-view";

describe("agent detail Greenfield evidence labels", () => {
  it("labels evidence for the current agent version without a historical qualifier", () => {
    expect(evidenceVersionLabel({ version: 3 }, 3)).toBe("Agent version 3");
  });

  it("labels a verified older artifact as a historical snapshot", () => {
    expect(evidenceVersionLabel({ version: 2 }, 3)).toBe("Agent version 2 · historical snapshot");
  });

  it("explains a confirmed seal when its transaction hash is unavailable", () => {
    expect(evidenceSealLabel({ status: "verified", sealTransactionHash: null }))
      .toBe("Seal confirmed; transaction hash unavailable.");
  });

  it("does not claim a seal for pending or unavailable evidence", () => {
    expect(evidenceSealLabel({ status: "pending", sealTransactionHash: null }))
      .toBe("Seal not confirmed");
  });
});
