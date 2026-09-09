import {
  commerceStatusResponse
} from "@/lib/commerce-contract";
import {
  commerceHttpError,
  commerceHttpJson,
  parseCommerceJobId
} from "@/lib/commerce-http";
import { getCommerceComposition } from "@/lib/commerce-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly jobId: string }> }
): Promise<Response> {
  try {
    const { jobId: rawJobId } = await params;
    const jobId = parseCommerceJobId(rawJobId);
    const composition = await getCommerceComposition(request);
    const job = await composition.status(request, jobId);
    return commerceHttpJson(commerceStatusResponse(job));
  } catch (error) {
    return commerceHttpError(error);
  }
}
