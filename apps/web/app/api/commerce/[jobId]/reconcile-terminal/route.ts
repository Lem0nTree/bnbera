import { z } from "zod";
import type { Hex } from "viem";
import { commerceHttpError, commerceHttpJson, parseCommerceJson, parseCommerceJobId } from "@/lib/commerce-http";
import { getCommerceComposition } from "@/lib/commerce-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }): Promise<Response> {
  try {
    const input = await parseCommerceJson(request, z.object({ transactionHash: z.string().regex(/^0x[0-9a-f]{64}$/iu) }).strict());
    const composition = await getCommerceComposition(request);
    return commerceHttpJson(await composition.reconcileExternalTerminal(request, parseCommerceJobId((await params).jobId), input.transactionHash as Hex));
  } catch (error) { return commerceHttpError(error); }
}
