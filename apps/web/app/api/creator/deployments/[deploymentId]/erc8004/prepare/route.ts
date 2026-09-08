import { z } from "zod";
import { assertCreatorMutationRequest, creatorHttpError, creatorJson, parseCreatorJson } from "@/lib/creator-http";
import { creatorRegistrationService, requireCreatorIdentity } from "@/lib/creator-server";

const requestSchema = z.object({ phase: z.enum(["mint", "uri"]).optional() }).strict();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Persists the public intent before the browser asks the passkey to sign.
 * The request contains only a deployment id and optional phase; all identity,
 * endpoint, profile and configuration values come from server-owned state.
 */
export async function POST(request: Request, { params }: { readonly params: Promise<{ readonly deploymentId: string }> }): Promise<Response> {
  try {
    assertCreatorMutationRequest(request);
    const identity = await requireCreatorIdentity(request);
    const input = await parseCreatorJson(request, requestSchema, { maxBytes: 256 });
    const { deploymentId } = await params;
    return creatorJson({ registration: await creatorRegistrationService().prepare(identity.userId, deploymentId, input.phase ?? "mint", identity.requesterAddress) }, 202);
  } catch (error) {
    return creatorHttpError(error);
  }
}
