import { z } from "zod";
import {
  discoverySources,
  eligibilityReasonCodes,
  serviceKinds,
  serviceValidationStatuses
} from "./constants.js";

const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "Service URL must use HTTP or HTTPS");

export const serviceKindSchema = z.enum(serviceKinds);
export const serviceDiscoverySourceSchema = z.enum(discoverySources);
export const serviceValidationStatusSchema = z.enum(serviceValidationStatuses);

export const advertisedServiceSchema = z.object({
  kind: serviceKindSchema,
  url: httpUrlSchema,
  protocolVersion: z.string().trim().min(1).max(128),
  discoverySource: serviceDiscoverySourceSchema,
  validationStatus: serviceValidationStatusSchema,
  observedAt: z.string().datetime({ offset: true }),
  latencyMs: z.number().int().nonnegative().max(300_000).nullable().optional(),
  safeCapabilityProbe: z.record(z.string(), z.unknown()).nullable().optional()
});

export type AdvertisedService = z.infer<typeof advertisedServiceSchema>;

const jsonSchemaObject = z.record(z.string(), z.unknown());

export const capabilitySchema = z.object({
  id: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2_000),
  inputSchema: jsonSchemaObject,
  outputSchema: jsonSchemaObject,
  requiredProtocols: z.array(z.string().trim().min(1).max(128)).max(32).default([]),
  allowedActions: z.array(z.string().trim().min(1).max(160)).max(64).default([]),
  maxTaskBounds: z.record(z.string(), z.unknown()).optional()
});

export const capabilityManifestSchema = z.object({
  schemaVersion: z.string().trim().min(1).max(64),
  capabilities: z.array(capabilitySchema).min(1).max(128)
});

export type Capability = z.infer<typeof capabilitySchema>;
export type CapabilityManifest = z.infer<typeof capabilityManifestSchema>;

export const eligibilityReasonCodeSchema = z.enum(eligibilityReasonCodes);

export const eligibilityReasonSchema = z.object({
  code: eligibilityReasonCodeSchema,
  message: z.string().trim().min(1).max(500)
});

export const scoreComponentsSchema = z.object({
  capability: z.number().min(0).max(35),
  health: z.number().min(0).max(20),
  dataQuality: z.number().min(0).max(15),
  authority: z.number().min(0).max(15),
  execution: z.number().min(0).max(10),
  price: z.number().min(0).max(5)
});

export type ScoreComponents = z.infer<typeof scoreComponentsSchema>;

export const marketplaceEligibilityResultSchema = z.object({
  eligible: z.boolean(),
  score: z.number().min(0).max(100).nullable(),
  components: scoreComponentsSchema.nullable(),
  reasons: z.array(eligibilityReasonSchema)
});

export type MarketplaceEligibilityResult = z.infer<typeof marketplaceEligibilityResultSchema>;
