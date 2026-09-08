import { evmAddressSchema, transactionHashSchema } from "@bnbera/domain";
import { z } from "zod";
import { creatorAuthorityGrant } from "@/lib/creator-altana-grant";
import { creatorHttpError, creatorJson, parseCreatorJson } from "@/lib/creator-http";
import { creatorRepository, requireCreatorIdentity } from "@/lib/creator-server";

const sessionPublicKeySchema = z.string().regex(/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/u);
const digestSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/u);
const requestSchema = z.object({
  walletAddress: evmAddressSchema,
  sessionPublicAddress: evmAddressSchema,
  sessionPublicKey: sessionPublicKeySchema,
  policyDigest: digestSchema,
  grantIssuedAtUnix: z.number().int().positive(),
  expiresAtUnix: z.number().int().positive(),
  grantTransactionHash: transactionHashSchema.nullable(),
}).strict();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Persists only public metadata after the browser SDK reports a confirmed
 * grant. The runtime secret/session signer is intentionally not accepted.
 */
export async function POST(request: Request, { params }: { readonly params: Promise<{ readonly draftId: string }> }): Promise<Response> {
  try {
    const identity = await requireCreatorIdentity(request);
    const input = await parseCreatorJson(request, requestSchema);
    const { draftId } = await params;
    if (identity.chainId !== 97 || identity.requesterAddress.toLowerCase() !== input.walletAddress.toLowerCase()) {
      return creatorJson({ state: "blocked", reason: "The passkey wallet must match the authenticated Creator owner on BNB Smart Chain testnet." }, 400);
    }
    const nowUnix = Math.floor(Date.now() / 1000);
    if (input.expiresAtUnix !== input.grantIssuedAtUnix + 3600 || input.expiresAtUnix <= nowUnix) {
      return creatorJson({ state: "blocked", reason: "The browser grant expiry does not match the fixed one-hour Creator authority." }, 400);
    }
    const expected = creatorAuthorityGrant({
      adminAddress: identity.requesterAddress as `0x${string}`,
      walletAddress: input.walletAddress as `0x${string}`,
      sessionPublicAddress: input.sessionPublicAddress as `0x${string}`,
      sessionPublicKey: input.sessionPublicKey as `0x${string}`,
      nowUnix: input.grantIssuedAtUnix,
    });
    if (expected.policyDigest.toLowerCase() !== input.policyDigest.toLowerCase()) {
      return creatorJson({ state: "blocked", reason: "The browser grant policy digest does not match the server-locked Creator policy." }, 400);
    }
    const authority = await creatorRepository().recordBrowserAuthority(identity.userId, draftId, {
      walletAddress: input.walletAddress,
      sessionPublicAddress: input.sessionPublicAddress,
      sessionPublicKey: input.sessionPublicKey,
      policyDigest: input.policyDigest,
      policy: expected.policy,
      grantIssuedAtUnix: input.grantIssuedAtUnix,
      expiresAtUnix: input.expiresAtUnix,
      grantTransactionHash: input.grantTransactionHash,
    });
    return creatorJson({ authority, runtimeReady: false, handoff: "pending_runtime_secret" }, 201);
  } catch (error) {
    return creatorHttpError(error);
  }
}
