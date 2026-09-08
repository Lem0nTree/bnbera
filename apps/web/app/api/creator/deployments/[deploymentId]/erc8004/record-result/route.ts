import { transactionHashSchema } from "@bnbera/domain";
import { z } from "zod";
import { assertCreatorMutationRequest, creatorHttpError, creatorJson, parseCreatorJson } from "@/lib/creator-http";
import { creatorRegistrationService, requireCreatorIdentity } from "@/lib/creator-server";

const callsIdSchema = z.string().regex(/^0x[0-9a-f]{1,128}$/iu).nullable();
const requestSchema = z.object({
  phase: z.enum(["mint", "uri"]),
  callsId: callsIdSchema,
  transactionHash: transactionHashSchema.nullable(),
  status: z.enum(["CONFIRMED", "PENDING", "FAILED", "UNKNOWN"]),
  agentId: z.string().regex(/^(0|[1-9][0-9]*)$/u).nullable(),
  uriDigest: z.string().regex(/^[0-9a-f]{64}$/iu).nullable(),
}).strict();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Records only public SDK result metadata; it never accepts a version. */
export async function POST(request: Request, { params }: { readonly params: Promise<{ readonly deploymentId: string }> }): Promise<Response> {
  try {
    assertCreatorMutationRequest(request);
    const identity = await requireCreatorIdentity(request);
    const input = await parseCreatorJson(request, requestSchema, { maxBytes: 2_048 });
    const { deploymentId } = await params;
    return creatorJson({ registration: await creatorRegistrationService().recordResult(identity.userId, deploymentId, input, identity.requesterAddress) });
  } catch (error) {
    return creatorHttpError(error);
  }
}
