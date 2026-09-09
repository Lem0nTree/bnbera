import {
  commerceReviewRequestSchema,
  commerceReviewResponse
} from "@/lib/commerce-contract";
import {
  commerceHttpError,
  commerceHttpJson,
  parseCommerceJson,
  parseCommerceParentJobId
} from "@/lib/commerce-http";
import { getCommerceComposition } from "@/lib/commerce-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { readonly params: Promise<{ readonly commerceJobId: string }> }
): Promise<Response> {
  try {
    const { commerceJobId: rawCommerceJobId } = await params;
    const commerceJobId = parseCommerceParentJobId(rawCommerceJobId);
    const input = await parseCommerceJson(request, commerceReviewRequestSchema);
    const composition = await getCommerceComposition(request);
    const result = await composition.createReview(request, { ...input, comment: input.comment ?? "", commerceJobId });
    return commerceHttpJson(commerceReviewResponse({ status: result.replayed ? "replayed" : "created", review: result.review }));
  } catch (error) {
    return commerceHttpError(error);
  }
}
