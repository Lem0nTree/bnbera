import { agentCategorySchema, canonicalSha256Hex, type AgentCategory } from "@bnbera/domain";
import { ingestionError } from "./errors.js";
import { assertSafePublicValue } from "./normalize.js";

export const categoryClassifierVersion = "deterministic-rules-v1" as const;
export const categoryReviewStates = ["auto", "needs_review"] as const;
export type CategoryReviewState = (typeof categoryReviewStates)[number];

export type CategoryClassificationInput = {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly protocols?: readonly unknown[];
  readonly supportedProtocols?: readonly unknown[];
  readonly skills?: readonly unknown[];
  /** Normalized public labels from a validated A2A card; advertised only. */
  readonly advertisedSkills?: readonly unknown[];
  readonly domains?: readonly unknown[];
  readonly capabilities?: unknown;
  /** Optional A2A Agent Card fields discovered by a safe read-only probe. */
  readonly agentCard?: unknown;
  /** Optional MCP initialize/capability metadata discovered by a safe probe. */
  readonly mcpCapabilities?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export type CategoryEvidence = {
  readonly category: AgentCategory;
  readonly matchedTerms: readonly string[];
  readonly structuredMatches: readonly string[];
  readonly semanticMatches: readonly string[];
  readonly structuredScore: number;
  readonly semanticScore: number;
};

export type CategoryClassification = {
  readonly category: AgentCategory;
  /** 0..100 score from structured protocol/capability fields. */
  readonly structuredScore: number;
  /** 0..100 score from all accepted public text/evidence. */
  readonly semanticScore: number;
  /** 0..1 confidence; this is classifier confidence, not agent trust. */
  readonly confidence: number;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly method: typeof categoryClassifierVersion;
  readonly classifierVersion: typeof categoryClassifierVersion;
  readonly reviewState: CategoryReviewState;
};

type CategoryRule = {
  readonly category: Exclude<AgentCategory, "uncategorized">;
  readonly terms: readonly string[];
  readonly weights: Readonly<Record<string, number>>;
};

const categoryRules: readonly CategoryRule[] = [
  {
    category: "rebalancing",
    terms: ["rebalance", "rebalancing", "portfolio allocation", "asset allocation", "index portfolio", "portfolio weights"],
    weights: { capability: 28, protocol: 22, skill: 18, advertisedSkill: 26, domain: 18, name: 8, description: 6 }
  },
  {
    category: "grid-trading",
    terms: ["grid", "grid trading", "grid-trader", "grid strategy", "range trading", "market making", "market-making", "maker"],
    weights: { capability: 28, protocol: 22, skill: 18, advertisedSkill: 26, domain: 18, name: 8, description: 6 }
  },
  {
    category: "yield-optimisation",
    terms: ["yield", "yield optimizer", "yield optimiser", "apy", "apr", "vault", "staking", "liquidity mining", "farming", "lending"],
    weights: { capability: 26, protocol: 20, skill: 18, advertisedSkill: 26, domain: 18, name: 10, description: 8 }
  },
  {
    category: "health-factor",
    terms: ["health factor", "liquidation", "liquidator", "collateral", "borrow", "debt ratio", "risk monitor", "solvency"],
    weights: { capability: 28, protocol: 18, skill: 18, advertisedSkill: 26, domain: 18, name: 10, description: 8 }
  }
];

const publicText = (value: unknown, max = 2_000): string => {
  if (typeof value !== "string") return "";
  const text = value.trim().slice(0, max);
  return /[\u0000-\u001f\u007f]/u.test(text) ? "" : text;
};

function publicRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function textList(value: unknown, limit = 128): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (typeof item === "string") return [publicText(item, 256)];
      if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      return [
        record.id,
        record.name,
        record.title,
        record.description,
        ...(Array.isArray(record.tags) ? record.tags : []),
        ...(Array.isArray(record.keywords) ? record.keywords : [])
      ]
        .map((entry) => publicText(entry, 256));
    })
    .filter((item) => item.length > 0)
    .slice(0, limit);
}

function capabilityTexts(value: unknown): readonly string[] {
  const result: string[] = [];
  const visit = (current: unknown, depth: number): void => {
    if (depth > 5 || result.length >= 1_024) return;
    if (typeof current === "string") {
      const text = publicText(current, 512);
      if (text.length > 0) result.push(text);
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
      return;
    }
    if (typeof current !== "object" || current === null) return;
    for (const [key, child] of Object.entries(current)) {
      // Capability payloads can contain arbitrary vendor extensions. Include
      // only descriptive keys/values and never copy credential-like fields.
      if (/(secret|private|password|credential|authorization|token|prompt|runtime|log)/iu.test(key)) continue;
      if (/^(id|name|title|description|tags|skills|tools|actions|capabilities|requiredProtocols|allowedActions|inputSchema|outputSchema|protocols?)$/iu.test(key)) {
        if (key !== "inputSchema" && key !== "outputSchema") {
          const keyText = publicText(key, 128);
          if (keyText.length > 0) result.push(keyText);
        }
        visit(child, depth + 1);
      }
    }
  };
  visit(value, 0);
  return [...new Set(result)].slice(0, 1_024);
}

function containsTerm(text: string, term: string): boolean {
  // Public card labels commonly use `grid-trading`/`grid_trading`, while the
  // classifier rules use human-readable phrases. Treat separators uniformly
  // without broadening a rule to an ambiguous single token.
  const normalized = text.toLocaleLowerCase("en-US").replace(/[-_]+/gu, " ").replace(/\s+/gu, " ").trim();
  const needle = term.toLocaleLowerCase("en-US").replace(/[-_]+/gu, " ").replace(/\s+/gu, " ").trim();
  if (needle.includes(" ") || needle.includes("-")) return normalized.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|[^a-z])${escaped}(?:$|[^a-z])`, "iu").test(normalized);
}

function scoreRule(rule: CategoryRule, fields: Readonly<Record<string, string>>): CategoryEvidence {
  const matchedTerms = new Set<string>();
  const structuredMatches = new Set<string>();
  const semanticMatches = new Set<string>();
  let structuredScore = 0;
  let semanticScore = 0;
  for (const term of rule.terms) {
    const fieldMatches = Object.entries(fields).filter(([, text]) => containsTerm(text, term)).map(([field]) => field);
    if (fieldMatches.length === 0) continue;
    matchedTerms.add(term);
    for (const field of fieldMatches) {
      semanticScore += rule.weights[field] ?? 0;
      if (field === "capability" || field === "protocol" || field === "skill" || field === "advertisedSkill" || field === "domain") {
        structuredMatches.add(`${field}:${term}`);
        structuredScore += rule.weights[field] ?? 0;
      } else {
        semanticMatches.add(`${field}:${term}`);
      }
    }
  }
  // Repeated matches in one field should add evidence, but every score is
  // bounded before it crosses the persistence/API boundary.
  return {
    category: rule.category,
    matchedTerms: [...matchedTerms].sort(),
    structuredMatches: [...structuredMatches].sort(),
    semanticMatches: [...semanticMatches].sort(),
    structuredScore: Math.min(100, structuredScore),
    semanticScore: Math.min(100, semanticScore)
  };
}

function normalizeInput(input: CategoryClassificationInput): Readonly<Record<string, string>> {
  if (input.metadata !== undefined) assertSafePublicValue(input.metadata, "category.metadata");
  if (input.capabilities !== undefined) assertSafePublicValue(input.capabilities, "category.capabilities");
  if (input.advertisedSkills !== undefined) assertSafePublicValue(input.advertisedSkills, "category.advertisedSkills");
  if (input.agentCard !== undefined) assertSafePublicValue(input.agentCard, "category.agentCard");
  if (input.mcpCapabilities !== undefined) assertSafePublicValue(input.mcpCapabilities, "category.mcpCapabilities");
  const metadata = input.metadata ?? {};
  const metadataText = Object.entries(metadata)
    .flatMap(([key, value]) => [publicText(key, 128), publicText(value)])
    .filter((entry) => entry.length > 0)
    .join(" ")
    .slice(0, 8_000);
  const metadataRecord = metadata as Record<string, unknown>;
  const capabilities = [
    ...capabilityTexts(input.capabilities),
    ...capabilityTexts(input.mcpCapabilities)
  ].join(" ");
  const protocols = [
    ...textList(input.protocols, 64),
    ...textList(input.supportedProtocols, 64),
    ...textList(metadataRecord.protocols ?? metadataRecord.supportedProtocols, 64),
    ...textList(metadataRecord.services, 64)
  ].join(" ");
  const skills = [
    ...textList(input.skills, 128),
    ...textList(metadataRecord.skills, 128),
    ...textList(metadataRecord.oasf && typeof metadataRecord.oasf === "object" ? (metadataRecord.oasf as Record<string, unknown>).skills : undefined, 128)
  ].join(" ");
  const advertisedSkill = [
    ...textList(input.advertisedSkills, 128),
    ...(Array.isArray(input.agentCard)
      ? input.agentCard.flatMap((card) => textList(publicRecord(card)?.skills, 128))
      : textList(publicRecord(input.agentCard)?.skills, 128))
  ].join(" ");
  const domains = [
    ...textList(input.domains, 128),
    ...textList(metadataRecord.domains, 128),
    ...textList(metadataRecord.oasf && typeof metadataRecord.oasf === "object" ? (metadataRecord.oasf as Record<string, unknown>).domains : undefined, 128)
  ].join(" ");
  return {
    name: publicText(input.name, 160),
    description: publicText(input.description, 2_000),
    protocol: protocols,
    skill: skills,
    advertisedSkill,
    domain: domains,
    capability: capabilities,
    metadata: metadataText
  };
}

function confidenceFor(best: CategoryEvidence, second: CategoryEvidence | undefined, structuredPresent: boolean): number {
  if (!structuredPresent || best.structuredScore < 25) return 0;
  const margin = best.structuredScore - (second?.structuredScore ?? 0);
  const base = 0.5 + Math.min(0.4, best.structuredScore / 250);
  return Math.max(0, Math.min(1, base + Math.min(0.1, Math.max(0, margin) / 250)));
}

/**
 * Deterministic, evidence-producing classifier. It does not call an LLM and
 * deliberately leaves weak or description-only records uncategorized.
 */
export function classifyAgent(input: CategoryClassificationInput): CategoryClassification {
  const fields = normalizeInput(input);
  const evidence = categoryRules.map((rule) => scoreRule(rule, fields));
  const ranked = [...evidence].sort((a, b) => b.structuredScore - a.structuredScore || b.semanticScore - a.semanticScore || a.category.localeCompare(b.category));
  const best = ranked[0];
  const second = ranked[1];
  if (best === undefined) throw ingestionError("CATEGORY_CLASSIFICATION_FAILED", "No category rules are configured.", "configure_classifier");
  const structuredPresent = (fields.capability ?? "").length > 0 || (fields.protocol ?? "").length > 0 || (fields.skill ?? "").length > 0 || (fields.advertisedSkill ?? "").length > 0 || (fields.domain ?? "").length > 0;
  const confidence = confidenceFor(best, second, structuredPresent);
  const promote = best.structuredScore >= 25 && best.matchedTerms.length > 0 && confidence >= 0.55 && best.structuredScore > (second?.structuredScore ?? 0) + 4;
  const category: AgentCategory = promote ? best.category : "uncategorized";
  agentCategorySchema.parse(category);
  const evidenceDigest = canonicalSha256Hex({ fields, evidence });
  const acceptedEvidence = {
    matchedTerms: best.matchedTerms,
    structuredMatches: best.structuredMatches,
    semanticMatches: best.semanticMatches,
    candidates: evidence.map((item) => ({ category: item.category, structuredScore: item.structuredScore, semanticScore: item.semanticScore })),
    digest: evidenceDigest
  };
  assertSafePublicValue(acceptedEvidence, "category.evidence");
  return {
    category,
    structuredScore: best.structuredScore,
    semanticScore: best.semanticScore,
    confidence: promote ? confidence : Math.min(confidence, 0.54),
    evidence: acceptedEvidence,
    method: categoryClassifierVersion,
    classifierVersion: categoryClassifierVersion,
    reviewState: promote ? "auto" : "needs_review"
  };
}

export class DeterministicCategoryClassifier {
  public readonly version = categoryClassifierVersion;
  public classify(input: CategoryClassificationInput): CategoryClassification {
    return classifyAgent(input);
  }
}
