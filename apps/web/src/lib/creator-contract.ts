import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { keccak256, stringToHex } from "viem";
import { z } from "zod";

/** The only Creator artifact in the MVP. This is deliberately not a builder. */
export const creatorTradingPairs = {
  "tbnb-cake": {
    label: "tBNB → CAKE",
    token: "0x8d008b313c1d6c7fe2982f62d32da7507cf43551",
    pair: "0xd08759b57bbd0158feac17457ce5871b45e85bd9",
  },
  "tbnb-busd": {
    label: "tBNB → BUSD",
    token: "0x78867bbeef44f2326bf8ddd1941a4439382ef2a7",
    pair: "0x85ecdcdd01ebe0bfd0aba74b81ca6d7f4a53582b",
  },
} as const;

const creatorTemplateSource = {
  slug: "pancakeswap-one-shot-swap",
  semanticVersion: "1.1.0",
  // This template performs one bounded swap; it has no price bands or repeat
  // loop, so calling it a grid strategy would be misleading.
  category: "uncategorized",
  sourceCommit: "creator-bounded-customization-v1.1.0",
  displayMetadata: {
    title: "Bounded one-shot PancakeSwap native swap agent",
    description: "A reviewed BSC-testnet PancakeSwap V2 template that performs one bounded swap; it is not a grid or rebalancing strategy."
  },
  configurationSchema: {
    type: "object",
    additionalProperties: false,
    required: ["protocol", "tradingPair", "inputAmountWei", "slippageBps", "quoteMaxAgeSeconds", "deadlineSeconds"],
    properties: {
      protocol: { const: "pancakeswap-v2" },
      tradingPair: { enum: Object.keys(creatorTradingPairs) },
      inputAmountWei: { enum: ["100000000000000", "500000000000000", "1000000000000000"] },
      slippageBps: { enum: [10, 25, 50] },
      quoteMaxAgeSeconds: { enum: [30, 60] },
      deadlineSeconds: { enum: [60, 120] },
    }
  },
  capabilityManifest: { capabilities: ["pancakeswap_v2_exact_native_swap"], writeCapabilities: ["pancakeswap_v2_exact_native_swap"] },
  protocolManifest: { network: "bsc-testnet", protocols: ["A2A"], delegatedLifecycle: "erc8004_uri_and_fixed_swap" },
  // Exact BSC-testnet ERC-8004 IdentityRegistry `setAgentURI(uint256,string)`
  // lifecycle permission. Target is standards-lock chain 97; selector is from
  // the pinned IdentityRegistry ABI. The health computation remains HTTP-only.
  contractSelectorAllowlist: { chainId: 97, calls: [{ target: "0x8004a818bfb912233c491871b3d84c89a494bd9e", selectors: ["0x0af28bd3"], maxNativeValueWei: "0" }, { target: "0xd99d1c33f9fc3444f8101754abc46c52416550d1", selectors: ["0x7ff36ab5"], maxNativeValueWei: "1000000000000000" }], spend: [{ token: "native", limitAtomic: "2000000000000000", period: "hour" }], expirySeconds: 3600, intent: "own-agent-uri-or-bounded-native-swap" }
} as const;

const templateArtifactFiles = ["package.json", "app/agent/package.json", "app/agent/studio.toml", "app/agent/src/unifiedMain.ts"] as const;
function templateArtifactRoot(): string {
  const candidates = [
    process.env.BNBERA_CREATOR_TEMPLATE_ROOT,
    resolve(process.cwd(), "templates/pancakeswap-one-shot"),
    resolve(process.cwd(), "../../templates/pancakeswap-one-shot"),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  const root = candidates.find((value) => existsSync(resolve(value, "app/agent/studio.toml")));
  if (root === undefined) throw new Error("CREATOR_TEMPLATE_ARTIFACT_UNAVAILABLE");
  return root;
}
/** Hash the actual deployable artifact bytes, in a stable path-delimited form. */
export const creatorTemplateArtifactDigest = createHash("sha256").update(templateArtifactFiles.map((path) => `${path}\0${readFileSync(resolve(templateArtifactRoot(), path))}`).join("\0")).digest("hex");

/** Immutable digest of the checked-in fixed template; no claimed placeholder. */
export const creatorTemplate = {
  ...creatorTemplateSource,
  artifactDigest: creatorTemplateArtifactDigest
} as const;

export const creatorLifecycleAction = {
  target: "0x8004a818bfb912233c491871b3d84c89a494bd9e",
  selector: "0x0af28bd3",
  valueWei: 0n,
  spends: []
} as const;

export const creatorSwapPolicy = {
  router: "0xd99d1c33f9fc3444f8101754abc46c52416550d1",
  wbnb: "0xae13d989dac2f0debff460ac112a837c89baa7cd",
  pairs: creatorTradingPairs,
  selector: "0x7ff36ab5",
  maxInputAmountWei: "1000000000000000",
  maxSlippageBps: 50,
  maxQuoteAgeSeconds: 60,
  maxDeadlineSeconds: 120
} as const;

export const creatorProductionProfile = {
  chainId: 56,
  environment: "mainnet-readiness",
  router: "0x10ed43c718714eb63d5aa57b78b54704e256024e",
  factory: "0xca143ce32fe78f1f7019d7d551a6402fc5350c73",
  wbnb: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
  cake: "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82",
  pair: "0x0ed7e52944161450477ee417de9cd3a859b14fd0",
  verifiedAtBlock: 120598699,
  writesEnabled: false
} as const;

export function assertCreatorNetworkExecution(chainId: 56 | 97, env: Record<string, string | undefined> = process.env): void {
  if (chainId === 56 && env.CREATOR_MAINNET_RELEASE_ENABLED !== "true") throw new Error("CREATOR_MAINNET_WRITES_DISABLED");
}

export const creatorSwapIntentSchema = z.object({
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  sessionWallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  quoteBlock: z.number().int().nonnegative(),
  quotedAtUnix: z.number().int().positive(),
  calldataDigest: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  tradingPair: z.enum(["tbnb-cake", "tbnb-busd"]),
  inputAmountWei: z.enum(["100000000000000", "500000000000000", "1000000000000000"]),
  slippageBps: z.union([z.literal(10), z.literal(25), z.literal(50)]),
  quoteMaxAgeSeconds: z.union([z.literal(30), z.literal(60)]),
  deadlineSeconds: z.union([z.literal(60), z.literal(120)]),
  nowUnix: z.number().int().positive()
}).strict();
export function assertCreatorSwapIntent(value: z.infer<typeof creatorSwapIntentSchema>): void {
  const input = creatorSwapIntentSchema.parse(value);
  if (input.recipient.toLowerCase() !== input.sessionWallet.toLowerCase()) throw new Error("CREATOR_SWAP_RECIPIENT_DENIED");
  if (input.nowUnix - input.quotedAtUnix > input.quoteMaxAgeSeconds) throw new Error("CREATOR_SWAP_QUOTE_STALE");
}

export const creatorUriIntentSchema = z.object({
  agentId: z.string().regex(/^(0|[1-9][0-9]*)$/),
  uri: z.string().url().max(2_000)
}).strict();
export type CreatorUriIntent = z.infer<typeof creatorUriIntentSchema>;

/** Binds the delegated selector to the one created ERC-8004 identity and URI. */
export function creatorUriIntentDigest(intent: CreatorUriIntent): `0x${string}` {
  const parsed = creatorUriIntentSchema.parse(intent);
  return keccak256(stringToHex(JSON.stringify({ agentId: parsed.agentId, uri: parsed.uri })));
}

export function assertCreatorUriIntent(input: { readonly allowedAgentId: string; readonly allowedUriDigest: string; readonly intent: CreatorUriIntent; readonly authorityStatus: "active" | "revoked" | "expired" }): void {
  if (input.authorityStatus !== "active") throw new Error("CREATOR_AUTHORITY_NOT_ACTIVE");
  if (input.intent.agentId !== input.allowedAgentId || creatorUriIntentDigest(input.intent).toLowerCase() !== input.allowedUriDigest.toLowerCase()) throw new Error("CREATOR_URI_INTENT_DENIED");
}

export const creatorDraftRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  name: z.string().trim().min(3).max(80),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(80),
  description: z.string().trim().min(20).max(500),
  protocol: z.literal("pancakeswap-v2"),
  tradingPair: z.enum(["tbnb-cake", "tbnb-busd"]),
  inputAmountWei: z.enum(["100000000000000", "500000000000000", "1000000000000000"]),
  slippageBps: z.union([z.literal(10), z.literal(25), z.literal(50)]),
  quoteMaxAgeSeconds: z.union([z.literal(30), z.literal(60)]),
  deadlineSeconds: z.union([z.literal(60), z.literal(120)]),
  publicationConsent: z.literal(true)
}).strict();

export type CreatorDraftRequest = z.infer<typeof creatorDraftRequestSchema>;

/** Parse once at every persistence boundary so JSONB reloads hash identically. */
export function canonicalCreatorDraft(input: CreatorDraftRequest): CreatorDraftRequest {
  return creatorDraftRequestSchema.parse(input);
}

export function canonicalDraftConfiguration(input: CreatorDraftRequest): Record<string, unknown> {
  const parsed = canonicalCreatorDraft(input);
  return {
    protocol: parsed.protocol,
    tradingPair: parsed.tradingPair,
    inputAmountWei: parsed.inputAmountWei,
    slippageBps: parsed.slippageBps,
    quoteMaxAgeSeconds: parsed.quoteMaxAgeSeconds,
    deadlineSeconds: parsed.deadlineSeconds,
  };
}

/** Stable six-field public-runtime digest; it contains no name, user, or secret. */
export function canonicalRuntimeConfigurationDigest(configuration: Record<string, unknown>): string {
  const value = {
    protocol: configuration.protocol,
    tradingPair: configuration.tradingPair,
    inputAmountWei: configuration.inputAmountWei,
    slippageBps: configuration.slippageBps,
    quoteMaxAgeSeconds: configuration.quoteMaxAgeSeconds,
    deadlineSeconds: configuration.deadlineSeconds,
  };
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Matches T6 `authorityPolicyDigest(serializePolicy(policy))`: Keccak, not SHA-256. */
export function creatorPolicyDigest(normalizedConcretePolicy: string): `0x${string}` {
  return keccak256(stringToHex(normalizedConcretePolicy));
}

export function draftConfigurationDigest(input: CreatorDraftRequest): string {
  const parsed = canonicalCreatorDraft(input);
  return createHash("sha256").update(JSON.stringify({
    name: parsed.name, slug: parsed.slug, description: parsed.description,
    configuration: canonicalDraftConfiguration(parsed), publicationConsent: parsed.publicationConsent
  })).digest("hex");
}
