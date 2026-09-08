import { describe, expect, it } from "vitest";
import { PostgresMarketplaceMetadataSource } from "./marketplace-server";

const IDENTITY = {
  namespace: "eip155" as const,
  chainId: 97 as const,
  identityRegistry: "0x8004a818bfb912233c491871b3d84c89a494bd9e",
  agentId: "2206"
};

const INTERNAL_AGENT_ID = "00000000-0000-4000-8000-000000000001";
const CURRENT_VERSION_ID = "00000000-0000-4000-8000-000000000002";

type QueryCall = { readonly text: string; readonly values: readonly unknown[] };

class RecordingPool {
  readonly calls: QueryCall[] = [];

  async query<T extends Record<string, unknown>>(config: unknown, values?: readonly unknown[]) {
    const query = typeof config === "string"
      ? { text: config, values: values ?? [] }
      : config !== null && typeof config === "object" && "text" in config
        ? config as { readonly text: string; readonly values?: readonly unknown[] }
        : { text: "", values: [] as readonly unknown[] };
    this.calls.push({ text: query.text, values: query.values ?? [] });
    if (query.text.includes("FROM agents a")) {
      return { rows: [{ internal_agent_id: INTERNAL_AGENT_ID, version_id: CURRENT_VERSION_ID, version_number: 3 }] } as unknown as { rows: T[] };
    }
    return { rows: [] } as { rows: T[] };
  }
}

describe("Postgres marketplace historical evidence binding", () => {
  it("requires exact profile version and settled run/job/version bindings", async () => {
    const pool = new RecordingPool();
    await new PostgresMarketplaceMetadataSource(pool as never).readEvidenceForIdentity(IDENTITY);
    const currentQuery = pool.calls.find((call) => call.text.includes("current_version"));
    expect(currentQuery).toBeDefined();
    expect(currentQuery?.text).toMatch(/SELECT\s+av\.id,\s*av\.version\s+FROM agent_versions av/iu);
    const evidenceQuery = pool.calls.find((call) => call.text.includes("FROM evidence_objects eo"));
    expect(evidenceQuery).toBeDefined();
    expect(evidenceQuery?.values).toEqual([INTERNAL_AGENT_ID]);
    expect(evidenceQuery?.text).toContain("profile_version.id::text = eo.resource_id");
    expect(evidenceQuery?.text).toContain("profile_version.agent_id = eo.agent_id");
    expect(evidenceQuery?.text).toContain("profile_version.version = eo.version");
    expect(evidenceQuery?.text).toContain("run.agent_id = eo.agent_id");
    expect(evidenceQuery?.text).toContain("eo.resource_id = run.job_id::text");
    expect(evidenceQuery?.text).toContain("result.state = 'settled'");
    expect(evidenceQuery?.text).toContain("result.commerce_job_id = run.job_id");
    expect(evidenceQuery?.text).toContain("result_version.agent_id = eo.agent_id");
    expect(evidenceQuery?.text).toContain("result_version.version = eo.version");
    expect(evidenceQuery?.text).toContain("result.agent_version = eo.version");
    expect(evidenceQuery?.text).not.toContain("result.agent_version_id = $2");
  });

  it("does not broaden historical evidence to another agent, version, or job", async () => {
    const pool = new RecordingPool();
    await new PostgresMarketplaceMetadataSource(pool as never).readEvidenceForIdentity(IDENTITY);
    const evidenceQuery = pool.calls.find((call) => call.text.includes("FROM evidence_objects eo"));
    expect(evidenceQuery?.text).toContain("WHERE eo.agent_id = $1");
    expect(evidenceQuery?.text).toContain("AND run.agent_id = $1");
    expect(evidenceQuery?.text).toContain("AND result.agent_version_id = result_version.id");
    expect(evidenceQuery?.text).toContain("AND result.commerce_job_id = run.job_id");
    expect(evidenceQuery?.text).toContain("AND eo.resource_id = run.job_id::text");
  });
});
