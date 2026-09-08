import { creatorHttpError, creatorJson } from "@/lib/creator-http";
import { creatorAuthorityStatus, requireCreatorIdentity, revokeCreatorAuthorityForUser } from "@/lib/creator-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { readonly params: Promise<{ readonly authorityId: string }> }): Promise<Response> {
  try { const identity = await requireCreatorIdentity(request); const { authorityId } = await params; return creatorJson({ authority: await creatorAuthorityStatus(identity.userId, authorityId) }); }
  catch (error) { return creatorHttpError(error); }
}

export async function DELETE(request: Request, { params }: { readonly params: Promise<{ readonly authorityId: string }> }): Promise<Response> {
  try { const identity = await requireCreatorIdentity(request); const { authorityId } = await params; return creatorJson({ authority: await revokeCreatorAuthorityForUser(identity.userId, authorityId) }); }
  catch (error) { return creatorHttpError(error); }
}
