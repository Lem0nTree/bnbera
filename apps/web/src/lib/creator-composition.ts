import type { Pool } from "pg";
import { creatorAuthorityResolver } from "./creator-server";
import type { CreatorRuntimeAuthorityResolver } from "./creator-authority-runtime";
import { createCreatorLifecycleHandoffs } from "./creator-handoffs";
import { nativeStudioProcessAdapter, type StudioReadiness } from "./creator-studio";
import {
  runCreatorStudioStep,
  type CreatorLifecycleHandoffs,
  type CreatorStage,
  type CreatorStudioAdapter,
  type CreatorWorkerStore,
} from "./creator-worker";
import type { CreatorDeploymentBinding, CreatorRepository } from "./creator-repository";

type WorkerRepository = Pick<CreatorRepository, "workerStore" | "workerDeploymentBinding">;

export type CreatorWorkerCompositionOptions = {
  readonly repository: WorkerRepository;
  readonly pool: Pool;
  readonly workspaceParent: string;
  readonly readiness: StudioReadiness;
  readonly studio?: CreatorStudioAdapter;
  readonly handoffs?: CreatorLifecycleHandoffs;
  /** T6 supplies this in the managed composition; the default is fail-closed. */
  readonly authorityResolver?: CreatorRuntimeAuthorityResolver;
};

export type CreatorWorkerRun = {
  readonly deploymentId: string;
  readonly previousStage: CreatorStage;
  readonly nextStage: CreatorStage | null;
  readonly outcome: "advanced" | "waiting";
};

export class CreatorWorkerCompositionError extends Error {
  constructor(readonly code: "CREATOR_DEPLOYMENT_BINDING_MISSING" | "CREATOR_CONFIG_DIGEST_MISMATCH", message: string) {
    super(message);
  }
}

/**
 * Composes one bounded, restart-safe Creator worker step. Dependencies are
 * injectable so tests never need a database, Studio process, or authority
 * secret. The default authority resolver deliberately remains fail-closed
 * until the reviewed T6 gateway/sink is registered by the host.
 */
export function createCreatorWorkerComposition(options: CreatorWorkerCompositionOptions) {
  const studio = options.studio ?? nativeStudioProcessAdapter();
  const handoffs = options.handoffs ?? createCreatorLifecycleHandoffs(options.pool);
  const authorityResolver = options.authorityResolver ?? creatorAuthorityResolver();

  async function runOnce(deploymentId: string): Promise<CreatorWorkerRun> {
    const store: CreatorWorkerStore = options.repository.workerStore(options.workspaceParent);
    const current = await store.load(deploymentId);
    const binding: CreatorDeploymentBinding | null = await options.repository.workerDeploymentBinding(deploymentId);
    if (binding === null || binding.deploymentId !== deploymentId) {
      throw new CreatorWorkerCompositionError("CREATOR_DEPLOYMENT_BINDING_MISSING", "Creator deployment has no current authority binding.");
    }
    if (current.configurationDigest === undefined || current.configurationDigest !== binding.configurationDigest) {
      throw new CreatorWorkerCompositionError("CREATOR_CONFIG_DIGEST_MISMATCH", "Creator deployment configuration is not bound to its queued digest.");
    }
    const nextStage = await runCreatorStudioStep({
      deploymentId,
      readiness: options.readiness,
      store,
      studio,
      handoffs,
      recheckAuthority: async () => {
        await authorityResolver.requireRuntimeAuthority({
          userId: binding.userId,
          draftId: binding.draftId,
          authorityId: binding.authorityId,
        });
      },
    });
    return {
      deploymentId,
      previousStage: current.stage,
      nextStage,
      outcome: nextStage === null ? "waiting" : "advanced",
    };
  }

  return { runOnce };
}
