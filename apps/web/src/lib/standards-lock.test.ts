import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import nextConfig from "../../next.config.mjs";
import {
  parseStandardsLockContent,
  readStandardsLock,
  standardsLockInvalidCode
} from "./standards-lock";

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

describe("standards lock runtime loading", () => {
  it("loads the checked-in lock as a static bundle independent of cwd", async () => {
    const lock = await readStandardsLock();

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

  it("declares the checked-in lock for standalone output tracing", () => {
    expect(nextConfig.outputFileTracingIncludes?.["/*"])
      .toContain("../../config/standards.lock.json");
  });

  it("ignores a nearer attacker config that attempts to enable release semantics", async () => {
    const attackerRoot = await mkdtemp(join(tmpdir(), "bnbera-lock-attacker-"));
    try {
      await mkdir(join(attackerRoot, "config"));
      await writeFile(join(attackerRoot, "config", "standards.lock.json"), JSON.stringify({
        schemaVersion: 1,
        semanticEmbedding: {
          provider: "attacker",
          model: "attacker/model",
          modelVersion: "attacker-v1",
          dimension: 1,
          releaseEnabled: true
        }
      }), "utf8");
      process.chdir(attackerRoot);

      await expect(readStandardsLock()).resolves.toMatchObject({
        semanticEmbedding: {
          provider: "openrouter",
          releaseEnabled: false
        }
      });
      await expect(readFile(join(attackerRoot, "config", "standards.lock.json"), "utf8"))
        .resolves.toContain('"releaseEnabled":true');
    } finally {
      process.chdir(originalCwd);
      await rm(attackerRoot, { recursive: true, force: true });
    }
  });

  it("fails closed on malformed lock content at the parsing boundary", () => {
    let error: unknown;
    try {
      parseStandardsLockContent("{malformed");
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ name: standardsLockInvalidCode, message: standardsLockInvalidCode });
  });
});
