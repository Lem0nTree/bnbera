import { describe, expect, it } from "vitest";
import { canonicalRuntimeConfigurationDigest } from "./creator-contract";
import { createCreatorWorkerComposition, type CreatorWorkerCompositionOptions } from "./creator-composition";
import type { CreatorDeploymentBinding } from "./creator-repository";
import type { CreatorStudioAdapter, CreatorWorkerStore } from "./creator-worker";

const configuration = {
  protocol: "pancakeswap-v2",
  tradingPair: "tbnb-busd",
  inputAmountWei: "500000000000000",
  slippageBps: 25,
  quoteMaxAgeSeconds: 30,
  deadlineSeconds: 60,
} as const;
const digest = canonicalRuntimeConfigurationDigest(configuration);
const binding: CreatorDeploymentBinding = {
  deploymentId: "11111111-1111-4111-8111-111111111111",
  draftId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333",
  authorityId: "44444444-4444-4444-8444-444444444444",
  configurationDigest: digest,
};

function testInputs(overrides: Partial<CreatorWorkerCompositionOptions> = {}) {
  let stage: "studio_scaffold_package" | "deploy_reconcile" = "studio_scaffold_package";
  let intentCount = 0;
  const store: CreatorWorkerStore = {
    load: async () => ({
      stage,
      runtimeName: "bnberahf111111111111",
      projectRoot: "/srv/creator",
      publicId: null,
      endpoint: null,
      publicConfig: configuration,
      configurationDigest: digest,
    }),
    record: async (_id, input) => { stage = input.stage === "deploy_reconcile" ? "deploy_reconcile" : stage; },
    recordIntent: async () => { intentCount += 1; return "claimed"; },
    recordScaffoldIntent: async () => "claimed",
  };
  const studio: CreatorStudioAdapter = {
    inspect: async () => "STUDIO_TEMPLATE_READY",
    materialize: async () => "STUDIO_TEMPLATE_READY",
    run: async () => ({ exitCode: 0, reasonCode: "STUDIO_COMMAND_OK" }),
    status: async () => null,
    verifyEndpoint: async () => true,
  };
  const repository = {
    workerStore: () => store,
    workerDeploymentBinding: async () => binding,
  };
  const options: CreatorWorkerCompositionOptions = {
    repository,
    pool: {} as CreatorWorkerCompositionOptions["pool"],
    workspaceParent: "/srv/creator",
    readiness: { ready: true, reason: "test" },
    studio,
    authorityResolver: { requireRuntimeAuthority: async () => ({ authorityId: binding.authorityId, policyDigest: "a".repeat(64), secretReference: "ref:creator", expiresAt: "2099-01-01T00:00:00.000Z" }) },
    ...overrides,
  };
  return { options, getIntentCount: () => intentCount };
}

describe("Creator worker composition", () => {
  it("runs one queued scaffold step through injected seams", async () => {
    const { options } = testInputs();
    const worker = createCreatorWorkerComposition(options);
    await expect(worker.runOnce(binding.deploymentId)).resolves.toMatchObject({
      deploymentId: binding.deploymentId,
      previousStage: "studio_scaffold_package",
      nextStage: "deploy_reconcile",
      outcome: "advanced",
    });
  });

  it("rejects a deployment whose persisted digest is not the bound digest", async () => {
    const { options } = testInputs({ repository: {
      workerStore: () => ({
        ...(testInputs().options.repository.workerStore("/srv/creator") as CreatorWorkerStore),
        load: async () => ({
          stage: "studio_scaffold_package",
          runtimeName: "bnberahf111111111111",
          projectRoot: "/srv/creator",
          publicId: null,
          endpoint: null,
          publicConfig: configuration,
          configurationDigest: "0".repeat(64),
        }),
      }),
      workerDeploymentBinding: async () => binding,
    } });
    await expect(createCreatorWorkerComposition(options).runOnce(binding.deploymentId)).rejects.toMatchObject({ code: "CREATOR_CONFIG_DIGEST_MISMATCH" });
  });

  it("checks T6 before spawning Studio when no authority composition exists", async () => {
    const { options, getIntentCount } = testInputs();
    const base = options.repository.workerStore("/srv/creator");
    const deployStore: CreatorWorkerStore = {
      ...base,
      load: async () => ({
        stage: "deploy_reconcile",
        runtimeName: "bnberahf111111111111",
        projectRoot: "/srv/creator",
        publicId: null,
        endpoint: null,
        publicConfig: configuration,
        configurationDigest: digest,
      }),
    };
    let runs = 0;
    const authorityError = Object.assign(new Error("authority unavailable"), { code: "CREATOR_AUTHORITY_UNAVAILABLE" });
    const composition = createCreatorWorkerComposition({
      ...options,
      repository: { ...options.repository, workerStore: () => deployStore },
      studio: { ...options.studio!, run: async () => { runs += 1; return { exitCode: 0, reasonCode: "STUDIO_COMMAND_OK" as const }; } },
      authorityResolver: { requireRuntimeAuthority: async () => { throw authorityError; } },
    });
    await expect(composition.runOnce(binding.deploymentId)).rejects.toMatchObject({ code: "CREATOR_AUTHORITY_UNAVAILABLE" });
    expect(getIntentCount()).toBe(1);
    expect(runs).toBe(0);
  });
});
