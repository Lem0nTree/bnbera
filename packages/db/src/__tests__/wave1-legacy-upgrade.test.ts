import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationsPath = join(packageRoot, "migrations");
const clientPath = join(packageRoot, "src", "client.ts");
const legacySmokePath = join(packageRoot, "..", "..", "scripts", "db-migration-legacy-smoke.ts");

describe("Wave 1 legacy upgrade path", () => {
  const combined = readFileSync(join(migrationsPath, "0001_wave1_combined.sql"), "utf8");
  const repair = readFileSync(join(migrationsPath, "0002_wave1_legacy_repair.sql"), "utf8");
  const normalizedRepair = repair.replaceAll("\r\n", "\n");
  const legacySmoke = readFileSync(legacySmokePath, "utf8");
  const journal = JSON.parse(readFileSync(join(migrationsPath, "meta", "_journal.json"), "utf8")) as {
    entries: Array<{ tag: string; when: number }>;
  };

  it("orders the repair after every known branch-local history", () => {
    const repairEntry = journal.entries.find((entry) => entry.tag === "0002_wave1_legacy_repair");
    expect(repairEntry?.when).toBeGreaterThan(1788329419741); // A3 0006
    expect(repairEntry?.when).toBeGreaterThan(1788306149453); // A5 0001
    expect(repairEntry?.when).toBeGreaterThan(1788330015593); // A8 0002
  });

  it("chains the repair snapshot from the combined Wave 1 snapshot", () => {
    const combinedSnapshot = JSON.parse(
      readFileSync(join(migrationsPath, "meta", "0001_snapshot.json"), "utf8")
    ) as { id: string };
    const repairSnapshot = JSON.parse(
      readFileSync(join(migrationsPath, "meta", "0002_snapshot.json"), "utf8")
    ) as { id: string; prevId: string };

    expect(repairSnapshot.id).not.toBe(combinedSnapshot.id);
    expect(repairSnapshot.prevId).toBe(combinedSnapshot.id);
  });

  it("keeps the combined migration fresh-install safe and moves destructive cleanup into guarded repair", () => {
    expect(combined).not.toContain('DROP INDEX "commerce_erc8183_job_unique"');
    expect(repair).toContain('DROP INDEX IF EXISTS "commerce_erc8183_job_unique"');
    expect(repair).toContain('DROP COLUMN IF EXISTS "receipt_id"');
    expect(repair).toContain("legacy receipt ownership is inconsistent");
    expect(repair).toContain("canonical ERC-8183 identity indexes exist");
    expect(normalizedRepair).toContain("DECLARE\n  has_inconsistent_receipt_owner boolean;");
    expect(normalizedRepair).toContain("EXECUTE $receipt_ownership_check$");
    expect(normalizedRepair).toContain("$receipt_ownership_check$ INTO has_inconsistent_receipt_owner;");
    expect(normalizedRepair).not.toContain(") AND EXISTS (\n    SELECT 1\n    FROM \"payment_attempts\" attempt");
  });

  it("repairs all three legacy surfaces before normalized constraints are enforced", () => {
    for (const requiredColumn of [
      '"deployment_pin_digest"',
      '"configuration_digest"',
      '"lease_owner"',
      '"artifact_id"'
    ]) {
      expect(repair).toContain(`ADD COLUMN IF NOT EXISTS ${requiredColumn}`);
    }
    expect(repair).toContain('"erc8183_job_pin_digest_check"');
    expect(repair).toContain('"payment_attempt_pin_digest_check"');
  });

  it("uses savepoints and only ignores duplicate-object catalog races while replaying the older baseline", () => {
    const client = readFileSync(clientPath, "utf8");
    expect(client).toContain("SAVEPOINT bnbera_wave1_legacy_statement");
    expect(client).toContain("ROLLBACK TO SAVEPOINT bnbera_wave1_legacy_statement");
    expect(client).toContain('"42701"');
    expect(client).toContain('"42P07"');
    expect(client).not.toContain('"42704"');
    expect(client).toContain("repairLegacyWaveOneBaseline");
  });

  it("rewinds all disposable scheduling tables before replaying the latest migrations", () => {
    expect(legacySmoke).toContain('DROP TABLE IF EXISTS "marketplace_ingestion_retries" CASCADE;');
    expect(legacySmoke).toContain('DROP TABLE IF EXISTS "marketplace_discovery_cursors" CASCADE;');
    expect(legacySmoke).toContain('DROP TABLE IF EXISTS "scan_discovery_checkpoints" CASCADE;');
    expect(legacySmoke).toContain("LIMIT 5");
    expect(legacySmoke).toContain('count === "7"');
    expect(legacySmoke).toContain("MARKETPLACE_RETRY_MIGRATION_MISSING");
  });
});
