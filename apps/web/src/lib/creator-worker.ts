import type { StudioReadiness } from "./creator-studio";
import { nativeStudioInitCommand } from "./creator-studio";

/**
 * Bounded, restart-safe progression. Every external operation must first save
 * its public identifier, then be reconciled before this function advances.
 */
export const creatorStages = [
  "validate", "authority_ready", "studio_scaffold_package", "deploy_reconcile", "erc8004_register_reconcile", "marketplace_publish"
] as const;
export type CreatorStage = (typeof creatorStages)[number];

export function nextCreatorStage(current: CreatorStage, readiness: StudioReadiness, authorityReady: boolean): CreatorStage | null {
  if (current === "validate") return authorityReady ? "authority_ready" : null;
  if (current === "authority_ready") return readiness.ready ? "studio_scaffold_package" : null;
  if (!readiness.ready) return null;
  return creatorStages[creatorStages.indexOf(current) + 1] ?? null;
}

export function externalOutcomePolicy(): "reconcile_before_retry" { return "reconcile_before_retry"; }

export interface CreatorStudioAdapter {
  /** Runs only after runtime integrity/config gates pass. Output is sanitized. */
  run(command: readonly string[]): Promise<{ readonly exitCode: number; readonly publicId: string | null; readonly output: string }>;
  reconcile(publicId: string): Promise<"confirmed" | "unknown" | "failed">;
}

export interface CreatorWorkerStore {
  load(deploymentId: string): Promise<{ readonly stage: CreatorStage; readonly runtimeName: string; readonly publicId: string | null }>;
  /** Saves identifier/output before advancing any external stage. */
  record(deploymentId: string, input: { readonly stage: CreatorStage; readonly publicId: string | null; readonly output: string }): Promise<void>;
}

export interface CreatorUriUpdateAdapter {
  submit(input: { readonly agentId: string; readonly uri: string; readonly uriIntentDigest: string }): Promise<{ readonly transactionHash: string | null; readonly status: "confirmed" | "unknown" | "rejected" }>;
  reconcile(transactionHash: string): Promise<"confirmed" | "unknown" | "rejected">;
}

export interface CreatorSwapAdapter {
  execute(executionId: string): Promise<{ readonly transactionHash: string | null; readonly status: "confirmed" | "unknown" | "rejected"; readonly quoteBlock: number; readonly calldataDigest: string; readonly balanceDeltaAtomic: string | null }>;
  reconcile(executionId: string): Promise<"confirmed" | "unknown" | "rejected">;
}

/** Persist quote/execution receipt facts before a swap is treated as complete. */
export async function runCreatorSwap(input: { readonly adapter: CreatorSwapAdapter; readonly priorExecutionId: string | null; readonly createExecution: () => Promise<{ executionId: string; quoteBlock: number; calldataDigest: string }>; readonly persist: (value: { executionId: string; transactionHash: string | null; quoteBlock: number; calldataDigest: string; balanceDeltaAtomic: string | null; status: string }) => Promise<void> }): Promise<"confirmed" | "unknown" | "rejected"> {
  if (input.priorExecutionId !== null) return input.adapter.reconcile(input.priorExecutionId);
  const intent = await input.createExecution(); // durable intent before broadcast
  await input.persist({ ...intent, transactionHash: null, balanceDeltaAtomic: null, status: "submitted" });
  const result = await input.adapter.execute(intent.executionId);
  await input.persist({ ...intent, ...result, status: result.status === "unknown" ? "unknown" : result.status });
  return result.status;
}

/**
 * Fake-adapter/preparation seam only. It is not wired to a live worker: a
 * real Studio spawn must first persist a provider operation ID that the
 * provider can reconcile after process loss.
 */
export async function runCreatorStudioStep(input: { readonly deploymentId: string; readonly readiness: StudioReadiness; readonly store: CreatorWorkerStore; readonly studio: CreatorStudioAdapter }): Promise<CreatorStage | null> {
  const current = await input.store.load(input.deploymentId);
  if (!input.readiness.ready || current.stage !== "studio_scaffold_package") return null;
  if (current.publicId !== null) {
    const outcome = await input.studio.reconcile(current.publicId);
    if (outcome !== "confirmed") return null;
    await input.store.record(input.deploymentId, { stage: "deploy_reconcile", publicId: current.publicId, output: "reconciled" });
    return "deploy_reconcile";
  }
  const result = await input.studio.run(nativeStudioInitCommand(current.runtimeName));
  // Persist even an unknown/no-id result; retries must reconcile if an ID exists.
  await input.store.record(input.deploymentId, { stage: "studio_scaffold_package", publicId: result.publicId, output: result.output.slice(0, 500) });
  if (result.exitCode !== 0 || result.publicId === null) return null;
  await input.store.record(input.deploymentId, { stage: "deploy_reconcile", publicId: result.publicId, output: "studio scaffold created" });
  return "deploy_reconcile";
}
