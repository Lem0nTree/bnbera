import { describe, expect, it, vi } from "vitest";
import {
  inspectReferenceProviderSetup,
  type ReferenceProviderSetupConfig
} from "./t5-reference-provider-setup.ts";

const OWNER = "0x2300000000000000000000000000000000000000";
const PROVIDER = "0x23bb000000000000000000000000000000000000";
const IDENTITY = {
  namespace: "eip155",
  chainId: 97,
  identityRegistry: "0x8004a818bfb912233c491871b3d84c89a494bd9e",
  agentId: "2206"
} as const;
const CARD_URL = "https://reference.example/api/reference-provider/agent-card";
const SERVICE_URL = "https://reference.example/api/reference-provider/health-factor";

const baseConfig: ReferenceProviderSetupConfig = {
  identity: IDENTITY,
  expectedOwnerAddress: OWNER,
  providerAddress: PROVIDER,
  cardUrl: CARD_URL,
  serviceUrl: SERVICE_URL,
  priceAtomic: "1000000000000000",
  secretReferenceConfigured: false
};

type IdentityRow = {
  readonly id: string;
  readonly namespace: string;
  readonly chain_id: number;
  readonly identity_registry: string;
  readonly agent_id: string;
  readonly owner_address: string | null;
  readonly agent_wallet: string | null;
  readonly agent_uri: string | null;
  readonly observed_block: number | string | null;
  readonly observed_block_hash: string | null;
  readonly read_consistency: string | null;
};

const identityRow: IdentityRow = {
  id: "00000000-0000-4000-8000-000000000220",
  namespace: IDENTITY.namespace,
  chain_id: IDENTITY.chainId,
  identity_registry: IDENTITY.identityRegistry,
  agent_id: IDENTITY.agentId,
  owner_address: OWNER,
  owner_observed_block: "123",
  agent_wallet: PROVIDER,
  agent_wallet_observed_block: "123",
  agent_uri: CARD_URL,
  agent_uri_observed_block: "123",
  observed_block: "123",
  observed_block_hash: `0x${"a".repeat(64)}`,
  read_consistency: "finalized"
};

function poolFor(row: IdentityRow = identityRow) {
  return {
    query: vi.fn(async (text: string) => {
      if (text.includes("FROM erc8004_identities")) return { rows: [row] };
      if (text.includes("FROM agent_versions")) return { rows: [{ public_metadata: null, capability_manifest: null }] };
      return { rows: [] };
    })
  } as never;
}

describe("T5 reference-provider setup authority axes", () => {
  it("accepts a distinct ERC-721 owner and provider wallet", async () => {
    const report = await inspectReferenceProviderSetup(poolFor(), baseConfig);

    expect(report).toMatchObject({
      status: "ready_to_publish",
      code: "OWNED_IDENTITY_READY",
      expectedOwnerAddress: OWNER,
      providerAddress: PROVIDER,
      priceAtomic: baseConfig.priceAtomic,
      secretReferenceConfigured: false,
      registrationPlan: { ownerAddress: OWNER, agentWallet: PROVIDER }
    });
  });

  it("rejects an unexpected owner without treating provider wallet as ownership", async () => {
    const report = await inspectReferenceProviderSetup(poolFor({ ...identityRow, owner_address: PROVIDER }), baseConfig);
    expect(report).toMatchObject({ status: "blocked", code: "IDENTITY_NOT_OWNED" });
  });

  it("rejects a missing or wrong finalized agent wallet", async () => {
    await expect(inspectReferenceProviderSetup(poolFor({ ...identityRow, agent_wallet: null }), baseConfig)).resolves.toMatchObject({
      status: "blocked",
      code: "AGENT_WALLET_REQUIRED"
    });
    await expect(inspectReferenceProviderSetup(poolFor({ ...identityRow, agent_wallet: OWNER }), baseConfig)).resolves.toMatchObject({
      status: "blocked",
      code: "AGENT_WALLET_MISMATCH"
    });
  });

  it("rejects a stale identity before assigning a price or listing", async () => {
    const report = await inspectReferenceProviderSetup(poolFor({ ...identityRow, read_consistency: "provisional" }), baseConfig);
    expect(report).toMatchObject({ status: "blocked", code: "IDENTITY_READ_NOT_FINALIZED" });
  });

  it("does not require authority resolution to report or publish the bounded operator price", async () => {
    const report = await inspectReferenceProviderSetup(poolFor(), baseConfig, { publish: true });
    expect(report.code).toBe("CAPABILITY_INGESTION_REQUIRED");
    expect(report.status).toBe("withheld");
    expect(report.priceAtomic).toBe(baseConfig.priceAtomic);
    expect(report.secretReferenceConfigured).toBe(false);
  });
});
