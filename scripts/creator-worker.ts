/** One-deployment, opt-in Creator progression.  It is intentionally not cron:
 * deployment needs an explicit operator-selected persisted ID and never scans
 * drafts or enables itself from a Studio login. */
import { creatorAuthorityResolver, creatorRepository } from "../apps/web/src/lib/creator-server.ts";
import { createCreatorLifecycleHandoffs } from "../apps/web/src/lib/creator-handoffs.ts";
import { nativeStudioProcessAdapter, readCreatorStandardsLock, studioReadiness } from "../apps/web/src/lib/creator-studio.ts";
import { runCreatorStudioStep } from "../apps/web/src/lib/creator-worker.ts";
import { getCommerceAuthDatabasePool } from "../apps/web/src/lib/commerce-auth.ts";

async function main(): Promise<void> {
  if (process.env.CREATOR_WORKER_ENABLED !== "true" || process.env.CREATOR_RUNTIME_AUTHORITY_ENABLED !== "true") throw new Error("CREATOR_WORKER_DISABLED");
  const deploymentId = process.env.CREATOR_DEPLOYMENT_ID;
  const workspace = process.env.CREATOR_STUDIO_WORKSPACE_ROOT;
  if (deploymentId === undefined || !/^[0-9a-f-]{36}$/i.test(deploymentId) || workspace === undefined || !workspace.startsWith("/")) throw new Error("CREATOR_WORKER_CONFIGURATION_INVALID");
  const repository = creatorRepository(); const pool = getCommerceAuthDatabasePool();
  const store = repository.workerStore(workspace);
  const loaded = await store.load(deploymentId);
  const authority = await pool.query<{ authority_id: string; creator_user_id: string }>(`SELECT au.id AS authority_id,d.creator_user_id FROM agent_deployments ad JOIN agent_drafts d ON d.id=ad.draft_id JOIN agent_authorities au ON au.draft_id=d.id AND au.status='active' WHERE ad.id=$1 LIMIT 1`, [deploymentId]);
  const binding = authority.rows[0]; if (binding === undefined) throw new Error("CREATOR_AUTHORITY_UNAVAILABLE");
  const resolver = creatorAuthorityResolver();
  const recheckAuthority = async () => { await resolver.requireRuntimeAuthority({ userId: binding.creator_user_id, draftId: (await pool.query<{ draft_id: string }>("SELECT draft_id FROM agent_deployments WHERE id=$1", [deploymentId])).rows[0]!.draft_id, authorityId: binding.authority_id }); };
  await runCreatorStudioStep({ deploymentId, readiness: studioReadiness(readCreatorStandardsLock()), store, studio: nativeStudioProcessAdapter(), handoffs: createCreatorLifecycleHandoffs(pool), recheckAuthority });
  // Keep output public and bounded; all sensitive adapter details stay in the
  // T6 gateway/sink and are never written to this process output.
  process.stdout.write(JSON.stringify({ deploymentId, stage: loaded.stage, outcome: "reconciled" }) + "\n");
}
void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "CREATOR_WORKER_FAILED"}\n`); process.exitCode = 1; });
