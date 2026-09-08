import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertSafePublicNetworkTarget } from "@bnbera/agent-ingestion";

export type StudioReadiness = { readonly ready: boolean; readonly reason: string };

/** Read the lock rather than accepting package/version values from a request. */
export function studioReadiness(lock: unknown): StudioReadiness {
  try {
    const toolchain = (lock as { toolchain?: Record<string, unknown> }).toolchain;
    const cli = toolchain?.agentStudioCli as Record<string, unknown> | undefined;
    const runtime = toolchain?.agentStudioRuntime as Record<string, unknown> | undefined;
    if (cli?.package !== "@bnbagent/studio-cli" || cli.version !== "0.0.13" || typeof cli.integrity !== "string") {
      return { ready: false, reason: "The reviewed Studio CLI 0.0.13 pin is unavailable." };
    }
    if (runtime?.package !== "@bnbagent/studio-runtime" || runtime.version !== "0.0.13" || typeof runtime.integrity !== "string" || runtime.verificationStatus !== "pinned-from-npm-registry") {
      return { ready: false, reason: "Studio runtime 0.0.13 integrity is not verified in the standards lock." };
    }
    return { ready: true, reason: "Studio CLI/runtime pins are verified." };
  } catch { return { ready: false, reason: "Studio standards lock is unreadable." }; }
}

export function readCreatorStandardsLock(): unknown {
  return JSON.parse(readFileSync(new URL("../../../../config/standards.lock.json", import.meta.url), "utf8")) as unknown;
}

/** Native Studio invocation shape; only used after readiness and T6 authority checks. */
/** Native, non-interactive Studio deploy. The T6 secret reference is handed
 * to Studio by its owner; it is never an argument or persisted here. */
export function nativeStudioDeployCommand(projectRoot: string): readonly string[] {
  if (!projectRoot.startsWith("/")) throw new Error("Creator Studio project root must be absolute.");
  return ["bag", "deploy", "--provider", "bnb", "--project-root", projectRoot, "--yes"];
}

export function nativeStudioStatusCommand(projectRoot: string): readonly string[] {
  if (!projectRoot.startsWith("/")) throw new Error("Creator Studio project root must be absolute.");
  return ["bag", "deploy", "status", "--provider", "bnb", "--project-root", projectRoot, "--json", "--no-probe"];
}

export type StudioDeploymentRecord = { readonly deploymentId: string; readonly endpoint: string | null };

/** Shape documented by Studio 0.0.13's `bag deploy status --json`. */
export function parseNativeStudioStatus(output: string): StudioDeploymentRecord | null {
  try {
    const parsed = JSON.parse(output) as { deployments?: readonly { provider?: unknown; deployment_id?: unknown; recorded_endpoint?: unknown }[] };
    const record = parsed.deployments?.find((item) => item.provider === "bnb");
    if (typeof record?.deployment_id !== "string" || record.deployment_id.length === 0 || record.deployment_id.length > 2_000) return null;
    const endpoint = typeof record.recorded_endpoint === "string" && /^https:\/\//.test(record.recorded_endpoint) ? record.recorded_endpoint : null;
    return { deploymentId: record.deployment_id, endpoint };
  } catch { return null; }
}

const templateArtifactPaths = ["README.md", "package.json", "app/agent/package.json", "app/agent/studio.toml", "app/agent/tsconfig.json", "app/agent/src/unifiedMain.ts"] as const;
const generatedWorkspaceDirectories = new Set(["node_modules", "dist", "build", ".studio", ".next"]);
export type CreatorPublicRuntimeConfig = { readonly protocol: "pancakeswap-v2"; readonly tradingPair: "tbnb-cake" | "tbnb-busd"; readonly inputAmountWei: "100000000000000" | "500000000000000" | "1000000000000000"; readonly slippageBps: 10 | 25 | 50; readonly quoteMaxAgeSeconds: 30 | 60; readonly deadlineSeconds: 60 | 120 };
const publicConfigSourcePath = "app/agent/src/bnbera-public-config.ts";
function templateArtifactRoot(): string {
  const candidates = [
    process.env.BNBERA_CREATOR_TEMPLATE_ROOT,
    resolve(process.cwd(), "templates/pancakeswap-one-shot"),
    resolve(process.cwd(), "../../templates/pancakeswap-one-shot"),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  const root = candidates.find((value) => existsSync(join(value, "app/agent/studio.toml")));
  if (root === undefined) throw new Error("CREATOR_TEMPLATE_ARTIFACT_UNAVAILABLE");
  return root;
}
function canonicalPublicRuntimeConfig(input: unknown): CreatorPublicRuntimeConfig {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("CREATOR_PUBLIC_CONFIG_INVALID");
  const value = input as Record<string, unknown>;
  const tradingPair = value.tradingPair === "tbnb-cake" ? "tbnb-cake" : value.tradingPair === "tbnb-busd" ? "tbnb-busd" : undefined;
  const inputAmountWei = value.inputAmountWei === "100000000000000" ? "100000000000000" : value.inputAmountWei === "500000000000000" ? "500000000000000" : value.inputAmountWei === "1000000000000000" ? "1000000000000000" : undefined;
  const slippageBps = value.slippageBps === 10 ? 10 : value.slippageBps === 25 ? 25 : value.slippageBps === 50 ? 50 : undefined;
  const quoteMaxAgeSeconds = value.quoteMaxAgeSeconds === 30 ? 30 : value.quoteMaxAgeSeconds === 60 ? 60 : undefined;
  const deadlineSeconds = value.deadlineSeconds === 60 ? 60 : value.deadlineSeconds === 120 ? 120 : undefined;
  if (Object.keys(value).length !== 6 || value.protocol !== "pancakeswap-v2" || tradingPair === undefined || inputAmountWei === undefined || slippageBps === undefined || quoteMaxAgeSeconds === undefined || deadlineSeconds === undefined) throw new Error("CREATOR_PUBLIC_CONFIG_INVALID");
  return { protocol: "pancakeswap-v2", tradingPair, inputAmountWei, slippageBps, quoteMaxAgeSeconds, deadlineSeconds };
}
function runtimeDigest(config: unknown): string { return createHash("sha256").update(JSON.stringify(canonicalPublicRuntimeConfig(config))).digest("hex"); }
/** Generate source from validated enum values; arbitrary source text is never accepted. */
function publicConfigSourceBytes(config: unknown, digest: unknown): string {
  const canonical = canonicalPublicRuntimeConfig(config);
  const expectedDigest = runtimeDigest(canonical);
  if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest) || digest !== expectedDigest) throw new Error("CREATOR_PUBLIC_CONFIG_DIGEST_MISMATCH");
  const literal = (value: string | number): string => JSON.stringify(value);
  return [
    "/* Generated by BNBEra Creator materialization; do not edit. */",
    "export const configuration = {",
    `  protocol: ${literal(canonical.protocol)},`,
    `  tradingPair: ${literal(canonical.tradingPair)},`,
    `  inputAmountWei: ${literal(canonical.inputAmountWei)},`,
    `  slippageBps: ${literal(canonical.slippageBps)},`,
    `  quoteMaxAgeSeconds: ${literal(canonical.quoteMaxAgeSeconds)},`,
    `  deadlineSeconds: ${literal(canonical.deadlineSeconds)},`,
    "} as const;",
    `export const configurationDigest = ${literal(digest)};`,
    "",
  ].join("\n");
}
function validPublicConfig(root: string, config: CreatorPublicRuntimeConfig, digest: string): boolean { try { const bytes = readFileSync(join(root, publicConfigSourcePath), "utf8"); return bytes === publicConfigSourceBytes(config, digest); } catch { return false; } }

/** A workspace is reusable only when it is exactly the reviewed artifact. */
function hasExactTemplateArtifact(root: string, config?: CreatorPublicRuntimeConfig, digest?: string): boolean {
  try {
    const source = templateArtifactRoot();
    const expected = new Set(templateArtifactPaths);
    const entries = (directory: string, prefix = ""): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const relative = `${prefix}${entry.name}`;
      // Studio/package-manager output is not part of the immutable source
      // artifact. It is ignored during reuse, never copied from the template.
      if (entry.isDirectory() && generatedWorkspaceDirectories.has(entry.name)) return [];
      return entry.isDirectory() ? entries(join(directory, entry.name), `${relative}/`) : [relative];
    });
    if (entries(root).some((path) => !expected.has(path as typeof templateArtifactPaths[number]) && path !== publicConfigSourcePath)) return false;
    return templateArtifactPaths.every((path) => statSync(join(root, path)).isFile() && readFileSync(join(root, path)).equals(readFileSync(join(source, path)))) && (config === undefined || digest === undefined || validPublicConfig(root, config, digest));
  } catch { return false; }
}

/** Probe the deployed provider rather than treating a status record as live. */
export function nativeStudioPingUrl(endpoint: string): URL {
  const target = new URL(endpoint);
  return new URL(`${target.pathname.replace(/\/+$/, "")}/ping`, target.origin);
}

async function verifyNativeStudioEndpoint(endpoint: string): Promise<boolean> {
  try {
    const target = await assertSafePublicNetworkTarget(endpoint);
    if (target.protocol !== "https:") return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const ping = nativeStudioPingUrl(target.toString());
      const response = await fetch(ping, { method: "GET", signal: controller.signal, redirect: "error" });
      if (!response.ok) return false;
      const body = await response.json() as { status?: unknown; template?: unknown };
      return body.status === "healthy" && body.template === "pancakeswap-one-shot";
    } finally { clearTimeout(timer); }
  } catch { return false; }
}

/** Bounded native CLI adapter. `execFile` deliberately uses shell:false. */
export function nativeStudioProcessAdapter(): import("./creator-worker").CreatorStudioAdapter {
  const execute = async (command: readonly string[], cwd: string) => {
    const result = await promisify(execFile)(command[0]!, command.slice(1), { cwd, shell: false, timeout: 120_000, maxBuffer: 32_768, windowsHide: true });
    return String(result.stdout);
  };
  return {
    async inspect(workspaceParent, runtimeName, config, digest) {
      return hasExactTemplateArtifact(join(workspaceParent, runtimeName), config, digest) ? "STUDIO_TEMPLATE_READY" : "STUDIO_TEMPLATE_MISMATCH";
    },
    async materialize(workspaceParent, runtimeName, config, digest) {
      const destination = join(workspaceParent, runtimeName);
      const source = templateArtifactRoot();
      if (config === undefined || digest === undefined) return "STUDIO_TEMPLATE_MISMATCH";
      if (existsSync(destination)) return hasExactTemplateArtifact(destination, config, digest) ? "STUDIO_TEMPLATE_READY" : "STUDIO_TEMPLATE_MISMATCH";
      try {
        // Do not recursively copy the template directory: that would copy
        // .gitignore or later generated directories into a workspace whose
        // immutable source manifest deliberately has only these six files
        // plus the generated, digest-bound configuration module.
        for (const path of templateArtifactPaths) {
          const target = join(destination, path);
          mkdirSync(dirname(target), { recursive: true });
          copyFileSync(join(source, path), target, 0);
        }
        writeFileSync(join(destination, publicConfigSourcePath), publicConfigSourceBytes(config, digest), { flag: "wx" });
        return hasExactTemplateArtifact(destination, config, digest) ? "STUDIO_TEMPLATE_READY" : "STUDIO_TEMPLATE_MISMATCH";
      } catch { return hasExactTemplateArtifact(destination, config, digest) ? "STUDIO_TEMPLATE_READY" : "STUDIO_TEMPLATE_MISMATCH"; }
    },
    async run(command, input) {
      try { await execute(command, input.cwd); return { exitCode: 0, reasonCode: "STUDIO_COMMAND_OK" as const }; }
      catch (error) { return { exitCode: 1, reasonCode: (error as { killed?: boolean }).killed === true ? "STUDIO_COMMAND_TIMEOUT" : "STUDIO_COMMAND_FAILED" as const }; }
    },
    async status(command) {
      try { return parseNativeStudioStatus(await execute(command, process.cwd())); } catch { return null; }
    },
    verifyEndpoint: verifyNativeStudioEndpoint
  };
}
