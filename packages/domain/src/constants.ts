export const agentCategories = [
  "rebalancing",
  "grid-trading",
  "yield-optimisation",
  "health-factor",
  "uncategorized"
] as const;

export type AgentCategory = (typeof agentCategories)[number];

export const originTypes = ["discovered", "manual_import", "created"] as const;
export type OriginType = (typeof originTypes)[number];

export const claimStatuses = ["unclaimed", "claimed", "stale"] as const;
export type ClaimStatus = (typeof claimStatuses)[number];

export const verificationStatuses = [
  "pending",
  "verified",
  "degraded",
  "rejected"
] as const;
export type VerificationStatus = (typeof verificationStatuses)[number];

export const runtimeStatuses = ["live", "unavailable", "paused"] as const;
export type RuntimeStatus = (typeof runtimeStatuses)[number];

export const authorityStatuses = ["none", "active", "expired", "revoked"] as const;
export type AuthorityStatus = (typeof authorityStatuses)[number];

export const listingStatuses = [
  "draft",
  "published",
  "paused",
  "suspended",
  "delisted"
] as const;
export type ListingStatus = (typeof listingStatuses)[number];

export const discoverySources = [
  "8004scan",
  "registry_event",
  "manual",
  "creator"
] as const;
export type DiscoverySource = (typeof discoverySources)[number];

export const chainObservationStates = ["provisional", "canonical", "orphaned"] as const;
export type ChainObservationState = (typeof chainObservationStates)[number];

export const serviceKinds = [
  "a2a",
  "mcp",
  "x402",
  "mpp",
  "readiness",
  "adapter"
] as const;
export type ServiceKind = (typeof serviceKinds)[number];

export const serviceValidationStatuses = [
  "pending",
  "healthy",
  "unhealthy",
  "rejected"
] as const;
export type ServiceValidationStatus = (typeof serviceValidationStatuses)[number];

export const walletProviders = ["altana", "external", "unknown"] as const;
export type WalletProvider = (typeof walletProviders)[number];

export const templateReleaseStatuses = ["draft", "review", "activated", "retired"] as const;
export type TemplateReleaseStatus = (typeof templateReleaseStatuses)[number];

export const draftStatuses = [
  "draft",
  "awaiting_authority",
  "authority_confirming",
  "confirmed",
  "cancelled"
] as const;
export type DraftStatus = (typeof draftStatuses)[number];

export const deploymentStates = [
  "draft",
  "awaiting_authority",
  "authority_confirming",
  "queued",
  "validating",
  "building",
  "provisioning_secrets",
  "deploying_runtime",
  "configuring_ingress",
  "health_checking",
  "registering_identity",
  "configuring_commerce",
  "executing_canary",
  "publishing_evidence",
  "verifying",
  "listed",
  "failed",
  "paused",
  "revoked",
  "destroying",
  "destroyed"
] as const;
export type DeploymentState = (typeof deploymentStates)[number];

export const commerceJobStatuses = [
  "draft",
  "negotiating",
  "funded",
  "accepted",
  "submitted",
  "completed",
  "rejected",
  "disputed",
  "settled",
  "cancelled"
] as const;
export type CommerceJobStatus = (typeof commerceJobStatuses)[number];

export const evidenceStates = [
  "pending",
  "validating",
  "creating_object",
  "uploading",
  "awaiting_seal",
  "reading_back",
  "verified",
  "validation_failed",
  "create_failed",
  "upload_failed",
  "seal_timeout",
  "readback_failed",
  "hash_mismatch"
] as const;
export type EvidenceState = (typeof evidenceStates)[number];

export const eventActorTypes = ["user", "agent", "system", "administrator"] as const;
export type EventActorType = (typeof eventActorTypes)[number];

export const eligibilityReasonCodes = [
  "WRONG_CHAIN",
  "WRONG_CATEGORY",
  "PROTOCOL_UNSUPPORTED",
  "ENDPOINT_UNHEALTHY",
  "IDENTITY_UNRESOLVED",
  "AUTHORITY_MISSING",
  "AUTHORITY_EXPIRED",
  "AUTHORITY_REVOKED",
  "AMOUNT_EXCEEDS_POLICY",
  "SELECTOR_NOT_ALLOWLISTED",
  "PRICE_EXCEEDS_MAXIMUM",
  "DATA_STALE",
  "CAPABILITY_INCOMPATIBLE",
  "LISTING_NOT_PUBLISHED",
  "VERIFICATION_PENDING",
  "VERIFICATION_REJECTED"
] as const;
export type EligibilityReasonCode = (typeof eligibilityReasonCodes)[number];
