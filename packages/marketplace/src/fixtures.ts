import { erc8004IdentityKey } from "@bnbera/domain";
import {
  parseMarketplaceListing,
  type MarketplaceListingInput,
  type MarketplaceListingMetadata
} from "./types.js";

export const developmentFixtureLabel = "DEVELOPMENT FIXTURE — NOT LIVE OR DISCOVERED DATA";
export const developmentFixtureTimestamp = "2026-09-02T12:00:00.000Z";
const developmentFixtureRegistry = "0x8004a818bfb912233c491871b3d84c89a494bd9e";

export type DevelopmentFixtureSpec = {
  readonly agentId: number;
  readonly slug: string;
  readonly name: string;
  readonly category: Exclude<MarketplaceListingInput["category"], "uncategorized">;
  readonly description: string;
  readonly protocol: string;
  readonly action: string;
  readonly priceAtomic: string;
};

/**
 * Synthetic supply for local contract tests and a bounded preview. The
 * fixture marker is part of the same public shape as an ingestion listing so
 * a caller cannot accidentally turn this data into an unlabeled live claim.
 */
export function createDevelopmentFixture(spec: DevelopmentFixtureSpec): MarketplaceListingInput {
  const identity = {
    namespace: "erc8004",
    chainId: 97,
    identityRegistry: developmentFixtureRegistry,
    agentId: String(spec.agentId)
  } as const;
  const identityKey = erc8004IdentityKey(identity);
  const ownerAddress = fixtureAddress(spec.agentId + 10);
  const executionWallet = fixtureAddress(spec.agentId + 20);
  const fixture = {
    isFixture: true as const,
    label: developmentFixtureLabel
  };
  const capability = {
    id: `${spec.slug}-analysis`,
    description: spec.description,
    inputSchema: {
      type: "object",
      properties: {
        request: { type: "string" }
      },
      required: ["request"]
    },
    outputSchema: {
      type: "object",
      properties: {
        recommendation: { type: "string" }
      },
      required: ["recommendation"]
    },
    requiredProtocols: [spec.protocol],
    allowedActions: [spec.action],
    maxTaskBounds: { fixture: true }
  };
  const service = {
    kind: "a2a" as const,
    url: `https://fixture.invalid/${spec.slug}/a2a`,
    protocolVersion: "fixture-a2a-v1",
    discoverySource: "manual" as const,
    validationStatus: "healthy" as const,
    observedAt: developmentFixtureTimestamp,
    latencyMs: 42,
    safeCapabilityProbe: { fixture: true }
  };
  return parseMarketplaceListing({
    identityKey,
    identity,
    ownerAddress,
    agentWallet: executionWallet,
    agentUri: `https://fixture.invalid/${spec.slug}/profile.json`,
    contentDigest: null,
    state: {
      originType: "manual_import",
      claimStatus: "unclaimed",
      verificationStatus: "verified",
      runtimeStatus: "live",
      authorityStatus: "active",
      listingStatus: "published"
    },
    slug: spec.slug,
    name: spec.name,
    description: spec.description,
    category: spec.category,
    services: [service],
    capabilities: {
      schemaVersion: "fixture-capabilities-v1",
      capabilities: [capability]
    },
    supportedProtocols: [spec.protocol],
    pricing: {
      model: "fixed",
      network: 97,
      tokenAddress: fixtureAddress(1),
      tokenSymbol: "tBNB",
      decimals: 18,
      minAtomic: spec.priceAtomic,
      maxAtomic: spec.priceAtomic,
      observedAt: developmentFixtureTimestamp
    },
    health: {
      endpointStatus: "healthy",
      observedAt: developmentFixtureTimestamp,
      latencyMs: 42,
      source: "fixture-probe"
    },
    dataFreshness: {
      status: "fresh",
      observedAt: developmentFixtureTimestamp,
      source: "fixture-data",
      maxAgeSeconds: 300
    },
    authority: {
      walletProvider: "external",
      executionWallet,
      expiresAt: "2026-09-03T12:00:00.000Z",
      spendLimitAtomic: "1000000000000000000",
      spendAsset: fixtureAddress(1),
      allowlistedContracts: [fixtureAddress(2)],
      allowlistedSelectors: ["0x12345678"],
      observedAt: developmentFixtureTimestamp
    },
    executionEvidence: {
      status: "verified",
      lastVerifiedAt: developmentFixtureTimestamp,
      reference: `fixture:evidence:${spec.slug}`
    },
    activationOffer: {
      advertised: true,
      method: "erc8183",
      label: "ERC-8183 hire (unavailable in W0/W1)"
    },
    provenance: {
      sourceKind: "fixture",
      fixture,
      sources: [
        {
          source: "manual",
          sourceReference: `fixture:${spec.slug}`,
          firstObservedAt: developmentFixtureTimestamp,
          lastObservedAt: developmentFixtureTimestamp,
          rawResponseDigest: null,
          normalizedIngestionVersion: "fixture-v1"
        }
      ],
      identityRead: {
        observedBlock: 100 + spec.agentId,
        observedBlockHash: fixtureHash(spec.agentId),
        readConsistency: "finalized",
        observedAt: developmentFixtureTimestamp
      }
    },
    fixture
  });
}

export function metadataFromFixture(listing: MarketplaceListingInput): MarketplaceListingMetadata {
  return {
    identityKey: listing.identityKey,
    slug: listing.slug,
    name: listing.name,
    description: listing.description,
    category: listing.category,
    supportedProtocols: listing.supportedProtocols,
    pricing: listing.pricing,
    dataFreshness: listing.dataFreshness,
    authority: listing.authority,
    executionEvidence: listing.executionEvidence,
    activationOffer: listing.activationOffer,
    fixture: listing.fixture
  };
}

export const developmentFixtureListings: readonly MarketplaceListingInput[] = [
  createDevelopmentFixture({
    agentId: 1,
    slug: "fixture-lp-rebalancer",
    name: "Fixture LP Rebalancer",
    category: "rebalancing",
    description: "Synthetic PancakeSwap V3 range analysis and rebalance report.",
    protocol: "pancakeswap-v3",
    action: "rebalance_lp",
    priceAtomic: "10000000000000000"
  }),
  createDevelopmentFixture({
    agentId: 2,
    slug: "fixture-grid-trader",
    name: "Fixture Grid Trader",
    category: "grid-trading",
    description: "Synthetic PancakeSwap grid band status and next-action report.",
    protocol: "pancakeswap",
    action: "rebalance_grid",
    priceAtomic: "12000000000000000"
  }),
  createDevelopmentFixture({
    agentId: 3,
    slug: "fixture-yield-router",
    name: "Fixture Yield Router",
    category: "yield-optimisation",
    description: "Synthetic Venus and Lista net-yield comparison report.",
    protocol: "venus",
    action: "compare_yield",
    priceAtomic: "8000000000000000"
  }),
  createDevelopmentFixture({
    agentId: 4,
    slug: "fixture-health-guard",
    name: "Fixture Health Guard",
    category: "health-factor",
    description: "Synthetic Venus health-factor monitoring and risk report.",
    protocol: "venus",
    action: "monitor_health_factor",
    priceAtomic: "5000000000000000"
  })
];

function fixtureAddress(value: number): string {
  return `0x${value.toString(16).padStart(40, "0")}`;
}

function fixtureHash(value: number): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}
