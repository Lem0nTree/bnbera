import { z } from "zod";

/** Buyer-attested inputs, not invented lending positions or a wallet scan. */
export const referenceBuyerTaskSchema = z.object({
  schemaVersion: z.literal("bnbera.reference.health-factor.user-task/v1"),
  collateralValueUsd: z.string().regex(/^(?:0|[1-9][0-9]{0,29})(?:\.[0-9]{1,18})?$/u),
  debtValueUsd: z.string().regex(/^(?:0|[1-9][0-9]{0,29})(?:\.[0-9]{1,18})?$/u).refine(v => Number(v) > 0),
  liquidationThresholdBps: z.number().int().min(1).max(10_000),
  observedAtUnix: z.number().int().positive()
}).strict();

export function parseReferenceBuyerTask(task: string) {
  if (task.length > 4096) throw new Error("REFERENCE_TASK_TOO_LARGE");
  return referenceBuyerTaskSchema.parse(JSON.parse(task) as unknown);
}
