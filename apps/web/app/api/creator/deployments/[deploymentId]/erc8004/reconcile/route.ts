import { assertCreatorMutationRequest, creatorHttpError, creatorJson } from "@/lib/creator-http";
import { creatorRegistrationService, requireCreatorIdentity } from "@/lib/creator-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reconciles finalized registry facts and then the existing finalized G1 projection. */
export async function POST(request: Request, { params }: { readonly params: Promise<{ readonly deploymentId: string }> }): Promise<Response> {
  try {
    assertCreatorMutationRequest(request);
    const identity = await requireCreatorIdentity(request);
    const { deploymentId } = await params;
    return creatorJson({ registration: await creatorRegistrationService().reconcile(identity.userId, deploymentId, identity.requesterAddress) });
  } catch (error) {
    return creatorHttpError(error);
  }
}
