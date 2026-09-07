import { describe, expect, it } from "vitest";
import { canonicalSha256Hex } from "@bnbera/domain";
import { GET, POST } from "./route";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de";
const CLIENT = "0x3333333333333333333333333333333333333333";
const BODY = {
  schemaVersion: "bnbera.reference.health-factor.request/v1",
  jobKey: { chainId: 97, commerceContract: COMMERCE, jobId: "7" },
  providerBinding: {
    identity: { namespace: "eip155", chainId: 97, identityRegistry: "0x1111111111111111111111111111111111111111", agentId: "42" },
    agentVersionId: "00000000-0000-4000-8000-000000000042",
    agentVersion: 1
  },
  account: CLIENT,
  protocol: "venus",
  requestedAtUnix: 2_000_001,
  lendingSnapshot: {
    collateralValueUsd: "1000",
    debtValueUsd: "500",
    liquidationThresholdBps: 8000,
    sourceKind: "caller_attested",
    sourceReference: "buyer-attested-snapshot-v1",
    observedAtUnix: 2_000_000
  }
};

describe("reference provider health-factor endpoint", () => {
  it("serves canonical result bytes with a matching digest", async () => {
    const response = await POST(new Request("http://localhost/api/reference-provider/health-factor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(BODY)
    }));
    expect(response.status).toBe(200);
    const bytes = await response.text();
    const result = JSON.parse(bytes) as Record<string, unknown>;
    expect(result).toMatchObject({ fixture: false, source: "bnbera.reference.health-factor", healthFactorExact: "1.6" });
    expect(response.headers.get("X-BNBEra-Result-SHA256")).toBe(canonicalSha256Hex(result));
  });

  it("rejects a snapshot observed after the request and exposes only readiness on GET", async () => {
    const invalid = await POST(new Request("http://localhost/api/reference-provider/health-factor", {
      method: "POST",
      body: JSON.stringify({ ...BODY, requestedAtUnix: 1_999_999 })
    }));
    expect(invalid.status).toBe(400);
    const readiness = await GET();
    expect(readiness.status).toBe(200);
    await expect(readiness.json()).resolves.toMatchObject({ status: "ready", provider: "bnbera.reference.health-factor" });
  });
});
