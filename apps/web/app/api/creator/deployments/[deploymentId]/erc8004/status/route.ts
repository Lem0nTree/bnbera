import { creatorHttpError, creatorJson } from "@/lib/creator-http";
import { creatorRegistrationService, requireCreatorIdentity } from "@/lib/creator-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns the durable public registration state without triggering a write or retry. */
export async function GET(request: Request, { params }: { readonly params: Promise<{ readonly deploymentId: string }> }): Promise<Response> {
  try {
    const identity = await requireCreatorIdentity(request);
    const { deploymentId } = await params;
    return creatorJson({ registration: await creatorRegistrationService().status(identity.userId, deploymentId, identity.requesterAddress) });
  } catch (error) {
    return creatorHttpError(error);
  }
}
