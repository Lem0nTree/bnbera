import { transactionHashSchema } from "@bnbera/domain";
import { z } from "zod";
import { creatorHttpError, creatorJson, parseCreatorJson } from "@/lib/creator-http";
import { creatorRepository, requireCreatorIdentity } from "@/lib/creator-server";

const sessionPublicKeySchema = z.string().regex(/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/u);
const requestSchema = z.object({ sessionPublicKey: sessionPublicKeySchema, transactionHash: transactionHashSchema.nullable() }).strict();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Records a passkey-confirmed revoke using public authority metadata only. */
export async function POST(request: Request, { params }: { readonly params: Promise<{ readonly authorityId: string }> }): Promise<Response> {
  try {
    const identity = await requireCreatorIdentity(request);
    const input = await parseCreatorJson(request, requestSchema);
    const { authorityId } = await params;
    const authority = await creatorRepository().recordBrowserRevocation(identity.userId, authorityId, input.sessionPublicKey, input.transactionHash);
    return creatorJson({ authority, runtimeReady: false }, 200);
  } catch (error) {
    return creatorHttpError(error);
  }
}
