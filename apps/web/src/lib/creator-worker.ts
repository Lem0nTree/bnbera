import type { StudioReadiness } from "./creator-studio";
import { join } from "node:path";
import { nativeStudioDeployCommand, nativeStudioStatusCommand, type StudioDeploymentRecord } from "./creator-studio";

/**
 * Bounded, restart-safe progression. Every external operation must first save
 * its public identifier, then be reconciled before this function advances.
 */
export const creatorStages = [
  "validate", "authority_ready", "studio_scaffold_package", "deploy_reconcile", "erc8004_register_reconcile", "marketplace_publish", "g2_funded_job_reconcile", "g2_activation_reconcile", "completed"
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
  /** Read-only exact-artifact check used after a worker crash. */
  inspect(workspaceParent: string, runtimeName: string): Promise<"STUDIO_TEMPLATE_READY" | "STUDIO_TEMPLATE_MISMATCH">;
  /** Copies only the checked-in immutable artifact into its deterministic workspace. */
  materialize(workspaceParent: string, runtimeName: string): Promise<"STUDIO_TEMPLATE_READY" | "STUDIO_TEMPLATE_MISMATCH">;
  /** Runs only after runtime integrity/config gates pass. Output is sanitized. */
  run(command: readonly string[], input: { readonly cwd: string }): Promise<{ readonly exitCode: number; readonly reasonCode: "STUDIO_COMMAND_OK" | "STUDIO_COMMAND_FAILED" | "STUDIO_COMMAND_TIMEOUT" }>;
  /** Must run the pinned status command and return only its validated public fields. */
  status(command: readonly string[]): Promise<StudioDeploymentRecord | null>;
  /** A status record alone is not proof that the deployed A2A runtime is live. */
  verifyEndpoint(endpoint: string): Promise<boolean>;
}

export interface CreatorWorkerStore {
  load(deploymentId: string): Promise<{ readonly stage: CreatorStage; readonly runtimeName: string; readonly projectRoot: string; readonly publicId: string | null; readonly endpoint: string | null }>;
  /** Saves identifier/output before advancing any external stage. */
  record(deploymentId: string, input: { readonly stage: CreatorStage; readonly publicId: string | null; readonly endpoint?: string | null; readonly operationId?: string; readonly reasonCode: string }): Promise<void>;
  /** Durable intent event before `bag deploy` is spawned. */
  recordIntent(deploymentId: string, input: { readonly command: readonly string[] }): Promise<"claimed" | "reconcile">;
  /** Conditional persistent claim prevents two workers from scaffolding one workspace. */
  recordScaffoldIntent(deploymentId: string): Promise<"claimed" | "reconcile">;
}

export interface CreatorUriUpdateAdapter {
  submit(input: { readonly agentId: string; readonly uri: string; readonly uriIntentDigest: string }): Promise<{ readonly transactionHash: string | null; readonly status: "confirmed" | "unknown" | "rejected" }>;
  reconcile(transactionHash: string): Promise<"confirmed" | "unknown" | "rejected">;
}

export type CreatorHandoffOutcome = { readonly status: "confirmed" | "pending" | "failed"; readonly operationId: string };
/** Existing G1/G2 services own these writes and must return/reconcile a durable public operation ID. */
export interface CreatorLifecycleHandoffs {
  registerAndVerify(input: { readonly deploymentId: string; readonly endpoint: string }): Promise<CreatorHandoffOutcome>;
  publishMarketplace(input: { readonly deploymentId: string }): Promise<CreatorHandoffOutcome>;
  /** Existing G2 verifier must prove a funded job before the created provider is activated. */
  verifyFundedJob(input: { readonly deploymentId: string; readonly endpoint: string }): Promise<CreatorHandoffOutcome>;
  activateCommerce(input: { readonly deploymentId: string }): Promise<CreatorHandoffOutcome>;
}

function isConfirmed(outcome: CreatorHandoffOutcome): boolean { return outcome.status === "confirmed" && outcome.operationId.trim().length > 0; }

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
export async function runCreatorStudioStep(input: { readonly deploymentId: string; readonly readiness: StudioReadiness; readonly store: CreatorWorkerStore; readonly studio: CreatorStudioAdapter; readonly recheckAuthority: () => Promise<void>; readonly handoffs?: CreatorLifecycleHandoffs }): Promise<CreatorStage | null> {
  const current = await input.store.load(input.deploymentId);
  if (!input.readiness.ready) return null;
  if (current.stage === "studio_scaffold_package") {
    const claim = await input.store.recordScaffoldIntent(input.deploymentId);
    // A prior process may have died after its durable intent. Inspection is
    // deliberately read-only: a reconciler must never create a workspace.
    if (claim === "reconcile") {
      const inspected = await input.studio.inspect(current.projectRoot, current.runtimeName);
      await input.store.record(input.deploymentId, { stage: "studio_scaffold_package", publicId: null, reasonCode: inspected });
      if (inspected !== "STUDIO_TEMPLATE_READY") return null;
      await input.store.record(input.deploymentId, { stage: "deploy_reconcile", publicId: null, reasonCode: "STUDIO_TEMPLATE_RECONCILED" });
      return "deploy_reconcile";
    }
    const materialized = await input.studio.materialize(current.projectRoot, current.runtimeName);
    await input.store.record(input.deploymentId, { stage: "studio_scaffold_package", publicId: null, reasonCode: materialized });
    if (materialized !== "STUDIO_TEMPLATE_READY") return null;
    await input.store.record(input.deploymentId, { stage: "deploy_reconcile", publicId: null, reasonCode: "STUDIO_TEMPLATE_READY" });
    return "deploy_reconcile";
  }
  if (current.stage === "erc8004_register_reconcile") {
    if (current.endpoint === null || input.handoffs === undefined) return null;
    const result = await input.handoffs.registerAndVerify({ deploymentId: input.deploymentId, endpoint: current.endpoint });
    if (!isConfirmed(result)) { await input.store.record(input.deploymentId, { stage: current.stage, publicId: current.publicId, endpoint: current.endpoint, operationId: result.operationId, reasonCode: "ERC8004_BROWSER_SIGNATURE_OR_FINALIZED_READ_PENDING" }); return null; }
    await input.store.record(input.deploymentId, { stage: "marketplace_publish", publicId: current.publicId, endpoint: current.endpoint, operationId: result.operationId, reasonCode: "G1_REGISTRATION_CONFIRMED" });
    return "marketplace_publish";
  }
  if (current.stage === "marketplace_publish") {
    if (input.handoffs === undefined) return null;
    const publication = await input.handoffs.publishMarketplace({ deploymentId: input.deploymentId });
    if (!isConfirmed(publication)) { await input.store.record(input.deploymentId, { stage: current.stage, publicId: current.publicId, endpoint: current.endpoint, operationId: publication.operationId, reasonCode: "G1_PUBLICATION_RECONCILIATION_PENDING" }); return null; }
    await input.store.record(input.deploymentId, { stage: "g2_funded_job_reconcile", publicId: current.publicId, endpoint: current.endpoint, operationId: publication.operationId, reasonCode: "G1_PUBLICATION_CONFIRMED" });
    return "g2_funded_job_reconcile";
  }
  if (current.stage === "g2_funded_job_reconcile") {
    if (input.handoffs === undefined || current.endpoint === null) return null;
    const funded = await input.handoffs.verifyFundedJob({ deploymentId: input.deploymentId, endpoint: current.endpoint });
    if (!isConfirmed(funded)) { await input.store.record(input.deploymentId, { stage: current.stage, publicId: current.publicId, endpoint: current.endpoint, operationId: funded.operationId, reasonCode: "G2_FUNDED_JOB_RECONCILIATION_PENDING" }); return null; }
    await input.store.record(input.deploymentId, { stage: "g2_activation_reconcile", publicId: current.publicId, endpoint: current.endpoint, operationId: funded.operationId, reasonCode: "G2_FUNDED_JOB_CONFIRMED" });
    return "g2_activation_reconcile";
  }
  if (current.stage === "g2_activation_reconcile") {
    if (input.handoffs === undefined || current.endpoint === null) return null;
    const activation = await input.handoffs.activateCommerce({ deploymentId: input.deploymentId });
    if (!isConfirmed(activation)) { await input.store.record(input.deploymentId, { stage: current.stage, publicId: current.publicId, endpoint: current.endpoint, operationId: activation.operationId, reasonCode: "G2_ACTIVATION_OFFER_RECONCILIATION_PENDING" }); return null; }
    await input.store.record(input.deploymentId, { stage: "completed", publicId: current.publicId, endpoint: current.endpoint, operationId: activation.operationId, reasonCode: "G1_PUBLICATION_G2_FUNDED_JOB_AND_ACTIVATION_CONFIRMED" });
    return "completed";
  }
  if (current.stage !== "deploy_reconcile") return null;
  if (current.publicId !== null) {
    const recorded = await input.studio.status(nativeStudioStatusCommand(join(current.projectRoot, current.runtimeName)));
    if (recorded?.deploymentId !== current.publicId) return null;
    if (recorded.endpoint === null || !await input.studio.verifyEndpoint(recorded.endpoint)) {
      await input.store.record(input.deploymentId, { stage: "deploy_reconcile", publicId: current.publicId, endpoint: current.endpoint, reasonCode: "STUDIO_ENDPOINT_UNVERIFIED" });
      return null;
    }
    await input.store.record(input.deploymentId, { stage: "erc8004_register_reconcile", publicId: current.publicId, endpoint: recorded.endpoint, reasonCode: "STUDIO_DEPLOYMENT_CONFIRMED" });
    return "erc8004_register_reconcile";
  }
  const projectRoot = join(current.projectRoot, current.runtimeName);
  const command = nativeStudioDeployCommand(projectRoot);
  const claim = await input.store.recordIntent(input.deploymentId, { command });
  // A previous process persisted an intent but died before recording an ID.
  // Status is authoritative; never send a second deploy in that case.
  if (claim === "reconcile") {
    const recorded = await input.studio.status(nativeStudioStatusCommand(projectRoot));
    await input.store.record(input.deploymentId, { stage: "deploy_reconcile", publicId: recorded?.deploymentId ?? null, endpoint: recorded?.endpoint ?? null, reasonCode: recorded === null ? "STUDIO_DEPLOYMENT_UNKNOWN" : "STUDIO_DEPLOYMENT_RECORDED" });
    return null;
  }
  // T6 may have revoked or expired between queueing and this external write.
  // Recheck at the final possible point; no deploy is sent if it fails.
  await input.recheckAuthority();
  const result = await input.studio.run(command, { cwd: projectRoot });
  // `deploy` has no stable JSON output. The documented status JSON is the
  // only source for provider ID/endpoint and is queried even after a timeout.
  const recorded = await input.studio.status(nativeStudioStatusCommand(projectRoot));
  const endpointVerified = recorded !== null && recorded.endpoint !== null && await input.studio.verifyEndpoint(recorded.endpoint);
  await input.store.record(input.deploymentId, { stage: "deploy_reconcile", publicId: recorded?.deploymentId ?? null, endpoint: endpointVerified ? recorded?.endpoint ?? null : null, reasonCode: recorded === null ? result.reasonCode : endpointVerified ? "STUDIO_DEPLOYMENT_RECORDED" : "STUDIO_ENDPOINT_UNVERIFIED" });
  return null;
}
