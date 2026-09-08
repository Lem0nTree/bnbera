import { mkdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  buildT8FrozenArtifacts,
  loadT8SettledCommerceFacts,
  projectT8SettledCommerceJob,
  type T8EvidenceEnvironment,
  type T8QueryExecutor
} from "../packages/greenfield/src/index.js";
import { digestArtifact } from "../packages/evidence/src/index.js";

const { Pool } = pg;

type Command = "plan" | "export" | "project";

function argument(argv: readonly string[], name: string): string | null {
  const prefix = `${name}=`;
  const inline = argv.find((value) => value.startsWith(prefix));
  if (inline !== undefined) return inline.slice(prefix.length);
  const index = argv.indexOf(name);
  return index < 0 ? null : argv[index + 1] ?? null;
}

function command(argv: readonly string[]): Command {
  const value = argv[0] ?? "plan";
  if (value === "plan" || value === "export" || value === "project") return value;
  throw new Error("Usage: t8-greenfield-inputs.ts <plan|export|project> --job-id <commerce-job-uuid> [--kind profile|run|bundle] [--write]");
}

function environment(value: string | undefined): T8EvidenceEnvironment {
  const candidate = value?.trim() || "hackathon";
  if (!["development", "preview", "hackathon", "production"].includes(candidate)) {
    throw new Error("T8 evidence environment is invalid");
  }
  return candidate as T8EvidenceEnvironment;
}

function executor(client: { readonly query: (text: string, values?: unknown[]) => Promise<{ readonly rows: readonly Record<string, unknown>[]; readonly rowCount: number | null }> }): T8QueryExecutor {
  return {
    query: async <T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: readonly unknown[]) => {
      const result = await client.query(text, values === undefined ? undefined : [...values]);
      return { rows: result.rows as readonly T[], rowCount: result.rowCount };
    }
  };
}

function outputPath(value: string | null): string | null {
  if (value === null || value === "-") return null;
  const absolute = resolve(value);
  const runtimeRoot = resolve(process.cwd(), ".runtime", "t8-greenfield-inputs") + sep;
  if (!absolute.startsWith(runtimeRoot) && !absolute.startsWith(`/tmp${sep}`)) {
    throw new Error("--output is limited to .runtime/t8-greenfield-inputs or /tmp");
  }
  return absolute;
}

async function emit(value: unknown, destination: string | null): Promise<void> {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (destination === null) {
    process.stdout.write(serialized);
    return;
  }
  await mkdir(resolve(destination, ".."), { recursive: true });
  await writeFile(destination, serialized, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ output: destination })}\n`);
}

function digestSummary(artifact: ReturnType<typeof digestArtifact>): Record<string, unknown> {
  return {
    artifactType: artifact.artifact.artifactType,
    artifactId: artifact.artifact.artifactId,
    version: artifact.artifact.version,
    sizeBytes: artifact.sizeBytes,
    sha256Digest: artifact.sha256Digest,
    keccak256Digest: artifact.keccak256Digest
  };
}

export async function runT8GreenfieldInputsCli(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<Record<string, unknown>> {
  const selectedCommand = command(argv);
  const jobId = argument(argv, "--job-id");
  if (jobId === null) throw new Error("--job-id is required");
  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl === undefined || databaseUrl.length === 0) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const query = executor(pool);
    const facts = await loadT8SettledCommerceFacts(query, jobId);
    const artifacts = buildT8FrozenArtifacts(facts, environment(env.GREENFIELD_EVIDENCE_ENVIRONMENT));
    const profileDigest = digestArtifact(artifacts.profileArtifact);
    const runDigest = digestArtifact(artifacts.runArtifact);
    if (selectedCommand === "plan") {
      return {
        command: "plan",
        readOnly: true,
        commerceJobId: artifacts.commerceJobId,
        runId: artifacts.runId,
        profile: digestSummary(profileDigest),
        run: digestSummary(runDigest),
        projection: { table: "agent_runs", writeRequired: true }
      };
    }
    if (selectedCommand === "export") {
      const requestedKind = argument(argv, "--kind") ?? "bundle";
      if (requestedKind !== "profile" && requestedKind !== "run" && requestedKind !== "bundle") throw new Error("--kind must be profile, run, or bundle");
      const value = requestedKind === "profile"
        ? artifacts.profileRows
        : requestedKind === "run"
          ? artifacts.runRows
          : { profileRows: artifacts.profileRows, runRows: artifacts.runRows };
      await emit(value, outputPath(argument(argv, "--output")));
      return { command: "export", readOnly: true, kind: requestedKind, commerceJobId: artifacts.commerceJobId, runId: artifacts.runId, profile: digestSummary(profileDigest), run: digestSummary(runDigest) };
    }
    const invalidWriteFlag = argv.find((value) => value.startsWith("--write=") || (value.startsWith("--write") && value !== "--write"));
    if (invalidWriteFlag !== undefined) throw new Error("Use the exact --write flag to authorize projection");
    if (!argv.includes("--write")) {
      return {
        command: "project",
        readOnly: true,
        writeRequested: false,
        commerceJobId: artifacts.commerceJobId,
        runId: artifacts.runId,
        profile: digestSummary(profileDigest),
        run: digestSummary(runDigest),
        message: "Preview only. Re-run with --write to insert the deterministic agent_runs projection."
      };
    }
    const client = await pool.connect();
    try {
      const result = await projectT8SettledCommerceJob(executor(client), artifacts);
      return { command: "project", readOnly: false, ...result, profile: digestSummary(profileDigest), run: digestSummary(runDigest) };
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const result = await runT8GreenfieldInputsCli(process.argv.slice(2));
  if (result.command !== "export") process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "T8 Greenfield input command failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
