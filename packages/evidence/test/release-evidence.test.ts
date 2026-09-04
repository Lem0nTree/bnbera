import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateReleaseEvidenceDirectory } from "../src/release-evidence.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const releaseEvidenceDir = join(repositoryRoot, "docs", "release-evidence");

describe("checked-in release evidence", () => {
  it("passes the complete sanitized evidence inventory", async () => {
    const report = await validateReleaseEvidenceDirectory(repositoryRoot);

    expect(report.valid).toBe(true);
    expect(report.jsonFiles).toContain("erc8004-e2e.json");
    expect(report.jsonFiles).toContain("erc8004-registry-verification.json");
    expect(report.pngFiles.length).toBeGreaterThan(0);
    expect(report.issues).toEqual([]);
  });

  it("rejects a credential-bearing URL without changing the checkout", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "bnbera-release-evidence-"));
    try {
      await mkdir(join(temporaryRoot, "docs", "release-evidence"), { recursive: true });
      await mkdir(join(temporaryRoot, "config"), { recursive: true });
      await mkdir(join(temporaryRoot, "packages", "agent-ingestion", "abi", "erc8004"), { recursive: true });

      for (const entry of [
        "8004scan-contract-review.json",
        "erc8004-e2e.json",
        "erc8004-registry-verification.json",
        "task10-browser-verification-2026-09-04.json",
        "ingestion-postgres-smoke-2026-09-04.md"
      ]) {
        await copyFile(join(releaseEvidenceDir, entry), join(temporaryRoot, "docs", "release-evidence", entry));
      }
      for (const entry of [
        "task10-marketplace-fixture.png",
        "task10-detail-fixture.png"
      ]) {
        await copyFile(join(releaseEvidenceDir, entry), join(temporaryRoot, "docs", "release-evidence", entry));
      }
      await copyFile(join(repositoryRoot, "config", "standards.lock.json"), join(temporaryRoot, "config", "standards.lock.json"));
      for (const entry of ["IdentityRegistry.json", "ReputationRegistry.json"]) {
        await copyFile(
          join(repositoryRoot, "packages", "agent-ingestion", "abi", "erc8004", entry),
          join(temporaryRoot, "packages", "agent-ingestion", "abi", "erc8004", entry)
        );
      }

      const reviewPath = join(temporaryRoot, "docs", "release-evidence", "8004scan-contract-review.json");
      const review = JSON.parse(await readFile(reviewPath, "utf8")) as Record<string, unknown>;
      review.openApiUrl = "https://user:password@example.invalid/openapi.json";
      await writeFile(reviewPath, `${JSON.stringify(review)}\n`, "utf8");

      const report = await validateReleaseEvidenceDirectory(temporaryRoot);
      expect(report.valid).toBe(false);
      expect(report.issues.some((entry) => entry.code === "URL_CREDENTIALS")).toBe(true);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("keeps release verifiers independent of dotenv files", async () => {
    const scriptPaths = [
      join(repositoryRoot, "scripts", "erc8004-e2e.ts"),
      join(repositoryRoot, "scripts", "verify-erc8004-registries.ts"),
      join(repositoryRoot, "scripts", "validate-release-evidence.ts")
    ];
    const sources = await Promise.all(scriptPaths.map((path) => readFile(path, "utf8")));

    for (const source of sources) {
      expect(source).not.toMatch(/process\.loadEnvFile|readFile\([^\n]*\.env/iu);
    }
  });
});
