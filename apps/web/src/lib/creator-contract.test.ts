import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeSessionDescriptor } from "@bnbera/altana";
import { describe, expect, it, vi } from "vitest";
import { assertCreatorNetworkExecution, assertCreatorSwapIntent, assertCreatorUriIntent, canonicalRuntimeConfigurationDigest, creatorCommerceAction, creatorDraftRequestSchema, creatorLifecycleAction, creatorProductionProfile, creatorSwapPolicy, creatorSwapAction, creatorTemplate, creatorUriIntentDigest } from "./creator-contract";
import { unavailableCreatorRuntimeAuthority } from "./creator-authority-runtime";
import { classifyNativeStudioProcessError, creatorStudioProjectSlug, isNativeStudioAgentCardUrl, nativeStudioDeployCommand, nativeStudioInstallCommand, nativeStudioPingUrl, nativeStudioProbeUrl, nativeStudioProcessAdapter, nativeStudioStatusCommand, nativeStudioWorkspaceStoreDirectory, nativeStudioWorkspaceTempDirectory, parseNativeStudioStatus, readCreatorStandardsLock, studioReadiness } from "./creator-studio";
import { creatorLocalStudioDestination, creatorRuntimeName, LocalCreatorStudioSecretSink } from "./creator-local-secret";
import { externalOutcomePolicy, nextCreatorStage, runCreatorStudioStep, type CreatorStage } from "./creator-worker";

const creatorWalletAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function seedStudioSession(parent: string, runtimeName: string, walletAddress = creatorWalletAddress): void {
  const runtimeRoot = join(parent, runtimeName);
  const studioRoot = join(runtimeRoot, ".studio");
  const walletsRoot = join(studioRoot, "wallets");
  mkdirSync(walletsRoot, { recursive: true, mode: 0o700 });
  chmodSync(runtimeRoot, 0o700);
  chmodSync(studioRoot, 0o700);
  chmodSync(walletsRoot, 0o700);
  const session = join(walletsRoot, "altana-session.json");
  writeFileSync(session, JSON.stringify({ walletAddress }), { mode: 0o600 });
  chmodSync(session, 0o600);
}

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
    const parent = mkdtempSync(join(tmpdir(), "bnbera-creator-command-"));
    try {
    expect(nativeStudioDeployCommand("/srv/creator/studio")).toEqual(["bag", "deploy", "--provider", "bnb", "--project-root", "/srv/creator/studio", "--yes"]);
    const projectRoot = join(parent, "studio");
    expect(nativeStudioWorkspaceStoreDirectory(projectRoot)).toBe(join(parent, ".pnpm-store"));
    expect(nativeStudioInstallCommand(projectRoot)).toEqual(["pnpm", "install", "--frozen-lockfile", "--ignore-scripts", "--force", "--store-dir", join(parent, ".pnpm-store")]);
    expect(nativeStudioWorkspaceTempDirectory(parent)).toBe(join(parent, ".creator-tmp"));
    expect(nativeStudioStatusCommand("/srv/creator/studio")).toContain("--json");
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
  it("allows exactly the pinned lifecycle, swap, and ERC-8183 submit writes", () => {
    expect(creatorTemplate.contractSelectorAllowlist.chainId).toBe(97);
    expect(creatorTemplate.contractSelectorAllowlist.calls).toHaveLength(3);
    expect(creatorTemplate.contractSelectorAllowlist.calls).toEqual([
      { target: creatorLifecycleAction.target, selectors: [creatorLifecycleAction.selector], maxNativeValueWei: "0" },
      { target: creatorSwapAction.target, selectors: [creatorSwapAction.selector], maxNativeValueWei: "1000000000000000" },
      { target: creatorCommerceAction.target, selectors: [creatorCommerceAction.selector], maxNativeValueWei: "0" },
    ]);
    expect(creatorTemplate.contractSelectorAllowlist.calls).toContainEqual({ target: creatorLifecycleAction.target, selectors: [creatorLifecycleAction.selector], maxNativeValueWei: "0" });
    expect(creatorLifecycleAction.spends).toEqual([]);
    expect(creatorCommerceAction.spends).toEqual([]);
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
  it("requires the managed Studio contextual Altana SDK pin", () => {
    const lock = readCreatorStandardsLock() as { readonly toolchain: Record<string, unknown> };
    expect(studioReadiness(lock).ready).toBe(true);
    const toolchain = { ...lock.toolchain, agentStudioAltanaSdk: { ...(lock.toolchain.agentStudioAltanaSdk as Record<string, unknown>), version: "0.9.0" } };
    expect(studioReadiness({ ...lock, toolchain }).ready).toBe(false);
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
  it("bounds command output and exposes only allowlisted process diagnostics", async () => {
    const parent = mkdtempSync(join(tmpdir(), "bnbera-creator-output-"));
    const runtimeRoot = join(parent, "runtime");
    mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
    try {
      const studio = nativeStudioProcessAdapter();
      const successful = await studio.run(["node", "-e", "process.stdout.write('x'.repeat(128 * 1024))"], { cwd: runtimeRoot });
      expect(successful).toMatchObject({ exitCode: 0, reasonCode: "STUDIO_COMMAND_OK" });
      expect(successful).not.toHaveProperty("stdout");
      expect(successful).not.toHaveProperty("stderr");

      const overflow = await studio.run(["node", "-e", "process.stdout.write('x'.repeat(2 * 1024 * 1024))"], { cwd: runtimeRoot });
      expect(overflow.reasonCode).toBe("STUDIO_COMMAND_OUTPUT_OVERFLOW");
      expect(overflow.diagnostic).toEqual({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", signal: null, timedOut: false, outputOverflow: true });
      expect(overflow).not.toHaveProperty("stdout");
      expect(overflow).not.toHaveProperty("stderr");

      expect(classifyNativeStudioProcessError({ code: 7, stdout: "private-output", stderr: "private-error" })).toMatchObject({ exitCode: 7, reasonCode: "STUDIO_COMMAND_FAILED", diagnostic: { code: 7, signal: null, timedOut: false, outputOverflow: false } });
      expect(classifyNativeStudioProcessError({ code: "EACCES", signal: "SIGKILL" })).toMatchObject({ exitCode: 1, reasonCode: "STUDIO_COMMAND_SIGNAL", diagnostic: { code: "EACCES", signal: "SIGKILL" } });
      expect(classifyNativeStudioProcessError({ code: "ETIMEDOUT", killed: true, signal: "SIGTERM" }).reasonCode).toBe("STUDIO_COMMAND_TIMEOUT");
      expect(classifyNativeStudioProcessError({ code: "PRIVATE_CODE", signal: "PRIVATE_SIGNAL", stdout: "private-output" }).diagnostic).toEqual({ code: null, signal: null, timedOut: false, outputOverflow: false });
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
  it("never respawns a prior unknown deploy intent and rechecks authority before a new deploy", async () => {
    const state = { stage: "deploy_reconcile" as CreatorStage, runtimeName: "bnberahf123", projectRoot: "/srv/creator", publicId: null, endpoint: null };
    let runs = 0; let checks = 0;
    const store = { load: async () => state, record: async () => undefined, recordIntent: async () => "reconcile" as const, recordScaffoldIntent: async () => "claimed" as const };
    const studio = { inspect: async () => "STUDIO_TEMPLATE_READY" as const, materialize: async () => "STUDIO_TEMPLATE_READY" as const, run: async () => { runs += 1; return { exitCode: 0, reasonCode: "STUDIO_COMMAND_OK" as const }; }, status: async () => null, verifyEndpoint: async () => true };
    await runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio, recheckAuthority: async () => { checks += 1; } });
    expect(runs).toBe(0); expect(checks).toBe(0);
  });
  it("reconciles provider status before artifact checks after a deploy-intent crash", async () => {
    const state = { stage: "deploy_reconcile" as CreatorStage, runtimeName: "bnberahf123", projectRoot: "/srv/creator/studio", publicId: null, endpoint: null, publicConfig: runtimeConfig, configurationDigest: runtimeConfigDigest };
    const calls: string[] = [];
    const records: string[] = [];
    const store = {
      load: async () => state,
      record: async (_id: string, input: { readonly reasonCode: string }) => { records.push(input.reasonCode); },
      hasDeployIntent: async () => { calls.push("intent"); return true; },
      recordIntent: async () => { throw new Error("must not create a second deploy intent"); },
      recordScaffoldIntent: async () => "claimed" as const,
    };
    const studio = {
      inspect: async () => { calls.push("inspect"); return "STUDIO_TEMPLATE_MISMATCH" as const; },
      materialize: async () => { calls.push("materialize"); return "STUDIO_TEMPLATE_READY" as const; },
      run: async () => { throw new Error("must not respawn deploy"); },
      status: async () => { calls.push("status"); return { deploymentId: "bnb-1", endpoint: "https://agent.example" }; },
      verifyEndpoint: async () => true,
    };
    await expect(runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio, recheckAuthority: async () => undefined })).resolves.toBeNull();
    expect(calls).toEqual(["intent", "status"]);
    expect(records).toEqual(["STUDIO_DEPLOYMENT_RECORDED"]);
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
    // The second worker repairs the partial workspace through the adapter;
    // the adapter itself validates existing bytes before filling any gaps.
    expect(materializations).toBe(2); expect(inspections).toBe(1);
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
      seedStudioSession(parent, "bnberahf123");
      await expect(studio.materialize(parent, "bnberahf123", runtimeConfig, runtimeConfigDigest)).resolves.toBe("STUDIO_TEMPLATE_READY");
      const generatedConfigSource = join(parent, "bnberahf123", "app/agent/src/bnbera-public-config.ts");
      expect(existsSync(generatedConfigSource)).toBe(true);
      expect(readFileSync(join(parent, "bnberahf123", "pnpm-workspace.yaml"), "utf8")).toContain("app/agent");
      expect(readFileSync(join(parent, "bnberahf123", "pnpm-lock.yaml"), "utf8")).toContain("specifier: 0.7.1");
      expect(readFileSync(generatedConfigSource, "utf8")).toContain(`export const configurationDigest = "${runtimeConfigDigest}";`);
      const generatedStudioConfig = readFileSync(join(parent, "bnberahf123", "app/agent/studio.toml"), "utf8");
      expect(generatedStudioConfig).toContain(`name = "${creatorStudioProjectSlug("bnberahf123")}"`);
      expect(generatedStudioConfig).toContain(`[deploy.platform]\nslug = "${creatorStudioProjectSlug("bnberahf123")}"`);
      expect(generatedStudioConfig).toContain(`address = "${creatorWalletAddress}"`);
      const generatedGitignore = join(parent, "bnberahf123", ".gitignore");
      expect(readFileSync(generatedGitignore, "utf8")).toBe(".studio/\n");
      // Package installation and Studio state must not become part of the
      // immutable source artifact or make a restart look tampered.
      mkdirSync(join(parent, "bnberahf123", "app/agent/node_modules/example"), { recursive: true });
      writeFileSync(join(parent, "bnberahf123", "app/agent/node_modules/example/index.js"), "generated");
      writeFileSync(join(parent, "bnberahf123", ".studio/wallets/altana-session.json"), JSON.stringify({ walletAddress: creatorWalletAddress }));
      writeFileSync(generatedGitignore, "not-an-exclusion\n");
      await expect(studio.inspect(parent, "bnberahf123", runtimeConfig, runtimeConfigDigest)).resolves.toBe("STUDIO_TEMPLATE_MISMATCH");
      writeFileSync(generatedGitignore, ".studio/\n");
      await expect(studio.materialize(parent, "bnberahf123", runtimeConfig, runtimeConfigDigest)).resolves.toBe("STUDIO_TEMPLATE_READY");
      const partial = join(parent, "bnberahf456");
      writeFileSync(partial, "partial artifact");
      await expect(studio.materialize(parent, "bnberahf456", runtimeConfig, runtimeConfigDigest)).resolves.toBe("STUDIO_TEMPLATE_MISMATCH");
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
  it("tolerates generated dependency links but rejects source and Studio symlinks", async () => {
    const parent = mkdtempSync(join(tmpdir(), "bnbera-creator-links-"));
    const runtimeName = "bnberahf123";
    try {
      const studio = nativeStudioProcessAdapter();
      seedStudioSession(parent, runtimeName);
      await expect(studio.materialize(parent, runtimeName, runtimeConfig, runtimeConfigDigest)).resolves.toBe("STUDIO_TEMPLATE_READY");
      const runtimeRoot = join(parent, runtimeName);
      const legacyStore = join(runtimeRoot, ".pnpm-store");
      mkdirSync(join(legacyStore, "v10"), { recursive: true });
      await expect(studio.inspect(parent, runtimeName, runtimeConfig, runtimeConfigDigest)).resolves.toBe("STUDIO_TEMPLATE_MISMATCH");
      rmSync(legacyStore, { recursive: true, force: true });
      const dependencies = join(runtimeRoot, "app/agent/node_modules");
      mkdirSync(dependencies, { recursive: true });
      // pnpm can leave a dangling link while an interrupted install is being
      // retried. It is accepted only when its lexical target stays in this
      // workspace's node_modules subtree.
      symlinkSync(".pnpm/generated-dependency", join(dependencies, "generated-link"), "dir");
      const workspaceLinks = join(runtimeRoot, "node_modules/.pnpm/node_modules");
      mkdirSync(workspaceLinks, { recursive: true });
      symlinkSync("../../../app/agent", join(workspaceLinks, "workspace-agent"), "dir");
      await expect(studio.inspect(parent, runtimeName, runtimeConfig, runtimeConfigDigest)).resolves.toBe("STUDIO_TEMPLATE_READY");

      const secretLink = join(runtimeRoot, "node_modules/secret");
      symlinkSync("../.studio/wallets", secretLink, "dir");
      await expect(studio.inspect(parent, runtimeName, runtimeConfig, runtimeConfigDigest)).resolves.toBe("STUDIO_TEMPLATE_MISMATCH");
      unlinkSync(secretLink);

      symlinkSync("unifiedMain.ts", join(runtimeRoot, "app/agent/src/source-link.ts"), "file");
      await expect(studio.inspect(parent, runtimeName, runtimeConfig, runtimeConfigDigest)).resolves.toBe("STUDIO_TEMPLATE_MISMATCH");
      unlinkSync(join(runtimeRoot, "app/agent/src/source-link.ts"));

      symlinkSync("wallets", join(runtimeRoot, ".studio/session-link"), "dir");
      await expect(studio.inspect(parent, runtimeName, runtimeConfig, runtimeConfigDigest)).resolves.toBe("STUDIO_TEMPLATE_MISMATCH");
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
  it("installs frozen dependencies before deploy intent and the authority recheck", async () => {
    const state = { stage: "deploy_reconcile" as CreatorStage, runtimeName: "bnberahf123", projectRoot: "/srv/creator", publicId: null, endpoint: null, publicConfig: runtimeConfig, configurationDigest: runtimeConfigDigest };
    const events: string[] = [];
    const store = {
      load: async () => state,
      record: async (_id: string, item: { readonly reasonCode: string }) => { events.push(`record:${item.reasonCode}`); },
      recordIntent: async () => { events.push("intent"); return "claimed" as const; },
      recordScaffoldIntent: async () => "claimed" as const,
    };
    const studio = {
      inspect: async () => { events.push("inspect"); return "STUDIO_TEMPLATE_READY" as const; },
      materialize: async () => "STUDIO_TEMPLATE_READY" as const,
      install: async (command: readonly string[], input: { readonly cwd: string }) => {
        events.push(`install:${command.join(" ")}`);
        expect(input.cwd).toBe("/srv/creator/bnberahf123");
        return { exitCode: 0, reasonCode: "STUDIO_COMMAND_OK" as const };
      },
      run: async () => { events.push("run"); return { exitCode: 0, reasonCode: "STUDIO_COMMAND_OK" as const }; },
      status: async () => null,
      verifyEndpoint: async () => true,
    };
    await expect(runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio, recheckAuthority: async () => { events.push("authority"); } })).resolves.toBeNull();
    expect(events.slice(0, 6)).toEqual(["inspect", "install:pnpm install --frozen-lockfile --ignore-scripts --force --store-dir /srv/creator/.pnpm-store", "inspect", "intent", "authority", "run"]);
  });
  it("retries a timed-out frozen install without creating a deploy intent", async () => {
    const state = { stage: "deploy_reconcile" as CreatorStage, runtimeName: "bnberahf123", projectRoot: "/srv/creator", publicId: null, endpoint: null, publicConfig: runtimeConfig, configurationDigest: runtimeConfigDigest };
    let attempts = 0;
    let intents = 0;
    let runs = 0;
    const records: string[] = [];
    const store = {
      load: async () => state,
      record: async (_id: string, item: { readonly reasonCode: string }) => { records.push(item.reasonCode); },
      recordIntent: async () => { intents += 1; return "claimed" as const; },
      recordScaffoldIntent: async () => "claimed" as const,
    };
    const studio = {
      inspect: async () => "STUDIO_TEMPLATE_READY" as const,
      materialize: async () => "STUDIO_TEMPLATE_READY" as const,
      install: async () => {
        attempts += 1;
        return attempts === 1
          ? { exitCode: 1, reasonCode: "STUDIO_COMMAND_TIMEOUT" as const }
          : { exitCode: 0, reasonCode: "STUDIO_COMMAND_OK" as const };
      },
      run: async () => { runs += 1; return { exitCode: 0, reasonCode: "STUDIO_COMMAND_OK" as const }; },
      status: async () => null,
      verifyEndpoint: async () => true,
    };
    await expect(runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio, recheckAuthority: async () => undefined })).resolves.toBeNull();
    expect(records).toEqual(["STUDIO_DEPENDENCY_INSTALL_TIMEOUT"]);
    expect(intents).toBe(0);
    expect(runs).toBe(0);
    await expect(runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio, recheckAuthority: async () => undefined })).resolves.toBeNull();
    expect(attempts).toBe(2);
    expect(intents).toBe(1);
    expect(runs).toBe(1);
  });
  it("scaffolds an approved secret-first workspace without accepting partial source", async () => {
    const parent = mkdtempSync(join(tmpdir(), "bnbera-creator-secret-first-"));
    const draftId = "00000000-0000-4000-8000-000000000001";
    try {
      const runtimeName = creatorRuntimeName(draftId);
      const sink = new LocalCreatorStudioSecretSink({ workspaceRoot: parent, nowUnix: () => 1_700_000_001 });
      const descriptor: RuntimeSessionDescriptor = {
        sessionId: "creator-browser:00000000-0000-4000-8000-000000000001:abcd1234",
        policy: {
          chainId: 97,
          adminAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          sessionPublicAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
          sessionPublicKey: `0x04${"11".repeat(64)}`,
          calls: [{ target: "0xdddddddddddddddddddddddddddddddddddddddd", selectors: ["0x12345678"], maxNativeValueWei: 0n }],
          spend: [],
          expiresAtUnix: 2_000_000_000,
        },
        policyDigest: `0x${"22".repeat(32)}`,
        grantTransactionHash: null,
        secretReference: null,
        grantedAtUnix: 1_700_000_000,
      };
      const approvedSession = JSON.stringify({ walletAddress: descriptor.policy.walletAddress });
      await sink.putRuntimeSession({ bytes: new TextEncoder().encode(approvedSession), descriptor, destination: creatorLocalStudioDestination(runtimeName, "00000000-0000-4000-8000-000000000002") });
      const studio = nativeStudioProcessAdapter();
      expect(await studio.inspect(parent, runtimeName, runtimeConfig, runtimeConfigDigest)).toBe("STUDIO_TEMPLATE_MISMATCH");
      expect(await studio.materialize(parent, runtimeName, runtimeConfig, runtimeConfigDigest)).toBe("STUDIO_TEMPLATE_READY");
      expect(await studio.materialize(parent, runtimeName, runtimeConfig, runtimeConfigDigest)).toBe("STUDIO_TEMPLATE_READY");
      expect(readFileSync(join(parent, runtimeName, ".studio", "wallets", "altana-session.json"), "utf8")).toBe(approvedSession);
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
  it("repairs a crash-partial workspace without overwriting existing files", async () => {
    const parent = mkdtempSync(join(tmpdir(), "bnbera-creator-partial-"));
    const runtimeName = "bnberahf123";
    try {
      const studio = nativeStudioProcessAdapter();
      seedStudioSession(parent, runtimeName);
      await expect(studio.materialize(parent, runtimeName, runtimeConfig, runtimeConfigDigest)).resolves.toBe("STUDIO_TEMPLATE_READY");
      const runtimeRoot = join(parent, runtimeName);
      const packagePath = join(runtimeRoot, "package.json");
      const preservedPackage = readFileSync(packagePath);
      unlinkSync(join(runtimeRoot, "app/agent/tsconfig.json"));
      unlinkSync(join(runtimeRoot, "app/agent/src/bnbera-public-config.ts"));
      await expect(studio.materialize(parent, runtimeName, runtimeConfig, runtimeConfigDigest)).resolves.toBe("STUDIO_TEMPLATE_READY");
      expect(readFileSync(packagePath)).toEqual(preservedPackage);
      writeFileSync(packagePath, "tampered");
      unlinkSync(join(runtimeRoot, "app/agent/tsconfig.json"));
      await expect(studio.materialize(parent, runtimeName, runtimeConfig, runtimeConfigDigest)).resolves.toBe("STUDIO_TEMPLATE_MISMATCH");
      expect(readFileSync(packagePath, "utf8")).toBe("tampered");
      expect(existsSync(join(runtimeRoot, "app/agent/tsconfig.json"))).toBe(false);
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
  it("denies reload when generated public config source or digest is tampered", async () => {
    const parent = mkdtempSync(join(tmpdir(), "bnbera-creator-config-"));
    try {
      const studio = nativeStudioProcessAdapter();
      seedStudioSession(parent, "bnberahf999");
      await expect(studio.materialize(parent, "bnberahf999", runtimeConfig, runtimeConfigDigest)).resolves.toBe("STUDIO_TEMPLATE_READY");
      writeFileSync(join(parent, "bnberahf999", "app/agent/src/bnbera-public-config.ts"), "export const configurationDigest = \"tampered\";\n");
      await expect(studio.inspect(parent, "bnberahf999", runtimeConfig, runtimeConfigDigest)).resolves.toBe("STUDIO_TEMPLATE_MISMATCH");
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
  it("reconciles a crash after scaffold intent and repairs a partial artifact", async () => {
    let state = { stage: "studio_scaffold_package" as CreatorStage, runtimeName: "bnberahf123", projectRoot: "/srv/creator", publicId: null, endpoint: null };
    const events: string[] = [];
    const store = { load: async () => state, record: async (_: string, item: { stage: CreatorStage; reasonCode: string }) => { events.push(item.reasonCode); state = { ...state, stage: item.stage }; }, recordIntent: async () => "claimed" as const, recordScaffoldIntent: async () => "reconcile" as const };
    const studio = { inspect: async () => "STUDIO_TEMPLATE_READY" as const, materialize: async () => "STUDIO_TEMPLATE_READY" as const, run: async () => ({ exitCode: 0, reasonCode: "STUDIO_COMMAND_OK" as const }), status: async () => null, verifyEndpoint: async () => true };
    await expect(runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio, recheckAuthority: async () => undefined })).resolves.toBe("deploy_reconcile");
    expect(events).toEqual(["STUDIO_TEMPLATE_READY", "STUDIO_TEMPLATE_RECONCILED"]);
    state = { ...state, stage: "studio_scaffold_package" };
    const partial = { ...studio, inspect: async () => "STUDIO_TEMPLATE_MISMATCH" as const, materialize: async () => "STUDIO_TEMPLATE_READY" as const };
    await expect(runCreatorStudioStep({ deploymentId: "d", readiness: { ready: true, reason: "test" }, store, studio: partial, recheckAuthority: async () => undefined })).resolves.toBe("deploy_reconcile");
    expect(events.at(-1)).toBe("STUDIO_TEMPLATE_RECONCILED");
  });
  it("persists terminal completion after durable G1 and G2 handoff evidence", async () => {
    let state = { stage: "erc8004_register_reconcile" as CreatorStage, runtimeName: "bnberahf123", projectRoot: "/srv/creator", publicId: "studio-1", endpoint: "https://agent.example/prefix", publicConfig: runtimeConfig, configurationDigest: runtimeConfigDigest };
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
  it("keeps the managed card URL direct and validates the public A2A card separately from ping", async () => {
    const cardEndpoint = "https://1.1.1.1/runtime/v1/.well-known/agent-card.json";
    expect(isNativeStudioAgentCardUrl(cardEndpoint)).toBe(true);
    expect(nativeStudioProbeUrl(cardEndpoint).toString()).toBe(cardEndpoint);
    expect(nativeStudioProbeUrl("https://1.1.1.1/runtime/v1").toString()).toBe("https://1.1.1.1/runtime/v1/ping");
    const requests: string[] = [];
    const fetchMock = vi.fn(async (input: unknown) => {
      requests.push(String(input));
      if (requests.length === 1) return new Response(JSON.stringify({ status: "healthy", template: "pancakeswap-one-shot" }), { status: 200 });
      return new Response(JSON.stringify({ protocolVersion: "0.3.0", preferredTransport: "JSONRPC", defaultInputModes: ["application/json"], defaultOutputModes: ["application/json"], skills: [{ id: "execute_swap" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const studio = nativeStudioProcessAdapter();
      await expect(studio.verifyEndpoint("https://1.1.1.1/runtime/v1")).resolves.toBe(true);
      await expect(studio.verifyEndpoint(cardEndpoint)).resolves.toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(requests).toEqual(["https://1.1.1.1/runtime/v1/ping", cardEndpoint]);
  });
  it("rejects a card that does not advertise the bounded execution skill", async () => {
    const cardEndpoint = "https://1.1.1.1/runtime/v1/.well-known/agent-card.json";
    const fetchMock = vi.fn(async (_input: unknown) => new Response(JSON.stringify({ protocolVersion: "0.3.0", preferredTransport: "JSONRPC", defaultInputModes: ["application/json"], defaultOutputModes: ["application/json"], skills: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(nativeStudioProcessAdapter().verifyEndpoint(cardEndpoint)).resolves.toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(cardEndpoint);
  });
});
