import { evmAddressSchema } from "@bnbera/domain";
import { z } from "zod";
import { creatorAuthorityGrant, creatorBrowserGrantOptions } from "@/lib/creator-altana-grant";
import { creatorHttpError, creatorJson, parseCreatorJson } from "@/lib/creator-http";

const sessionPublicKeySchema = z.string().regex(/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/u);
const requestSchema = z.object({
  walletAddress: evmAddressSchema,
  sessionPublicAddress: evmAddressSchema,
  sessionPublicKey: sessionPublicKeySchema,
}).strict();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the one server-locked Creator permission set for browser review.
 * This endpoint has no mutation and accepts no call, token, router, chain, or
 * expiry inputs. The actual grant remains a passkey-confirmed SDK operation.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const input = await parseCreatorJson(request, requestSchema);
    const grantIssuedAtUnix = Math.floor(Date.now() / 1000);
    const grant = creatorAuthorityGrant({
      adminAddress: input.walletAddress as `0x${string}`,
      walletAddress: input.walletAddress as `0x${string}`,
      sessionPublicAddress: input.sessionPublicAddress as `0x${string}`,
      sessionPublicKey: input.sessionPublicKey as `0x${string}`,
      nowUnix: grantIssuedAtUnix,
    });
    return creatorJson(creatorBrowserGrantOptions(grant, grantIssuedAtUnix));
  } catch (error) {
    return creatorHttpError(error);
  }
}
