import { createHash } from "node:crypto";
import { keccak256, stringToHex } from "viem";
import { z } from "zod";

/** The only Creator artifact in the MVP. This is deliberately not a builder. */
const creatorTemplateSource = {
  slug: "health-factor-monitor",
  semanticVersion: "1.0.0",
  category: "health-factor",
  sourceCommit: "creator-fixed-template-v1",
  displayMetadata: {
    title: "Health-factor monitor",
    description: "A fixed, read-only health-factor monitoring agent for BSC testnet.",
    audited: true
  },
  configurationSchema: {
    type: "object",
    additionalProperties: false,
    required: ["protocol", "refreshMinutes"],
    properties: { protocol: { const: "venus" }, refreshMinutes: { enum: [5, 15, 30] } }
  },
  capabilityManifest: { capabilities: ["health_factor_read"], writeCapabilities: [] },
  protocolManifest: { network: "bsc-testnet", protocols: ["A2A"] },
  // Exact BSC-testnet ERC-8004 IdentityRegistry `setAgentURI(uint256,string)`
  // lifecycle permission. Target is standards-lock chain 97; selector is from
  // the pinned IdentityRegistry ABI. The health computation remains HTTP-only.
  contractSelectorAllowlist: { chainId: 97, calls: [{ target: "0x8004a818bfb912233c491871b3d84c89a494bd9e", selectors: ["0x0af28bd3"], maxNativeValueWei: "0" }], spend: [] }
} as const;

/** Immutable digest of the checked-in fixed template; no claimed placeholder. */
export const creatorTemplate = {
  ...creatorTemplateSource,
  artifactDigest: createHash("sha256").update(JSON.stringify(creatorTemplateSource)).digest("hex")
} as const;

export const creatorLifecycleAction = {
  target: "0x8004a818bfb912233c491871b3d84c89a494bd9e",
  selector: "0x0af28bd3",
  valueWei: 0n,
  spends: []
} as const;

export const creatorDraftRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  name: z.string().trim().min(3).max(80),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(80),
  description: z.string().trim().min(20).max(500),
  protocol: z.literal("venus"),
  refreshMinutes: z.union([z.literal(5), z.literal(15), z.literal(30)]),
  publicationConsent: z.literal(true)
}).strict();

export type CreatorDraftRequest = z.infer<typeof creatorDraftRequestSchema>;

export function canonicalDraftConfiguration(input: CreatorDraftRequest): Record<string, unknown> {
  return { protocol: input.protocol, refreshMinutes: input.refreshMinutes };
}

/** Matches T6 `authorityPolicyDigest(serializePolicy(policy))`: Keccak, not SHA-256. */
export function creatorPolicyDigest(normalizedConcretePolicy: string): `0x${string}` {
  return keccak256(stringToHex(normalizedConcretePolicy));
}

export function draftConfigurationDigest(input: CreatorDraftRequest): string {
  return createHash("sha256").update(JSON.stringify({
    name: input.name, slug: input.slug, description: input.description,
    configuration: canonicalDraftConfiguration(input), publicationConsent: input.publicationConsent
  })).digest("hex");
}
