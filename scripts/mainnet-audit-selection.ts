/** Completed reviews never consume the next bounded batch. New identities get
 * a turn before failed reads are retried, so a bad endpoint cannot starve them. */
export function selectPendingCandidates<T extends { detail?: { status?: unknown } }>(
  candidates: readonly T[], limit: number, priority: (candidate: T) => number,
): T[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 250) throw new Error("INVALID_AUDIT_CAP");
  return candidates.filter(candidate => candidate.detail?.status !== "completed")
    .sort((a, b) => Number(a.detail?.status === "failed") - Number(b.detail?.status === "failed") || priority(b) - priority(a))
    .slice(0, limit);
}

/** Keep prior evidence out of the per-run budget, without mutating either input. */
export function selectPendingEvidence<T extends {id: string}>(candidates: readonly T[], reviewedIds: readonly string[], limit: number): T[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 250) throw new Error("INVALID_AUDIT_CAP");
  const reviewed = new Set(reviewedIds);
  return candidates.filter(candidate => !reviewed.has(candidate.id)).slice(0, limit);
}
