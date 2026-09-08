import { readFileSync } from "node:fs";

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
  return ["bag", "init", runtimeName, "--wallet-kind", "altana", "--network", "bsc-testnet", "--no-onboard"];
}
