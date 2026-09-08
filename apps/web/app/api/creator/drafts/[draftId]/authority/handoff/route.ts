import { z } from "zod";
import { getCommerceAuthDatabasePool } from "@/lib/commerce-auth";
import { CreatorAuthorityError } from "@/lib/creator-authority-runtime";
import { handoffCreatorAuthority } from "@/lib/creator-authority-handoff";
import { creatorHttpError, creatorJson, assertCreatorMutationRequest, parseCreatorJson } from "@/lib/creator-http";
import { createPostgresCreatorAuthorityStore } from "@/lib/creator-authority-store";
import { configuredCreatorAuthorityComposition, creatorRepository, requireCreatorIdentity } from "@/lib/creator-server";

const sessionKeySchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/u);
const requestSchema = z.object({
  authorityId: z.string().uuid(),
  serializedSession: z.union([z.string().min(2).max(16 * 1024), z.record(z.unknown())]),
  sessionPrivateKey: sessionKeySchema,
}).strict();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Accepts one authenticated browser session handoff. The request is bounded
 * and origin-checked; only the resulting public authority status crosses the
 * response boundary.
 */
export async function POST(request: Request, { params }: { readonly params: Promise<{ readonly draftId: string }> }): Promise<Response> {
  try {
    assertCreatorMutationRequest(request);
    const identity = await requireCreatorIdentity(request);
    const input = await parseCreatorJson(request, requestSchema, { maxBytes: 64 * 1024 });
    const { draftId } = await params;
    const authority = await creatorRepository().browserAuthorityForUser(identity.userId, input.authorityId);
    if (authority === null || authority.draftId !== draftId) throw new CreatorAuthorityError("CREATOR_AUTHORITY_NOT_FOUND", "The Creator authority was not found for this draft.");
    const composition = configuredCreatorAuthorityComposition();
    if (composition === null) throw new CreatorAuthorityError("CREATOR_AUTHORITY_UNAVAILABLE", "The secure Creator runtime handoff is not configured.");
    const store = createPostgresCreatorAuthorityStore(getCommerceAuthDatabasePool());
    const result = await handoffCreatorAuthority({
      draftId,
      ownerAddress: identity.requesterAddress,
      authority,
      serializedSession: input.serializedSession,
      sessionPrivateKey: input.sessionPrivateKey,
      gateway: composition.gateway,
      sink: composition.sink,
      store,
    });
    return creatorJson({ authority: result, runtimeReady: true, handoff: "confirmed" }, 200);
  } catch (error) {
    return creatorHttpError(error);
  }
}
