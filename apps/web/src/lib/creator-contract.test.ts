import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertCreatorNetworkExecution, assertCreatorSwapIntent, assertCreatorUriIntent, canonicalRuntimeConfigurationDigest, creatorDraftRequestSchema, creatorLifecycleAction, creatorProductionProfile, creatorSwapPolicy, creatorTemplate, creatorUriIntentDigest } from "./creator-contract";
import { unavailableCreatorRuntimeAuthority } from "./creator-authority-runtime";
import { nativeStudioDeployCommand, nativeStudioPingUrl, nativeStudioProcessAdapter, nativeStudioStatusCommand, parseNativeStudioStatus, studioReadiness } from "./creator-studio";
import { externalOutcomePolicy, nextCreatorStage, runCreatorStudioStep, type CreatorStage } from "./creator-worker";

describe("Creator fixed-template boundary", () => {
  const runtimeConfig = { protocol: "pancakeswap-v2", tradingPair: "tbnb-cake", inputAmountWei: "1000000000000000", slippageBps: 50, quoteMaxAgeSeconds: 60, deadlineSeconds: 120 } as const;
  const runtimeConfigDigest = canonicalRuntimeConfigurationDigest(runtimeConfig);
  const draft = { idempotencyKey: "00000000-0000-4000-8000-000000000001", name: "Safe swap", slug: "safe-swap", description: "A bounded PancakeSwap testnet CAKE swap agent.", protocol: "pancakeswap-v2", tradingPair: "tbnb-cake", inputAmountWei: "1000000000000000", slippageBps: 50, quoteMaxAgeSeconds: 60, deadlineSeconds: 120, publicationConsent: true };
  it("accepts only curated bounded user configuration", () => {
    expect(creatorDraftRequestSchema.safeParse(draft).success).toBe(true);
    expect(creatorDraftRequestSchema.safeParse({ ...draft, prompt: "write arbitrary code" }).success).toBe(false);
    expect(creatorDraftRequestSchema.safeParse({ ...draft, protocol: "other" }).success).toBe(false);
    expect(creatorDraftRequestSchema.safeParse({ ...draft, tradingPair: "0xarbitrary" }).success).toBe(false);
    expect(creatorDraftRequestSchema.safeParse({ ...draft, inputAmountWei: "1000000000000001" }).success).toBe(false);
  });
  it("uses the native non-interactive Studio deployment shape", () => {
    expect(nativeStudioDeployCommand("/srv/creator/studio")).toEqual(["bag", "deploy", "--provider", "bnb", "--project-root", "/srv/creator/studio", "--yes"]);
    expect(nativeStudioStatusCommand("/srv/creator/studio")).toContain("--json");
  });
  it("allows only the pinned ERC-8004 URI lifecycle write", () => {
    expect(creatorTemplate.contractSelectorAllowlist.calls).toContainEqual({ target: creatorLifecycleAction.target, selectors: [creatorLifecycleAction.selector], maxNativeValueWei: "0" });
    expect(creatorLifecycleAction.spends).toEqual([]);
    expect(creatorTemplate.contractSelectorAllowlist.spend).toEqual([{ token: "native", limitAtomic: "2000000000000000", period: "hour" }]);
  });
  it("binds the URI update to its identity and revocation denies the identical action", () => {
    const intent = { agentId: "77", uri: "https://agent.example/77.json" };
    const digest = creatorUriIntentDigest(intent);
    expect(() => assertCreatorUriIntent({ allowedAgentId: "77", allowedUriDigest: digest, intent, authorityStatus: "active" })).not.toThrow();
    expect(() => assertCreatorUriIntent({ allowedAgentId: "78", allowedUriDigest: digest, intent, authorityStatus: "active" })).toThrow("CREATOR_URI_INTENT_DENIED");
    expect(() => assertCreatorUriIntent({ allowedAgentId: "77", allowedUriDigest: digest, intent, authorityStatus: "revoked" })).toThrow("CREATOR_AUTHORITY_NOT_ACTIVE");
  });
  it("allows only curated fresh self-recipient native swaps", () => {
    expect(creatorSwapPolicy.maxInputAmountWei).toBe("1000000000000000");
    const intent = { recipient: "0x1111111111111111111111111111111111111111", sessionWallet: "0x1111111111111111111111111111111111111111", quoteBlock: 1, quotedAtUnix: 100, nowUnix: 130, calldataDigest: `0x${"aa".repeat(32)}`, tradingPair: "tbnb-busd" as const, inputAmountWei: "500000000000000" as const, slippageBps: 25 as const, quoteMaxAgeSeconds: 30 as const, deadlineSeconds: 60 as const };
    expect(() => assertCreatorSwapIntent(intent)).not.toThrow();
    expect(() => assertCreatorSwapIntent({ ...intent, recipient: "0x2222222222222222222222222222222222222222" })).toThrow("CREATOR_SWAP_RECIPIENT_DENIED");
    expect(() => assertCreatorSwapIntent({ ...intent, nowUnix: 131 })).toThrow("CREATOR_SWAP_QUOTE_STALE");
  });
  it("keeps the chain-56 profile read-only until an explicit release gate", () => {
    expect(creatorProductionProfile.writesEnabled).toBe(false);
    expect(creatorProductionProfile.verifiedAtBlock).toBe(120598699);
    expect(() => assertCreatorNetworkExecution(56, {})).toThrow("CREATOR_MAINNET_WRITES_DISABLED");
    expect(() => assertCreatorNetworkExecution(97, {})).not.toThrow();
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
    expect(nextCreatorStage("marketplace_publish", ready, true)).toBe("g2_funded_job_reconcile");
    expect(nextCreatorStage("g2_funded_job_reconcile", ready, true)).toBe("g2_activation_reconcile");
    expect(nextCreatorStage("g2_activation_reconcile", ready, true)).toBe("completed");
  });
  it("persists Studio ID before advancing and reconciles without a duplicate run", async () => {
    let state: { stage: CreatorStage; runtimeName: string; projectRoot: string; publicId: string | null; endpoint: string | null } = { stage: "studio_scaffold_package", runtimeName: "bnberahf123", projectRoot: "/srv/creator/studio", publicId: null, endpoint: null };
    const events: unknown[] = [];
    const store = { load: async () => state, record: async (_id: string, event: { stage: CreatorStage; publicId: string | null; endpoint?: string | null; reasonCode: string }) => { events.push(event); state = { ...state, stage: event.stage, publicId: event.publicId, endpoint: event.endpoint ?? state.endpoint }; }, recordIntent: async () => "claimed" as const, recordScaffoldIntent: async () => "claimed" as const };
    let runs = 0;
    const studio = { inspect: async () => "STUDIO_TEMPLATE_READY" as const, materialize: async () => { runs += 1; return "STUDIO_TEMPLATE_READY" as const; }, run: async () => ({ exitCode: 0, reasonCode: "STUDIO_COMMAND_OK" as const }), status: async () => null, verifyEndpoint: async () => true };
    await expect(runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio, recheckAuthority: async () => undefined })).resolves.toBe("deploy_reconcile");
    expect(runs).toBe(1); expect(events).toHaveLength(2);
  });
  it("persists intent, captures the provider ID, and reconciles after restart without another deploy", async () => {
    let state: { stage: CreatorStage; runtimeName: string; projectRoot: string; publicId: string | null; endpoint: string | null } = { stage: "deploy_reconcile", runtimeName: "bnberahf123", projectRoot: "/srv/creator/studio", publicId: null, endpoint: null };
    const events: string[] = []; let deploys = 0;
    const store = { load: async () => state, record: async (_: string, item: { stage: CreatorStage; publicId: string | null; endpoint?: string | null; reasonCode: string }) => { state = { ...state, stage: item.stage, publicId: item.publicId, endpoint: item.endpoint ?? null }; }, recordIntent: async () => { events.push("intent"); return "claimed" as const; }, recordScaffoldIntent: async () => "claimed" as const };
    const studio = { inspect: async () => "STUDIO_TEMPLATE_READY" as const, materialize: async () => "STUDIO_TEMPLATE_READY" as const, run: async () => { deploys += 1; return { exitCode: 0, reasonCode: "STUDIO_COMMAND_OK" as const }; }, status: async () => ({ deploymentId: "bnb-1", endpoint: "https://agent.example" }), verifyEndpoint: async () => true };
    await expect(runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio, recheckAuthority: async () => undefined })).resolves.toBeNull();
    expect(events).toEqual(["intent"]); expect(state.publicId).toBe("bnb-1");
    await expect(runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio, recheckAuthority: async () => undefined })).resolves.toBe("erc8004_register_reconcile");
    expect(deploys).toBe(1);
  });
  it("accepts only documented native Studio status fields", () => {
    expect(parseNativeStudioStatus('{"deployments":[{"provider":"bnb","deployment_id":"d-1","recorded_endpoint":"https://agent.example"}]}')).toEqual({ deploymentId: "d-1", endpoint: "https://agent.example" });
    expect(parseNativeStudioStatus('{"deployments":[{"provider":"bnb","deployment_id":null}]}')).toBeNull();
  });
  it("never respawns a prior unknown deploy intent and rechecks authority before a new deploy", async () => {
    const state = { stage: "deploy_reconcile" as CreatorStage, runtimeName: "bnberahf123", projectRoot: "/srv/creator", publicId: null, endpoint: null };
    let runs = 0; let checks = 0;
    const store = { load: async () => state, record: async () => undefined, recordIntent: async () => "reconcile" as const, recordScaffoldIntent: async () => "claimed" as const };
    const studio = { inspect: async () => "STUDIO_TEMPLATE_READY" as const, materialize: async () => "STUDIO_TEMPLATE_READY" as const, run: async () => { runs += 1; return { exitCode: 0, reasonCode: "STUDIO_COMMAND_OK" as const }; }, status: async () => null, verifyEndpoint: async () => true };
    await runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio, recheckAuthority: async () => { checks += 1; } });
    expect(runs).toBe(0); expect(checks).toBe(0);
  });
  it("rechecks the exact configured artifact immediately before deployment", async () => {
    const state = { stage: "deploy_reconcile" as CreatorStage, runtimeName: "bnberahf123", projectRoot: "/srv/creator", publicId: null, endpoint: null, publicConfig: runtimeConfig, configurationDigest: runtimeConfigDigest };
    const reasons: string[] = []; let intents = 0; let runs = 0;
    const store = { load: async () => state, record: async (_: string, item: { reasonCode: string }) => { reasons.push(item.reasonCode); }, recordIntent: async () => { intents += 1; return "claimed" as const; }, recordScaffoldIntent: async () => "claimed" as const };
    const studio = { inspect: async () => "STUDIO_TEMPLATE_MISMATCH" as const, materialize: async () => "STUDIO_TEMPLATE_READY" as const, run: async () => { runs += 1; return { exitCode: 0, reasonCode: "STUDIO_COMMAND_OK" as const }; }, status: async () => null, verifyEndpoint: async () => true };
    await expect(runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio, recheckAuthority: async () => undefined })).resolves.toBeNull();
    expect(reasons).toEqual(["STUDIO_TEMPLATE_MISMATCH"]); expect(intents).toBe(0); expect(runs).toBe(0);
  });
  it("serializes concurrent scaffold attempts and leaves no partial artifact marked ready", async () => {
    const state = { stage: "studio_scaffold_package" as CreatorStage, runtimeName: "bnberahf123", projectRoot: "/srv/creator", publicId: null, endpoint: null };
    let claims = 0; let materializations = 0;
    const store = { load: async () => state, record: async () => undefined, recordIntent: async () => "claimed" as const, recordScaffoldIntent: async () => claims++ === 0 ? "claimed" as const : "reconcile" as const };
    let inspections = 0;
    const studio = { inspect: async () => { inspections += 1; return "STUDIO_TEMPLATE_MISMATCH" as const; }, materialize: async () => { materializations += 1; return "STUDIO_TEMPLATE_MISMATCH" as const; }, run: async () => ({ exitCode: 0, reasonCode: "STUDIO_COMMAND_OK" as const }), status: async () => null, verifyEndpoint: async () => true };
    await expect(runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio, recheckAuthority: async () => undefined })).resolves.toBeNull();
    await expect(runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio, recheckAuthority: async () => undefined })).resolves.toBeNull();
    // The second worker only performs the restart-safe exact-artifact
    // inspection; native materialize never copies an existing workspace.
    expect(materializations).toBe(1); expect(inspections).toBe(1);
  });
  it("does not confirm a Studio record until its runtime endpoint probes healthy", async () => {
    const state = { stage: "deploy_reconcile" as CreatorStage, runtimeName: "bnberahf123", projectRoot: "/srv/creator", publicId: "bnb-1", endpoint: "https://agent.example" };
    const records: string[] = [];
    const store = { load: async () => state, record: async (_: string, value: { reasonCode: string }) => { records.push(value.reasonCode); }, recordIntent: async () => "claimed" as const, recordScaffoldIntent: async () => "claimed" as const };
    const studio = { inspect: async () => "STUDIO_TEMPLATE_READY" as const, materialize: async () => "STUDIO_TEMPLATE_READY" as const, run: async () => ({ exitCode: 0, reasonCode: "STUDIO_COMMAND_OK" as const }), status: async () => ({ deploymentId: "bnb-1", endpoint: "https://agent.example" }), verifyEndpoint: async () => false };
    await expect(runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio, recheckAuthority: async () => undefined })).resolves.toBeNull();
    expect(records).toEqual(["STUDIO_ENDPOINT_UNVERIFIED"]);
  });
  it("reuses an exact scaffold after restart but rejects a partial workspace", async () => {
    const parent = mkdtempSync(join(tmpdir(), "bnbera-creator-"));
    try {
      const studio = nativeStudioProcessAdapter();
      await expect(studio.materialize(parent, "bnberahf123", runtimeConfig, runtimeConfigDigest)).resolves.toBe("STUDIO_TEMPLATE_READY");
      expect(existsSync(join(parent, "bnberahf123", "app/agent/bnbera-public-config.json"))).toBe(true);
      // Package installation and Studio state must not become part of the
      // immutable source artifact or make a restart look tampered.
      mkdirSync(join(parent, "bnberahf123", "app/agent/node_modules/example"), { recursive: true });
      mkdirSync(join(parent, "bnberahf123", ".studio/wallets"), { recursive: true });
      writeFileSync(join(parent, "bnberahf123", "app/agent/node_modules/example/index.js"), "generated");
      writeFileSync(join(parent, "bnberahf123", ".studio/wallets/altana-session.json"), "generated-session-state");
      await expect(studio.materialize(parent, "bnberahf123", runtimeConfig, runtimeConfigDigest)).resolves.toBe("STUDIO_TEMPLATE_READY");
      const partial = join(parent, "bnberahf456");
      writeFileSync(partial, "partial artifact");
      await expect(studio.materialize(parent, "bnberahf456", runtimeConfig, runtimeConfigDigest)).resolves.toBe("STUDIO_TEMPLATE_MISMATCH");
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
  it("denies reload when generated public config or digest is tampered", async () => {
    const parent = mkdtempSync(join(tmpdir(), "bnbera-creator-config-"));
    try {
      const studio = nativeStudioProcessAdapter();
      await expect(studio.materialize(parent, "bnberahf999", runtimeConfig, runtimeConfigDigest)).resolves.toBe("STUDIO_TEMPLATE_READY");
      writeFileSync(join(parent, "bnberahf999", "app/agent/bnbera-public-config.json"), JSON.stringify({ configuration: runtimeConfig, configurationDigest: "0".repeat(64) }));
      await expect(studio.inspect(parent, "bnberahf999", runtimeConfig, runtimeConfigDigest)).resolves.toBe("STUDIO_TEMPLATE_MISMATCH");
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
  it("reconciles a crash after scaffold intent from an exact artifact and fails a partial one", async () => {
    let state = { stage: "studio_scaffold_package" as CreatorStage, runtimeName: "bnberahf123", projectRoot: "/srv/creator", publicId: null, endpoint: null };
    const events: string[] = [];
    const store = { load: async () => state, record: async (_: string, item: { stage: CreatorStage; reasonCode: string }) => { events.push(item.reasonCode); state = { ...state, stage: item.stage }; }, recordIntent: async () => "claimed" as const, recordScaffoldIntent: async () => "reconcile" as const };
    const studio = { inspect: async () => "STUDIO_TEMPLATE_READY" as const, materialize: async () => "STUDIO_TEMPLATE_READY" as const, run: async () => ({ exitCode: 0, reasonCode: "STUDIO_COMMAND_OK" as const }), status: async () => null, verifyEndpoint: async () => true };
    await expect(runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio, recheckAuthority: async () => undefined })).resolves.toBe("deploy_reconcile");
    expect(events).toEqual(["STUDIO_TEMPLATE_READY", "STUDIO_TEMPLATE_RECONCILED"]);
    state = { ...state, stage: "studio_scaffold_package" };
    const partial = { ...studio, inspect: async () => "STUDIO_TEMPLATE_MISMATCH" as const };
    await expect(runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio: partial, recheckAuthority: async () => undefined })).resolves.toBeNull();
    expect(events.at(-1)).toBe("STUDIO_TEMPLATE_MISMATCH");
  });
  it("persists terminal completion after durable G1 and G2 handoff evidence", async () => {
    let state = { stage: "erc8004_register_reconcile" as CreatorStage, runtimeName: "bnberahf123", projectRoot: "/srv/creator", publicId: "studio-1", endpoint: "https://agent.example/prefix" };
    const records: Array<{ stage: CreatorStage; operationId?: string }> = [];
    const store = { load: async () => state, record: async (_: string, item: { stage: CreatorStage; operationId?: string }) => { records.push(item); state = { ...state, stage: item.stage }; }, recordIntent: async () => "claimed" as const, recordScaffoldIntent: async () => "claimed" as const };
    const studio = { inspect: async () => "STUDIO_TEMPLATE_READY" as const, materialize: async () => "STUDIO_TEMPLATE_READY" as const, run: async () => ({ exitCode: 0, reasonCode: "STUDIO_COMMAND_OK" as const }), status: async () => null, verifyEndpoint: async () => true };
    const calls: string[] = [];
    const handoffs = {
      registerAndVerify: async () => { calls.push("register"); return { status: "confirmed" as const, operationId: "g1-register-1" }; },
      publishMarketplace: async () => { calls.push("publish"); return { status: "confirmed" as const, operationId: "g1-publish-1" }; },
      verifyFundedJob: async () => { calls.push("funded"); return { status: "confirmed" as const, operationId: "g2-funded-1" }; },
      activateCommerce: async () => { calls.push("activate"); return { status: "confirmed" as const, operationId: "g2-activate-1" }; }
    };
    await expect(runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio, handoffs, recheckAuthority: async () => undefined })).resolves.toBe("marketplace_publish");
    await expect(runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio, handoffs, recheckAuthority: async () => undefined })).resolves.toBe("g2_funded_job_reconcile");
    await expect(runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio, handoffs, recheckAuthority: async () => undefined })).resolves.toBe("g2_activation_reconcile");
    await expect(runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio, handoffs, recheckAuthority: async () => undefined })).resolves.toBe("completed");
    expect(state.stage).toBe("completed");
    expect(calls).toEqual(["register", "publish", "funded", "activate"]);
    expect(records.map((value) => value.operationId)).toEqual(["g1-register-1", "g1-publish-1", "g2-funded-1", "g2-activate-1"]);
  });
  it("keeps the Studio endpoint path prefix when probing", () => {
    expect(nativeStudioPingUrl("https://agent.example/runtime/v1").toString()).toBe("https://agent.example/runtime/v1/ping");
  });
});
