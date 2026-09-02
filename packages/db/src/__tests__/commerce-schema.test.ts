import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  erc8183JobEvents,
  erc8183Jobs,
  paymentAttemptEvents,
  paymentAttempts,
  paymentChallenges,
  paymentReceipts,
  paymentReconciliations,
  paymentReplayReservations,
  schemaTables
} from "../schema.js";

describe("commerce and payment database schema", () => {
  it("exports distinct ERC-8183 and B402 persistence surfaces", () => {
    expect(Object.keys(schemaTables)).toEqual(expect.arrayContaining([
      "commerceJobs",
      "erc8183Jobs",
      "erc8183JobEvents",
      "paymentChallenges",
      "paymentAttempts",
      "paymentAttemptEvents",
      "paymentReceipts",
      "paymentReplayReservations",
      "paymentReconciliations"
    ]));
    expect(Object.keys(erc8183Jobs)).toEqual(expect.arrayContaining([
      "chainId", "commerceContract", "paymentToken", "budgetAtomic", "state",
      "specRevision", "abiHash", "evaluatorProfile", "confirmationThreshold",
      "minExpiryLeadSeconds", "maxExpiryHorizonSeconds", "minBudgetAtomic",
      "maxBudgetAtomic", "deploymentPinDigest"
    ]));
    expect(Object.keys(erc8183JobEvents)).toEqual(expect.arrayContaining(["eventKey", "transactionHash", "confirmationState", "payloadDigest"]));
    expect(Object.keys(paymentChallenges)).toEqual(expect.arrayContaining(["challengeDigest", "settlementNetwork", "settlementAsset", "amountAtomic", "recipient", "method", "expiresAt"]));
    expect(Object.keys(paymentAttempts)).toEqual(expect.arrayContaining([
      "idempotencyKey", "challengeId", "status", "pinDigest", "configurationVersion",
      "configurationDigest", "fixedEgressProfile", "payoutAddress", "payoutVerificationState"
    ]));
    expect(Object.keys(paymentAttempts)).not.toContain("receiptId");
    expect(Object.keys(paymentAttemptEvents)).toContain("eventKey");
    expect(Object.keys(paymentReceipts)).toEqual(expect.arrayContaining(["attemptId", "settlementTransactionHash", "payoutAddress", "receiptDigest"]));
    expect(Object.keys(paymentReplayReservations)).toEqual(expect.arrayContaining(["replayKey", "state", "expiresAt"]));
    expect(Object.keys(paymentReconciliations)).toEqual(expect.arrayContaining(["attemptId", "reasonCode", "state", "nextAttemptAt"]));
  });

  it("keeps the generated migration additive and preserves the foundation circular FK", () => {
    const migrationPath = fileURLToPath(new URL("../../migrations/0001_material_exiles.sql", import.meta.url));
    const migration = readFileSync(migrationPath, "utf8");
    for (const table of [
      "erc8183_jobs",
      "erc8183_job_events",
      "payment_challenges",
      "payment_attempts",
      "payment_attempt_events",
      "payment_receipts",
      "payment_replay_reservations",
      "payment_reconciliations"
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(migration).not.toContain('DROP CONSTRAINT "agents_current_version_id_agent_versions_id_fk"');
    expect(migration).toContain('CREATE UNIQUE INDEX "erc8183_job_network_identity_unique"');
    expect(migration).toContain('CREATE UNIQUE INDEX "payment_attempt_rail_idempotency_unique"');
    expect(migration).toContain('CREATE UNIQUE INDEX "payment_replay_key_unique"');
  });

  it("models protocol job identity and receipt ownership at their canonical boundaries", () => {
    expect(Object.keys(erc8183Jobs)).toEqual(expect.arrayContaining(["chainId", "commerceContract", "erc8183JobId"]));
    expect(Object.keys(paymentReceipts)).toContain("attemptId");
    expect(Object.keys(paymentAttempts)).not.toContain("receiptId");
  });
});
