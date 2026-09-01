import { randomUUID } from "node:crypto";
import { z } from "zod";
import { eventActorTypes } from "./constants.js";
import { canonicalSha256Hex } from "./canonical.js";

export const eventActorTypeSchema = z.enum(eventActorTypes);

export const eventEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().trim().min(1).max(160),
  occurredAt: z.string().datetime({ offset: true }),
  correlationId: z.string().trim().min(1).max(160),
  actorType: eventActorTypeSchema,
  resourceType: z.string().trim().min(1).max(160),
  resourceId: z.string().trim().min(1).max(160),
  payloadDigest: z.string().regex(/^[0-9a-f]{64}$/),
  payload: z.unknown()
});

export type EventEnvelope<TPayload = unknown> = Omit<
  z.infer<typeof eventEnvelopeSchema>,
  "payload"
> & { payload: TPayload };

export function createEventEnvelope<TPayload>(input: {
  eventType: string;
  correlationId: string;
  actorType: z.infer<typeof eventActorTypeSchema>;
  resourceType: string;
  resourceId: string;
  payload: TPayload;
  occurredAt?: Date;
}): EventEnvelope<TPayload> {
  const occurredAt = input.occurredAt ?? new Date();
  const envelope: EventEnvelope<TPayload> = {
    eventId: randomUUID(),
    eventType: input.eventType,
    occurredAt: occurredAt.toISOString(),
    correlationId: input.correlationId,
    actorType: input.actorType,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    payloadDigest: canonicalSha256Hex(input.payload),
    payload: input.payload
  };

  return eventEnvelopeSchema.parse(envelope) as EventEnvelope<TPayload>;
}
