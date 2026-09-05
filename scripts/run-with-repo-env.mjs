#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = process.env.BNBERA_ENV_FILE?.trim() || resolve(repoRoot, ".env");
const envFilePresent = existsSync(envFile);

if (envFilePresent) {
  try {
    // Node 22 loads dotenv syntax without echoing values. Explicitly injected
    // environment values remain authoritative over the repo file.
    process.loadEnvFile(envFile);
  } catch {
    console.error(JSON.stringify({ code: "ENV_FILE_INVALID" }));
    process.exitCode = 2;
  }
}

const checkedEnvironmentNames = [
  "DATABASE_URL",
  "DATABASE_SSL",
  "MARKETPLACE_DATA_MODE",
  "MARKETPLACE_API_URL",
  "BNBERA_MARKETPLACE_API_URL",
  "ERC8004_INGESTION_ENABLED",
  "ERC8004SCAN_DISCOVERY_ENABLED",
  "MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED"
];

function printEnvironmentCheck() {
  const values = Object.fromEntries(
    checkedEnvironmentNames.map((name) => [name, process.env[name] === undefined ? "unset" : "set"])
  );
  console.log(JSON.stringify({
    repoRoot: "configured",
    envFile: envFilePresent ? "present" : "absent",
    values
  }, null, 2));
}

const args = process.argv.slice(2);
if (args[0] === "--check") {
  printEnvironmentCheck();
  if (process.exitCode === undefined) process.exitCode = 0;
} else {
  const commandArgs = args[0] === "--" ? args.slice(1) : args;
  if (commandArgs.length === 0 || process.exitCode !== undefined) {
    if (commandArgs.length === 0 && process.exitCode === undefined) {
      console.error(JSON.stringify({ code: "OPS_COMMAND_MISSING" }));
      process.exitCode = 2;
    }
  } else {
    const child = spawn(commandArgs[0], commandArgs.slice(1), {
      cwd: repoRoot,
      env: { ...process.env },
      stdio: "inherit"
    });

    let forwardedSignal = false;
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.on(signal, () => {
        if (!forwardedSignal) {
          forwardedSignal = true;
          child.kill(signal);
        }
      });
    }

    child.on("error", () => {
      console.error(JSON.stringify({ code: "OPS_COMMAND_NOT_FOUND" }));
      process.exitCode = 1;
    });
    child.on("exit", (code, signal) => {
      process.exitCode = code ?? (signal === null ? 1 : 130);
    });
  }
}
