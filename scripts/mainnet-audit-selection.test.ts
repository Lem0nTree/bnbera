import { describe, expect, it } from "vitest";
import { selectPendingCandidates, selectPendingEvidence } from "./mainnet-audit-selection.ts";
describe("bounded supply continuation", () => {
  it("advances beyond completed high-ranked identities and failed endpoints", () => {
    const candidates = [{id: 1, score: 100, detail: {status: "completed"}}, {id: 2, score: 90, detail: {status: "failed"}}, {id: 3, score: 10}, {id: 4, score: 20}];
    expect(selectPendingCandidates(candidates, 2, c => c.score).map(c => c.id)).toEqual([4, 3]);
    expect(candidates.map(c => c.id)).toEqual([1, 2, 3, 4]);
    candidates[2]!.detail = {status: "completed"}; candidates[3]!.detail = {status: "completed"};
    expect(selectPendingCandidates(candidates, 2, c => c.score).map(c => c.id)).toEqual([2]);
  });
  it("rejects unbounded or invalid batch settings", () => {
    for (const cap of [0, 251, Number.NaN, 1.5]) expect(() => selectPendingCandidates([], cap, () => 0)).toThrow("INVALID_AUDIT_CAP");
  });
  it("reaches older provider results beyond an already-reviewed capped prefix", () => {
    const jobs = Array.from({length: 260}, (_, index) => ({id: String(index)}));
    const reviewed = jobs.slice(0, 250).map(job => job.id);
    expect(selectPendingEvidence(jobs, reviewed, 3).map(job => job.id)).toEqual(["250", "251", "252"]);
    expect(jobs).toHaveLength(260);
    expect(reviewed).toHaveLength(250);
    expect(selectPendingEvidence(jobs, jobs.map(job => job.id), 3)).toEqual([]);
    expect(() => selectPendingEvidence(jobs, [], 251)).toThrow("INVALID_AUDIT_CAP");
  });
});
