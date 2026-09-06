import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  agentCapabilityObservations,
  agentCategoryPredictions,
  agentClaimEvents,
  agentListingEmbeddings,
  agentReorgReconciliations,
  agentServiceObservations,
  agentServiceProbeResults,
  agents,
  authSessions,
  chainIngestionCheckpoints,
  commerceJobs,
  erc8004ChainObservations,
  erc8004Identities,
  erc8183Jobs,
  evidenceLocators,
  evidenceObjects,
  evidencePublicationAttempts,
  evidenceVerificationResults,
  marketplaceDiscoveryCursors,
  marketplaceIngestionRetries,
  paymentAttempts,
  paymentReceipts,
  schemaTables
} from "../schema.js";

const migrationsPath = fileURLToPath(new URL("../../migrations", import.meta.url));

describe("combined Wave 1 database schema", () => {
  it("retains the circular current-version FK in the base migration", () => {
    const migration = readFileSync(join(migrationsPath, "0000_round_wallflower.sql"), "utf8");
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

  it("contains the complete ERC-8004 identity key and independent marketplace axes", () => {
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
        "agentUri",
        "agentUriObservedBlock",
        "contentDigest",
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
        "listingStatus",
        "claimVersion",
        "claimOwnerAddressAtVerification",
        "claimAgentWalletAtVerification",
        "claimVerificationObservedBlock",
        "claimVerificationObservedBlockHash",
        "claimVerificationReadConsistency"
      ])
    );
  });

  it("keeps sessions to a digest and exports the discovery and vector tables", () => {
    expect(Object.keys(authSessions)).toContain("tokenDigest");
    expect(Object.keys(authSessions)).not.toContain("token");
    expect(Object.keys(agentListingEmbeddings)).toEqual(
      expect.arrayContaining(["embedding", "provider", "model", "dimension", "sourceTextDigest"])
    );
    expect(Object.keys(agentCategoryPredictions)).toEqual(
      expect.arrayContaining(["predictedCategory", "classifierVersion", "confidence", "reviewState"])
    );
    expect(Object.keys(schemaTables).length).toBeGreaterThanOrEqual(40);
  });

  it("exports identity observations, claim provenance, and finality fields", () => {
    expect(Object.keys(agentServiceObservations)).toEqual(
      expect.arrayContaining(["identityId", "kind", "url", "protocolVersion", "validationStatus"])
    );
    expect(Object.keys(agentServiceProbeResults)).toEqual(
      expect.arrayContaining(["identityId", "kind", "url", "validationStatus", "observedAt"])
    );
    expect(Object.keys(agentCapabilityObservations)).toEqual(
      expect.arrayContaining(["identityId", "manifestDigest", "capabilityManifest"])
    );
    expect(Object.keys(erc8004ChainObservations)).toEqual(
      expect.arrayContaining([
        "observedFields",
        "normalizedContentDigest",
        "payloadDigest",
        "blockHash",
        "confirmationState"
      ])
    );
    expect(Object.keys(chainIngestionCheckpoints)).toEqual(
      expect.arrayContaining(["lastScannedBlockHash", "lastFinalizedBlockHash", "indexerVersion"])
    );
    expect(Object.keys(agentClaimEvents)).toEqual(
      expect.arrayContaining(["actorType", "actorId", "observedOwnerAddress", "observedAgentWallet"])
    );
    expect(Object.keys(agentReorgReconciliations)).toEqual(
      expect.arrayContaining(["chainId", "identityRegistry", "commonAncestorBlock", "affectedIdentityKeys"])
    );
  });

  it("keeps the ERC-8183 and B402 rails independently pinned", () => {
    expect(Object.keys(commerceJobs)).toEqual(
      expect.arrayContaining(["erc8183JobId", "providerAgentId", "quote", "price", "status"])
    );
    expect(Object.keys(erc8183Jobs)).toEqual(
      expect.arrayContaining(["chainId", "commerceContract", "erc8183JobId", "deploymentPinDigest", "state"])
    );
    expect(Object.keys(paymentAttempts)).toEqual(
      expect.arrayContaining([
        "challengeDigest",
        "pinDigest",
        "configurationVersion",
        "configurationDigest",
        "fixedEgressProfile",
        "payoutAddress"
      ])
    );
    expect(Object.keys(paymentAttempts)).not.toContain("receiptId");
    expect(Object.keys(paymentReceipts)).toContain("attemptId");
  });

  it("keeps provider attempts, immutable locators, and readback results separate", () => {
    expect(Object.keys(evidenceObjects)).toEqual(
      expect.arrayContaining(["artifactId", "resourceId", "version", "idempotencyKey"])
    );
    expect(Object.keys(evidencePublicationAttempts)).toEqual(
      expect.arrayContaining([
        "provider",
        "providerLabel",
        "state",
        "idempotencyKey",
        "providerReference",
        "configurationDigest",
        "configuredNetwork",
        "revision",
        "leaseOwner"
      ])
    );
    expect(Object.keys(evidenceLocators)).toEqual(
      expect.arrayContaining(["provider", "providerLabel", "uri", "sha256Digest", "keccak256Digest", "immutable"])
    );
    expect(Object.keys(evidenceVerificationResults)).toEqual(
      expect.arrayContaining(["status", "sealConfirmed", "readbackStatus", "hashesMatch", "sizeMatches"])
    );
  });

  it("exports persistent marketplace scheduling state", () => {
    expect(Object.keys(marketplaceDiscoveryCursors)).toEqual(
      expect.arrayContaining(["scope", "chainId", "identityRegistry", "pageSize", "nextOffset", "total", "sweep", "lastPageAt"])
    );
    expect(Object.keys(marketplaceIngestionRetries)).toEqual(
      expect.arrayContaining(["identityId", "attemptCount", "nextAttemptAt", "lastAttemptAt", "lastSuccessAt", "lastStage", "lastErrorCode"])
    );
  });

  it("keeps the generated baseline plus an ordered legacy repair and no drop of the circular FK", () => {
    const sqlFiles = readdirSync(migrationsPath)
      .filter((file) => /^\d+_.*\.sql$/u.test(file))
      .sort();
    const wave1Files = sqlFiles.filter((file) => file.startsWith("0001_wave1_"));
    expect(sqlFiles).toEqual([
      "0000_round_wallflower.sql",
      "0001_wave1_combined.sql",
      "0002_wave1_legacy_repair.sql",
      "0003_scan_discovery_checkpoint.sql",
      "0004_swift_silverclaw.sql",
      "0005_outgoing_ezekiel.sql"
    ]);
    expect(wave1Files).toEqual(["0001_wave1_combined.sql"]);

    const wave1 = readFileSync(join(migrationsPath, "0001_wave1_combined.sql"), "utf8");
    expect(wave1).toContain('CREATE TABLE "agent_service_observations"');
    expect(wave1).toContain('CREATE TABLE "erc8183_jobs"');
    expect(wave1).toContain('CREATE TABLE "evidence_publication_attempts"');
    expect(wave1).toContain('CREATE TABLE "evidence_verification_results"');
    expect(wave1).not.toMatch(/DROP CONSTRAINT ["']agents_current_version_id_agent_versions_id_fk["']/u);
    const scanCheckpoint = readFileSync(join(migrationsPath, "0003_scan_discovery_checkpoint.sql"), "utf8");
    expect(scanCheckpoint).toContain('CREATE TABLE "scan_discovery_checkpoints"');
    expect(scanCheckpoint).not.toContain('DROP CONSTRAINT "agents_current_version_id_agent_versions_id_fk"');
    const marketplaceScheduling = readFileSync(join(migrationsPath, "0004_swift_silverclaw.sql"), "utf8");
    expect(marketplaceScheduling).toContain('CREATE TABLE "marketplace_discovery_cursors"');
    expect(marketplaceScheduling).toContain('CREATE TABLE "marketplace_ingestion_retries"');
    expect(marketplaceScheduling).not.toContain('DROP CONSTRAINT "agents_current_version_id_agent_versions_id_fk"');
    const reputation = readFileSync(join(migrationsPath, "0005_outgoing_ezekiel.sql"), "utf8");
    expect(reputation).toContain('CREATE TABLE "erc8004_reputation_events"');
    expect(reputation).toContain('CREATE TABLE "erc8004_reputation_checkpoints"');
    expect(reputation).not.toContain('DROP CONSTRAINT "agents_current_version_id_agent_versions_id_fk"');
  });
});
