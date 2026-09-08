import { z } from "zod";
import { creatorHttpError, creatorJson, parseCreatorJson } from "@/lib/creator-http";
import { creatorAuthorityResolver, creatorRepository, requireCreatorIdentity } from "@/lib/creator-server";
import { readCreatorStandardsLock, studioReadiness } from "@/lib/creator-studio";

const requestSchema = z.object({ authorityId: z.string().uuid() }).strict();
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { readonly params: Promise<{ readonly draftId: string }> }): Promise<Response> {
  try {
    const readiness = studioReadiness(readCreatorStandardsLock());
    if (!readiness.ready) return creatorJson({ state: "blocked", reason: readiness.reason }, 503);
    const identity = await requireCreatorIdentity(request);
    const input = await parseCreatorJson(request, requestSchema);
    // T6 supplies only an expiring descriptor/reference; no secret crosses this seam.
    const { draftId } = await params;
    await creatorAuthorityResolver().requireRuntimeAuthority({ userId: identity.userId, draftId, authorityId: input.authorityId });
    return creatorJson({ deployment: await creatorRepository().queueDeployment(identity.userId, draftId, input.authorityId) }, 202);
  } catch (error) { return creatorHttpError(error); }
}
