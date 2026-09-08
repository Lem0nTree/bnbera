import { cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
export function nativeStudioInitCommand(runtimeName: string): readonly string[] {
  if (!/^[a-z0-9]{3,23}$/.test(runtimeName)) throw new Error("AgentCore runtime names use 3–23 lowercase letters or digits only.");
  return ["bag", "init", runtimeName, "--wallet-kind", "altana", "--network", "bsc-testnet", "--destination", "platform", "--protocols", "A2A", "--rails", "8183", "--erc8183-price", "1000000000000000", "--no-auto-topup", "--no-onboard"];
}

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
      if (existsSync(destination)) return "STUDIO_TEMPLATE_MISMATCH";
      try { cpSync(source, destination, { recursive: true, errorOnExist: true }); return "STUDIO_TEMPLATE_READY"; } catch { return "STUDIO_TEMPLATE_MISMATCH"; }
    },
    async run(command, input) {
      try { await execute(command, input.cwd); return { exitCode: 0, reasonCode: "STUDIO_COMMAND_OK" as const }; }
      catch (error) { return { exitCode: 1, reasonCode: (error as { killed?: boolean }).killed === true ? "STUDIO_COMMAND_TIMEOUT" : "STUDIO_COMMAND_FAILED" as const }; }
    },
    async status(command) {
      try { return parseNativeStudioStatus(await execute(command, process.cwd())); } catch { return null; }
    },
    async reconcile(publicId) {
      return publicId.length > 0 ? "confirmed" : "unknown";
    }
  };
}
