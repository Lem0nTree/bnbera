import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  readStandardsLock,
  standardsLockCandidates,
  standardsLockUnavailableCode
} from "./standards-lock";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const lockPath = fileURLToPath(new URL("../../../../config/standards.lock.json", import.meta.url));

describe("standards lock runtime loading", () => {
  it("finds the repository lock from an app/package cwd", async () => {
    const lock = await readStandardsLock({ cwd: `${repositoryRoot}/apps/web` });

    expect(lock).toMatchObject({
      schemaVersion: 1,
      semanticEmbedding: {
        provider: "openrouter",
        model: "openai/text-embedding-3-small",
        dimension: 1536,
        releaseEnabled: false
      }
    });
  });

  it("finds the repository lock from a generated Next-like bundle path", async () => {
    const bundlePath = pathToFileURL(
      `${repositoryRoot}/apps/web/.next/standalone/apps/web/.next/server/chunks/marketplace.js`
    );
    const candidates = standardsLockCandidates({
      cwd: `${repositoryRoot}/apps/web/.next/standalone/apps/web`,
      moduleUrl: bundlePath
    });

    expect(candidates).toContain(lockPath);
    await expect(readStandardsLock({
      cwd: `${repositoryRoot}/apps/web/.next/standalone/apps/web`,
      moduleUrl: bundlePath
    })).resolves.toMatchObject({ schemaVersion: 1 });
  });

  it("fails with a stable code when no repository lock is reachable", async () => {
    const missingRoot = `/tmp/bnbera-missing-lock-${process.pid}`;
    await expect(readStandardsLock({
      cwd: missingRoot,
      moduleUrl: pathToFileURL(`${missingRoot}/.next/server/chunks/marketplace.js`)
    })).rejects.toMatchObject({
      name: standardsLockUnavailableCode,
      message: standardsLockUnavailableCode
    });
  });
});
