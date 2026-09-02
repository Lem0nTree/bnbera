import { randomUUID } from "node:crypto";
import { canonicalSha256Hex } from "@bnbera/domain";
import { erc8183JobEventSchema, type Erc8183JobEvent, type Erc8183EventType, type Erc8183JobKey, type Erc8183JobState } from "./types.js";
import { assertPublicPayloadSafe, normalizeAddress } from "./validation.js";

export function createErc8183JobEvent(input: {
  readonly eventKey: string;
  readonly jobKey: Erc8183JobKey;
  readonly eventType: Erc8183EventType;
  readonly previousState: Erc8183JobState | null;
  readonly nextState: Erc8183JobState | null;
  readonly actorAddress?: string | null;
  readonly transactionHash?: `0x${string}` | null;
  readonly blockNumber?: string | null;
  readonly blockHash?: `0x${string}` | null;
  readonly logIndex?: number | null;
  readonly confirmationState?: "provisional" | "canonical" | "orphaned";
  readonly payload?: unknown;
  readonly correlationId: string;
  readonly observedAtUnix: number;
}): Erc8183JobEvent {
  const payload = input.payload ?? {};
  assertPublicPayloadSafe(payload);
  const event: Erc8183JobEvent = {
    eventId: randomUUID(),
    eventKey: input.eventKey,
    jobKey: {
      chainId: input.jobKey.chainId,
      commerceContract: normalizeAddress(input.jobKey.commerceContract, "commerce contract"),
      jobId: input.jobKey.jobId
    },
    eventType: input.eventType,
    previousState: input.previousState,
    nextState: input.nextState,
    actorAddress: input.actorAddress === undefined || input.actorAddress === null ? null : normalizeAddress(input.actorAddress, "actor address"),
    transactionHash: input.transactionHash ?? null,
    blockNumber: input.blockNumber ?? null,
    blockHash: input.blockHash ?? null,
    logIndex: input.logIndex ?? null,
    confirmationState: input.confirmationState ?? "canonical",
    payloadDigest: canonicalSha256Hex(payload),
    payload,
    correlationId: input.correlationId,
    observedAtUnix: input.observedAtUnix
  };
  return erc8183JobEventSchema.parse(event);
}
