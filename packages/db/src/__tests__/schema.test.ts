import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  agentCapabilityObservations,
  agentClaimEvents,
  agentListingEmbeddings,
  agentReorgReconciliations,
  agentServiceObservations,
  agents,
  chainIngestionCheckpoints,
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
      expect.arrayContaining([
        "namespace",
        "chainId",
        "identityRegistry",
        "agentId",
        "ownerAddress",
        "ownerObservedBlock",
        "agentWallet",
        "agentWalletObservedBlock",
        "agentUriObservedBlock",
        "contentDigestObservedBlock",
        "observedBlock",
        "observedBlockHash",
        "readConsistency"
      ])
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

  it("keeps the circular current-version FK in every migration snapshot", () => {
    const migrationsPath = fileURLToPath(new URL("../../migrations", import.meta.url));
    const metaPath = join(migrationsPath, "meta");
    const snapshotFiles = readdirSync(metaPath)
      .filter((file) => /^\d+_snapshot\.json$/u.test(file))
      .sort();
    expect(snapshotFiles.length).toBeGreaterThan(0);
    for (const file of snapshotFiles) {
      const snapshot = JSON.parse(readFileSync(join(metaPath, file), "utf8")) as {
        tables?: Record<string, { foreignKeys?: Record<string, unknown> }>;
      };
      expect(
        snapshot.tables?.["public.agents"]?.foreignKeys?.["agents_current_version_id_agent_versions_id_fk"],
        `${file} must retain the circular currentVersion FK`
      ).toBeDefined();
    }
    const sqlFiles = readdirSync(migrationsPath)
      .filter((file) => /^\d+_.*\.sql$/u.test(file))
      .sort();
    for (const file of sqlFiles) {
      expect(readFileSync(join(migrationsPath, file), "utf8")).not.toMatch(
        /DROP CONSTRAINT ["']agents_current_version_id_agent_versions_id_fk["']/u
      );
    }
  });

  it("exports identity-ingestion observations and its additive migration", () => {
    const migrationPath = fileURLToPath(new URL("../../migrations/0001_identity_ingestion.sql", import.meta.url));
    const migration = readFileSync(migrationPath, "utf8");
    const observationMigrationPath = fileURLToPath(new URL("../../migrations/0002_observation_fields.sql", import.meta.url));
    const observationMigration = readFileSync(observationMigrationPath, "utf8");
    const probeMigrationPath = fileURLToPath(new URL("../../migrations/0003_service_probe_results.sql", import.meta.url));
    const probeMigration = readFileSync(probeMigrationPath, "utf8");
    const claimCasMigrationPath = fileURLToPath(new URL("../../migrations/0004_claim_cas.sql", import.meta.url));
    const claimCasMigration = readFileSync(claimCasMigrationPath, "utf8");
    const provenanceMigrationPath = fileURLToPath(new URL("../../migrations/0005_claim_provenance_observation_digests.sql", import.meta.url));
    const provenanceMigration = readFileSync(provenanceMigrationPath, "utf8");
    const readProvenanceMigrationPath = fileURLToPath(new URL("../../migrations/0006_identity_read_provenance.sql", import.meta.url));
    const readProvenanceMigration = readFileSync(readProvenanceMigrationPath, "utf8");
    expect(migration).toContain('CREATE TABLE "agent_service_observations"');
    expect(migration).toContain('CREATE TABLE "agent_capability_observations"');
    expect(migration).toContain('CREATE TABLE "agent_claim_events"');
    expect(migration).toContain('CREATE TABLE "agent_reorg_reconciliations"');
    expect(observationMigration).toContain('ADD COLUMN "observed_fields" jsonb NOT NULL');
    expect(probeMigration).toContain('CREATE TABLE "agent_service_probe_results"');
    expect(claimCasMigration).toContain('ADD COLUMN "claim_version" integer');
    expect(claimCasMigration).toContain('ADD COLUMN "actor_type" varchar(32)');
    expect(provenanceMigration).toContain('ADD COLUMN "normalized_content_digest" varchar(64)');
    expect(provenanceMigration).toContain('ADD COLUMN "payload_digest" varchar(64)');
    expect(provenanceMigration).toContain('ADD COLUMN "claim_owner_address_at_verification" varchar(42)');
    expect(provenanceMigration).not.toContain('DROP CONSTRAINT "agents_current_version_id_agent_versions_id_fk"');
    expect(readProvenanceMigration).toContain('ADD COLUMN "agent_uri_observed_block" bigint');
    expect(readProvenanceMigration).toContain('ADD COLUMN "content_digest_observed_block" bigint');
    expect(readProvenanceMigration).toContain('ADD COLUMN "observed_block_hash" varchar(66)');
    expect(readProvenanceMigration).toContain('ADD COLUMN "claim_verification_observed_block" bigint');
    expect(readProvenanceMigration).not.toContain('DROP CONSTRAINT "agents_current_version_id_agent_versions_id_fk"');
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
    expect(Object.keys(schemaTables.erc8004ChainObservations)).toEqual(
      expect.arrayContaining(["observedFields", "normalizedContentDigest", "payloadDigest"])
    );
    expect(Object.keys(chainIngestionCheckpoints)).toContain("indexerVersion");
    expect(Object.keys(agents)).toContain("claimVersion");
    expect(Object.keys(agents)).toEqual(
      expect.arrayContaining([
        "claimantAddress",
        "claimOwnerAddressAtVerification",
        "claimAgentWalletAtVerification",
        "claimVerifiedAt",
        "claimStaleAt",
        "claimLastReason",
        "claimVerificationObservedBlock",
        "claimVerificationObservedBlockHash",
        "claimVerificationReadConsistency"
      ])
    );
    expect(Object.keys(agentClaimEvents)).toEqual(expect.arrayContaining(["actorType", "actorId"]));
  });
});
