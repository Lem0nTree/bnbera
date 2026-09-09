import { z } from "zod";
import { commerceHttpError, commerceHttpJson, parseCommerceJson, parseCommerceJobId } from "@/lib/commerce-http";
import { getCommerceComposition } from "@/lib/commerce-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }): Promise<Response> {
  try {
    await parseCommerceJson(request, z.object({}).strict());
    const jobId = parseCommerceJobId((await params).jobId);
    const composition = await getCommerceComposition(request);
    return commerceHttpJson(await composition.notifyExternalSeller(request, jobId));
  } catch (error) { return commerceHttpError(error); }
}
