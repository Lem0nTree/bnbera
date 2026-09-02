import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  agentListingEmbeddings,
  agents,
  authSessions,
  evidenceLocators,
  evidencePublicationAttempts,
  evidenceVerificationResults,
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

  it("keeps provider attempts, immutable locators, and readback results separate", () => {
    expect(Object.keys(evidencePublicationAttempts)).toEqual(
      expect.arrayContaining(["provider", "state", "idempotencyKey", "providerReference"])
    );
    expect(Object.keys(evidenceLocators)).toEqual(
      expect.arrayContaining(["provider", "uri", "sha256Digest", "keccak256Digest", "immutable"])
    );
    expect(Object.keys(evidenceVerificationResults)).toEqual(
      expect.arrayContaining(["status", "sealConfirmed", "readbackStatus", "hashesMatch", "sizeMatches"])
    );
    const migrationPath = fileURLToPath(new URL("../../migrations/0001_evidence_publication.sql", import.meta.url));
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).toContain('CREATE TYPE "publication_attempt_state"');
    expect(migration).toContain('CREATE TABLE "evidence_publication_attempts"');
    expect(migration).toContain('CREATE TABLE "evidence_locators"');
    expect(migration).toContain('CREATE TABLE "evidence_verification_results"');
  });
});
