import { z } from "zod";
import { erc8004IdentitySchema } from "@bnbera/domain";

/** Public, attributed directory evidence. This does not grant invocation eligibility. */
export const directoryObservationType = "registered_directory_v1";
export const directoryServiceSchema = z.object({
  name: z.string().min(1).max(128), url: z.string().url(), version: z.string().max(128).nullable()
});
export const directorySnapshotSchema = z.object({
  schemaVersion: z.literal("bnbera-directory-v1"),
  identity: erc8004IdentitySchema,
  name: z.string().min(1).max(160), description: z.string().min(1).max(2000),
  imageUrl: z.string().url().nullable(), sourceUrl: z.string().url(),
  fetchedAt: z.string().datetime(), vendorUpdatedAt: z.string().datetime().nullable(),
  /** Read-layer clock, not persisted source evidence; keeps SSR/client labels stable. */
  renderedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime().nullable(), createdTransaction: z.string().regex(/^0x[0-9a-fA-F]{64}$/).nullable(),
  registration: z.object({ status: z.enum(["resolved", "unavailable"]), uri: z.string().max(1500000).nullable(), digest: z.string().nullable(), reason: z.string().nullable() }),
  services: z.array(directoryServiceSchema).max(32), protocols: z.array(z.string().max(128)).max(32),
  skills: z.array(z.object({ id: z.string().max(160), name: z.string().max(160), description: z.string().max(2000) })).max(32),
  tags: z.array(z.string().max(128)).max(32),
  scores: z.object({ overall: z.number().min(0).max(100).nullable(), quality: z.number().min(0).max(100).nullable(), health: z.number().min(0).max(100).nullable(), activity: z.number().min(0).max(100).nullable(), metadata: z.number().min(0).max(100).nullable(), algorithm: z.string().max(128).nullable(), observedAt: z.string().datetime().nullable() }),
  feedback: z.object({ count: z.number().int().nonnegative().nullable(), average: z.number().min(0).max(100).nullable(), items: z.array(z.object({ reviewer: z.string().max(160).nullable(), value: z.string().max(100).nullable(), comment: z.string().max(2000).nullable(), tag: z.string().max(128).nullable(), observedAt: z.string().datetime().nullable() })).max(10) }),
  stats: z.object({ views: z.number().int().nonnegative().nullable(), stars: z.number().int().nonnegative().nullable(), validations: z.number().int().nonnegative().nullable() }),
  vendorHealth: z.object({ status: z.string().max(64).nullable(), checkedAt: z.string().datetime().nullable() }),
  cardCheck: z.object({ status: z.enum(["reachable", "unreachable", "unprobed"]), observedAt: z.string().datetime().nullable(), latencyMs: z.number().int().nonnegative().nullable(), url: z.string().url().nullable(), reason: z.string().max(128).nullable() }),
  aiSummary: z.string().max(1500).nullable().default(null)
});
export type DirectorySnapshot = z.infer<typeof directorySnapshotSchema>;

export function publicText(value: unknown, limit = 2000): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, limit);
  return text || null;
}
export function publicHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[|0\.)/u.test(url.hostname)) return null;
    if ([...url.searchParams.keys()].some(key => /key|token|secret|signature|auth/i.test(key))) return null;
    return url.toString();
  } catch { return null; }
}
export function publicDate(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
export function publicNumber(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum ? value : null;
}
export function publicRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Copy a small field allowlist; never persist raw vendor/registration bodies. */
export function normalizeDirectorySnapshot(raw: unknown, registration: unknown, fetchedAt = new Date().toISOString()): DirectorySnapshot {
  const vendor = publicRecord(raw);
  const metadata = publicRecord(registration);
  const identity = erc8004IdentitySchema.parse({ namespace: "eip155", chainId: vendor.chain_id, identityRegistry: vendor.contract_address, agentId: String(vendor.token_id) });
  const scores = publicRecord(vendor.scores);
  const breakdown = publicRecord(scores.breakdown);
  const vendorServices = publicRecord(vendor.services);
  const serviceValues = Array.isArray(metadata.services) ? metadata.services : Object.entries(vendorServices).map(([name, value]) => ({ name, ...publicRecord(value) }));
  const services = serviceValues.flatMap(item => {
    const entry = publicRecord(item); const name = publicText(entry.name, 128); const url = publicHttpsUrl(entry.endpoint ?? entry.url);
    return name && url ? [{ name, url, version: publicText(entry.version, 128) }] : [];
  }).slice(0,32);
  const protocols = Array.isArray(vendor.supported_protocols) ? vendor.supported_protocols.flatMap(v => publicText(v,128) ?? []) : services.map(s=>s.name);
  const count = publicNumber(vendor.total_feedbacks);
  return directorySnapshotSchema.parse({
    schemaVersion: "bnbera-directory-v1", identity,
    name: publicText(metadata.name ?? vendor.name,160) ?? `Agent #${identity.agentId}`,
    description: publicText(metadata.description ?? vendor.description) ?? "This registered agent has not published a description.",
    imageUrl: publicHttpsUrl(vendor.image_url) ?? publicHttpsUrl(metadata.image),
    sourceUrl: `https://8004scan.io/agents/${identity.chainId === 56 ? "bsc" : "bsc-testnet"}/${identity.agentId}`,
    fetchedAt, vendorUpdatedAt: publicDate(vendor.updated_at), createdAt: publicDate(vendor.created_at),
    createdTransaction: typeof vendor.created_tx_hash === "string" && /^0x[0-9a-fA-F]{64}$/u.test(vendor.created_tx_hash) ? vendor.created_tx_hash : null,
    registration: { status: "unavailable", uri: null, digest: null, reason: "REGISTRATION_NOT_RESOLVED" },
    services, protocols: [...new Set(protocols)].slice(0,32), skills: [],
    tags: Array.isArray(vendor.tags) ? vendor.tags.flatMap(v=>publicText(v,128)??[]).slice(0,32) : [],
    scores: { overall: publicNumber(vendor.total_score,100), quality: publicNumber(vendor.quality_score ?? scores.quality,100), health: publicNumber(vendor.health_score,100), activity: publicNumber(vendor.activity_score ?? scores.activity,100), metadata: publicNumber(vendor.metadata_completeness_score ?? scores.metadata_completeness,100), algorithm: publicText(breakdown.algorithm,128), observedAt: publicDate(scores.last_scored_at) },
    feedback: {count, average: count && count > 0 ? publicNumber(vendor.average_score,100) : null, items: []},
    stats: { views: publicNumber(publicRecord(publicRecord(publicRecord(breakdown.dimensions).engagement).details).view_count), stars: publicNumber(vendor.star_count), validations: publicNumber(vendor.total_validations) },
    vendorHealth: {status: publicText(vendor.health_status,64), checkedAt: publicDate(vendor.health_checked_at)},
    cardCheck: {status: "unprobed", observedAt: null, latencyMs: null, url: null, reason: "No A2A card check has been made."}, aiSummary: null
  });
}

export function directorySlug(snapshot: Pick<DirectorySnapshot, "identity" | "name">): string {
  const prefix = snapshot.name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/gu,"-").replace(/^-+|-+$/gu,"").slice(0,80) || "agent";
  return `${prefix}-${snapshot.identity.chainId}-${snapshot.identity.agentId}`;
}
