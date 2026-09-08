import { creatorDraftRequestSchema } from "@/lib/creator-contract";
import { creatorHttpError, creatorJson, parseCreatorJson } from "@/lib/creator-http";
import { creatorRepository, requireCreatorIdentity } from "@/lib/creator-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const identity = await requireCreatorIdentity(request);
    return creatorJson({ drafts: await creatorRepository().listDrafts(identity.userId) });
  } catch (error) { return creatorHttpError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const identity = await requireCreatorIdentity(request);
    const input = await parseCreatorJson(request, creatorDraftRequestSchema);
    return creatorJson({ draft: await creatorRepository().createDraft(identity.userId, input) }, 201);
  } catch (error) { return creatorHttpError(error); }
}
