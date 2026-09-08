import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
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

/** A workspace is reusable only when it is exactly the reviewed artifact. */
function hasExactTemplateArtifact(root: string): boolean {
  try {
    const source = new URL("../../../../templates/pancakeswap-one-shot/", import.meta.url);
    const expected = new Set(templateArtifactPaths);
    const entries = (directory: string, prefix = ""): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const relative = `${prefix}${entry.name}`;
      // Studio/package-manager output is not part of the immutable source
      // artifact. It is ignored during reuse, never copied from the template.
      if (entry.isDirectory() && generatedWorkspaceDirectories.has(entry.name)) return [];
      return entry.isDirectory() ? entries(join(directory, entry.name), `${relative}/`) : [relative];
    });
    if (entries(root).some((path) => !expected.has(path as typeof templateArtifactPaths[number]))) return false;
    return templateArtifactPaths.every((path) => statSync(join(root, path)).isFile() && readFileSync(join(root, path)).equals(readFileSync(new URL(path, source))));
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
    async materialize(workspaceParent, runtimeName) {
      const destination = join(workspaceParent, runtimeName);
      const source = new URL("../../../../templates/pancakeswap-one-shot/", import.meta.url);
      if (existsSync(destination)) return hasExactTemplateArtifact(destination) ? "STUDIO_TEMPLATE_READY" : "STUDIO_TEMPLATE_MISMATCH";
      try {
        // Do not recursively copy the template directory: that would copy
        // .gitignore or later generated directories into a workspace whose
        // immutable source manifest deliberately has only these six files.
        for (const path of templateArtifactPaths) {
          const target = join(destination, path);
          mkdirSync(dirname(target), { recursive: true });
          copyFileSync(new URL(path, source), target, 0);
        }
        return hasExactTemplateArtifact(destination) ? "STUDIO_TEMPLATE_READY" : "STUDIO_TEMPLATE_MISMATCH";
      } catch { return hasExactTemplateArtifact(destination) ? "STUDIO_TEMPLATE_READY" : "STUDIO_TEMPLATE_MISMATCH"; }
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
