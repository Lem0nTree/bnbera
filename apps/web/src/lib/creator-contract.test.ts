import { describe, expect, it } from "vitest";
import { creatorDraftRequestSchema, creatorLifecycleAction, creatorTemplate } from "./creator-contract";
import { unavailableCreatorRuntimeAuthority } from "./creator-authority-runtime";
import { nativeStudioInitCommand, studioReadiness } from "./creator-studio";
import { externalOutcomePolicy, nextCreatorStage, runCreatorStudioStep, type CreatorStage } from "./creator-worker";

describe("Creator fixed-template boundary", () => {
  const draft = { idempotencyKey: "00000000-0000-4000-8000-000000000001", name: "Safe monitor", slug: "safe-monitor", description: "A monitored Venus health-factor alert agent.", protocol: "venus", refreshMinutes: 15, publicationConsent: true };
  it("accepts only the fixed audited parameters", () => {
    expect(creatorDraftRequestSchema.safeParse(draft).success).toBe(true);
    expect(creatorDraftRequestSchema.safeParse({ ...draft, prompt: "write arbitrary code" }).success).toBe(false);
    expect(creatorDraftRequestSchema.safeParse({ ...draft, protocol: "other" }).success).toBe(false);
  });
  it("uses the native Altana Studio initialization shape", () => {
    expect(nativeStudioInitCommand("bnberahf123")).toEqual(["bag", "init", "bnberahf123", "--wallet-kind", "altana", "--network", "bsc-testnet", "--no-onboard"]);
  });
  it("allows only the pinned ERC-8004 URI lifecycle write", () => {
    expect(creatorTemplate.contractSelectorAllowlist.calls).toEqual([{ target: creatorLifecycleAction.target, selectors: [creatorLifecycleAction.selector], maxNativeValueWei: "0" }]);
    expect(creatorLifecycleAction.spends).toEqual([]);
  });
  it("fails closed for unpinned runtime and absent T6 authority", async () => {
    expect(studioReadiness({ toolchain: { agentStudioCli: { package: "@bnbagent/studio-cli", version: "0.0.13", integrity: "x" }, agentStudioRuntime: { package: "@bnbagent/studio-runtime", version: "0.0.13", integrity: null } } }).ready).toBe(false);
    await expect(unavailableCreatorRuntimeAuthority.requireRuntimeAuthority({ userId: "user", draftId: "draft", authorityId: "00000000-0000-4000-8000-000000000002" })).rejects.toMatchObject({ code: "CREATOR_AUTHORITY_UNAVAILABLE" });
  });
  it("does not advance an unknown external outcome or create a runtime before gates", () => {
    expect(nextCreatorStage("validate", { ready: false, reason: "unverified" }, false)).toBeNull();
    expect(nextCreatorStage("authority_ready", { ready: false, reason: "unverified" }, true)).toBeNull();
    expect(externalOutcomePolicy()).toBe("reconcile_before_retry");
  });
  it("advances every bounded stage with a verified fake Studio adapter", () => {
    const ready = { ready: true, reason: "test adapter" };
    expect(nextCreatorStage("authority_ready", ready, true)).toBe("studio_scaffold_package");
    expect(nextCreatorStage("studio_scaffold_package", ready, true)).toBe("deploy_reconcile");
    expect(nextCreatorStage("deploy_reconcile", ready, true)).toBe("erc8004_register_reconcile");
    expect(nextCreatorStage("erc8004_register_reconcile", ready, true)).toBe("marketplace_publish");
  });
  it("persists Studio ID before advancing and reconciles without a duplicate run", async () => {
    let state: { stage: CreatorStage; runtimeName: string; publicId: string | null } = { stage: "studio_scaffold_package", runtimeName: "bnberahf123", publicId: null };
    const events: unknown[] = [];
    const store = { load: async () => state, record: async (_id: string, event: { stage: CreatorStage; publicId: string | null; output: string }) => { events.push(event); state = { ...state, stage: event.stage, publicId: event.publicId }; } };
    let runs = 0;
    const studio = { run: async () => { runs += 1; return { exitCode: 0, publicId: "studio-1", output: "created" }; }, reconcile: async () => "confirmed" as const };
    await expect(runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio })).resolves.toBe("deploy_reconcile");
    expect(runs).toBe(1); expect(events).toHaveLength(2);
  });
});
