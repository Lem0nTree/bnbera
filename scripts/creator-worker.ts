/**
 * One bounded Creator worker tick. A scheduler may invoke this command
 * repeatedly; the database claim and persisted Studio intents make retries
 * reconcile-only after a process interruption.
 */
import { fileURLToPath } from "node:url";
import { isAbsolute, resolve } from "node:path";
import { creatorAuthorityResolver, creatorRepository } from "../apps/web/src/lib/creator-server.ts";
import { createCreatorWorkerComposition, CreatorWorkerCompositionError, type CreatorWorkerRun } from "../apps/web/src/lib/creator-composition.ts";
import { nativeStudioWorkspaceTempDirectory, readCreatorStandardsLock, studioReadiness } from "../apps/web/src/lib/creator-studio.ts";
import { CreatorAuthorityError } from "../apps/web/src/lib/creator-authority-runtime.ts";
import { CreatorRepositoryError, type CreatorDeploymentBinding, type CreatorRepository } from "../apps/web/src/lib/creator-repository.ts";
import { getCommerceAuthDatabasePool } from "../apps/web/src/lib/commerce-auth.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type CreatorWorkerTick =
  | { readonly outcome: "idle" }
  | (CreatorWorkerRun & { readonly outcome: "advanced" | "waiting" });

type WorkerComposition = Pick<ReturnType<typeof createCreatorWorkerComposition>, "runOnce">;

/** Small seam used by tests and by a scheduler that already has a claim. */
export async function runCreatorWorkerOnce(input: {
  readonly composition: WorkerComposition;
  readonly deploymentId?: string;
  readonly claimNext?: () => Promise<CreatorDeploymentBinding | null>;
}): Promise<CreatorWorkerTick> {
  const deploymentId = input.deploymentId ?? (input.claimNext === undefined ? null : (await input.claimNext())?.deploymentId ?? null);
  if (deploymentId === null) return { outcome: "idle" };
  const run = await input.composition.runOnce(deploymentId);
  return run;
}

export async function runCreatorWorkerFromEnvironment(): Promise<CreatorWorkerTick> {
  if (process.env.CREATOR_WORKER_ENABLED !== "true") throw new CreatorRepositoryError("CREATOR_WORKER_DISABLED", "Creator worker is disabled.");
  const deploymentId = process.env.CREATOR_DEPLOYMENT_ID;
  if (deploymentId !== undefined && !uuidPattern.test(deploymentId)) {
    throw new CreatorRepositoryError("CREATOR_WORKER_CONFIGURATION_INVALID", "Creator worker deployment id is invalid.");
  }
  const workspaceParent = process.env.CREATOR_STUDIO_WORKSPACE_ROOT;
  if (workspaceParent === undefined || !isAbsolute(workspaceParent)) {
    throw new CreatorRepositoryError("CREATOR_WORKER_CONFIGURATION_INVALID", "Creator worker workspace is invalid.");
  }
  // Keep pnpm/Studio scratch files on the configured private workspace
  // filesystem; host `/tmp` can be quota-limited even when the repo volume has
  // capacity. The native adapter repeats this boundary for direct callers.
  const workspaceTempDirectory = nativeStudioWorkspaceTempDirectory(resolve(workspaceParent));
  process.env.TMPDIR = workspaceTempDirectory;
  process.env.TMP = workspaceTempDirectory;
  process.env.TEMP = workspaceTempDirectory;

  const repository: CreatorRepository = creatorRepository();
  const pool = getCommerceAuthDatabasePool();
  const composition = createCreatorWorkerComposition({
    repository,
    pool,
    workspaceParent,
    readiness: studioReadiness(readCreatorStandardsLock()),
    // creatorAuthorityResolver is T6's registered composition when enabled;
    // without it, deployment fails closed before an intent is written.
    authorityResolver: creatorAuthorityResolver(),
  });
  return runCreatorWorkerOnce({
    composition,
    deploymentId,
    claimNext: () => repository.claimNextQueuedDeployment(),
  });
}

function safeErrorCode(error: unknown): string {
  if (error instanceof CreatorRepositoryError || error instanceof CreatorAuthorityError || error instanceof CreatorWorkerCompositionError) return error.code;
  return "CREATOR_WORKER_FAILED";
}

async function main(): Promise<void> {
  const result = await runCreatorWorkerFromEnvironment();
  // Only deployment/stage state is public. Authority descriptors, session
  // bytes, database errors, and Studio output never cross this boundary.
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({ code: safeErrorCode(error) })}\n`);
    process.exitCode = 1;
  });
}
