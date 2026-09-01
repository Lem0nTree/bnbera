import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  agentCapabilityObservations,
  agentClaimEvents,
  agentListingEmbeddings,
  agentReorgReconciliations,
  agentServiceObservations,
  agents,
  authSessions,
  erc8004Identities,
  schemaTables
} from "../schema.js";

describe("foundation database schema", () => {
  it("adds the current-version FK after both circular tables are created", () => {
    const migrationPath = fileURLToPath(new URL("../../migrations/0000_round_wallflower.sql", import.meta.url));
    const migration = readFileSync(migrationPath, "utf8");
    const versionsTable = migration.indexOf('CREATE TABLE "agent_versions"');
    const currentVersionConstraint = migration.indexOf(
      'ALTER TABLE "agents" ADD CONSTRAINT "agents_current_version_id_agent_versions_id_fk"'
    );

    expect(versionsTable).toBeGreaterThanOrEqual(0);
    expect(currentVersionConstraint).toBeGreaterThan(versionsTable);
    expect(migration).toContain(
      'FOREIGN KEY ("current_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE set null ON UPDATE no action'
    );
  });

  it("contains the complete identity key and independent marketplace axes", () => {
    expect(Object.keys(erc8004Identities)).toEqual(
      expect.arrayContaining(["namespace", "chainId", "identityRegistry", "agentId", "ownerAddress", "agentWallet"])
    );
    expect(Object.keys(agents)).toEqual(
      expect.arrayContaining([
        "originType",
        "claimStatus",
        "verificationStatus",
        "runtimeStatus",
        "authorityStatus",
        "listingStatus"
      ])
    );
  });

  it("keeps session storage to a digest and includes the pinned vector shape", () => {
    expect(Object.keys(authSessions)).toContain("tokenDigest");
    expect(Object.keys(authSessions)).not.toContain("token");
    expect(Object.keys(agentListingEmbeddings)).toEqual(
      expect.arrayContaining(["embedding", "provider", "model", "dimension", "sourceTextDigest"])
    );
  });

  it("exports every foundation table for downstream repositories", () => {
    expect(Object.keys(schemaTables).length).toBeGreaterThanOrEqual(20);
  });

  it("exports identity-ingestion observations and its additive migration", () => {
    const migrationPath = fileURLToPath(new URL("../../migrations/0001_identity_ingestion.sql", import.meta.url));
    const migration = readFileSync(migrationPath, "utf8");
    const observationMigrationPath = fileURLToPath(new URL("../../migrations/0002_observation_fields.sql", import.meta.url));
    const observationMigration = readFileSync(observationMigrationPath, "utf8");
    const probeMigrationPath = fileURLToPath(new URL("../../migrations/0003_service_probe_results.sql", import.meta.url));
    const probeMigration = readFileSync(probeMigrationPath, "utf8");
    expect(migration).toContain('CREATE TABLE "agent_service_observations"');
    expect(migration).toContain('CREATE TABLE "agent_capability_observations"');
    expect(migration).toContain('CREATE TABLE "agent_claim_events"');
    expect(migration).toContain('CREATE TABLE "agent_reorg_reconciliations"');
    expect(observationMigration).toContain('ADD COLUMN "observed_fields" jsonb NOT NULL');
    expect(probeMigration).toContain('CREATE TABLE "agent_service_probe_results"');
    expect(Object.keys(schemaTables)).toEqual(
      expect.arrayContaining([
        "agentServiceObservations",
        "agentServiceProbeResults",
        "agentCapabilityObservations",
        "agentClaimEvents",
        "agentReorgReconciliations"
      ])
    );
    expect(Object.keys(agentServiceObservations)).toEqual(
      expect.arrayContaining(["identityId", "kind", "url", "protocolVersion", "validationStatus"])
    );
    expect(Object.keys(agentCapabilityObservations)).toEqual(
      expect.arrayContaining(["identityId", "manifestDigest", "capabilityManifest"])
    );
    expect(Object.keys(agentClaimEvents)).toEqual(
      expect.arrayContaining(["identityId", "claimantAddress", "observedOwnerAddress", "observedAgentWallet"])
    );
    expect(Object.keys(agentReorgReconciliations)).toEqual(
      expect.arrayContaining(["chainId", "identityRegistry", "commonAncestorBlock", "affectedIdentityKeys"])
    );
    expect(Object.keys(schemaTables.erc8004ChainObservations)).toContain("observedFields");
  });
});
