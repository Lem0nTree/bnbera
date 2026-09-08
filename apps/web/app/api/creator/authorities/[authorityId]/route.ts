import { creatorHttpError, creatorJson } from "@/lib/creator-http";
import { CreatorAuthorityError } from "@/lib/creator-authority-runtime";
import { creatorAuthorityStatus, creatorRepository, requireCreatorIdentity, revokeCreatorAuthorityForUser } from "@/lib/creator-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { readonly params: Promise<{ readonly authorityId: string }> }): Promise<Response> {
  try {
    const identity = await requireCreatorIdentity(request);
    const { authorityId } = await params;
    try {
      return creatorJson({ authority: await creatorAuthorityStatus(identity.userId, authorityId), runtimeReady: true });
    } catch (error) {
      // A browser-confirmed public record is useful for status/revoke even
      // while the secret-backed Studio composition is intentionally absent.
      if (!(error instanceof CreatorAuthorityError) || error.code !== "CREATOR_AUTHORITY_UNAVAILABLE") throw error;
      const browserAuthority = await creatorRepository().browserAuthorityForUser(identity.userId, authorityId);
      if (browserAuthority === null) throw error;
      const status = browserAuthority.status === "active" && browserAuthority.expiresAtUnix <= Math.floor(Date.now() / 1000) ? "expired" : browserAuthority.status;
      return creatorJson({
        authority: {
          authorityId: browserAuthority.authorityId,
          draftId: browserAuthority.draftId,
          ownerAddress: browserAuthority.ownerAddress,
          policyDigest: browserAuthority.policyDigest,
          expiresAtUnix: browserAuthority.expiresAtUnix,
          status,
          grantTransactionHash: browserAuthority.grantTransactionHash,
          revokeTransactionHash: browserAuthority.revokeTransactionHash,
          observationSource: "browser-grant",
          reasonCode: "RUNTIME_HANDOFF_PENDING",
        },
        runtimeReady: false,
      });
    }
  }
  catch (error) { return creatorHttpError(error); }
}

export async function DELETE(request: Request, { params }: { readonly params: Promise<{ readonly authorityId: string }> }): Promise<Response> {
  try { const identity = await requireCreatorIdentity(request); const { authorityId } = await params; return creatorJson({ authority: await revokeCreatorAuthorityForUser(identity.userId, authorityId) }); }
  catch (error) { return creatorHttpError(error); }
}
