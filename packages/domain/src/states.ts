import { z } from "zod";
import {
  agentCategories,
  authorityStatuses,
  claimStatuses,
  listingStatuses,
  originTypes,
  runtimeStatuses,
  verificationStatuses
} from "./constants.js";

export const originTypeSchema = z.enum(originTypes);
export const claimStatusSchema = z.enum(claimStatuses);
export const verificationStatusSchema = z.enum(verificationStatuses);
export const runtimeStatusSchema = z.enum(runtimeStatuses);
export const authorityStatusSchema = z.enum(authorityStatuses);
export const listingStatusSchema = z.enum(listingStatuses);
export const agentCategorySchema = z.enum(agentCategories);

export const agentStateAxesSchema = z.object({
  originType: originTypeSchema,
  claimStatus: claimStatusSchema,
  verificationStatus: verificationStatusSchema,
  runtimeStatus: runtimeStatusSchema,
  authorityStatus: authorityStatusSchema,
  listingStatus: listingStatusSchema
});

export type AgentStateAxes = z.infer<typeof agentStateAxesSchema>;
export type AgentStateAxis = keyof AgentStateAxes;

type StateTransitions = Readonly<Record<string, readonly string[]>>;

const transitions: Readonly<Record<Exclude<AgentStateAxis, "originType">, StateTransitions>> = {
  claimStatus: {
    unclaimed: ["claimed"],
    claimed: ["stale"],
    stale: ["claimed"]
  },
  verificationStatus: {
    pending: ["verified", "degraded", "rejected"],
    verified: ["degraded", "rejected"],
    degraded: ["verified", "rejected"],
    rejected: []
  },
  runtimeStatus: {
    live: ["unavailable", "paused"],
    unavailable: ["live", "paused"],
    paused: ["live", "unavailable"]
  },
  authorityStatus: {
    none: ["active", "expired", "revoked"],
    active: ["expired", "revoked"],
    expired: ["active", "revoked"],
    revoked: ["active"]
  },
  listingStatus: {
    draft: ["published", "paused", "suspended", "delisted"],
    published: ["paused", "suspended", "delisted"],
    paused: ["published", "suspended", "delisted"],
    suspended: ["published", "paused", "delisted"],
    delisted: []
  }
};

export function canTransition<K extends Exclude<AgentStateAxis, "originType">>(
  axis: K,
  from: AgentStateAxes[K],
  to: AgentStateAxes[K]
): boolean {
  if (from === to) {
    return true;
  }

  return transitions[axis][from]?.includes(to) ?? false;
}

export function assertStateTransition<K extends Exclude<AgentStateAxis, "originType">>(
  axis: K,
  from: AgentStateAxes[K],
  to: AgentStateAxes[K]
): void {
  if (!canTransition(axis, from, to)) {
    throw new Error(`Illegal ${axis} transition: ${from} -> ${to}`);
  }
}

export function assertOriginUnchanged(
  previous: AgentStateAxes["originType"],
  next: AgentStateAxes["originType"]
): void {
  if (previous !== next) {
    throw new Error(`originType is immutable: ${previous} -> ${next}`);
  }
}

export function assertAgentStateAxes(input: unknown): AgentStateAxes {
  return agentStateAxesSchema.parse(input);
}
