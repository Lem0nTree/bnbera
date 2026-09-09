import { toErc8183PublicOperation } from "@bnbera/agent-commerce";
import {
  commerceActionResponse,
  commerceSettleRequestSchema
} from "@/lib/commerce-contract";
import {
  commerceHttpError,
  commerceHttpJson,
  parseCommerceJobId,
  parseCommerceJson
} from "@/lib/commerce-http";
import { getCommerceComposition } from "@/lib/commerce-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { readonly params: Promise<{ readonly jobId: string }> }
): Promise<Response> {
  try {
    const { jobId: rawJobId } = await params;
    const jobId = parseCommerceJobId(rawJobId);
    const input = await parseCommerceJson(request, commerceSettleRequestSchema);
    const composition = await getCommerceComposition(request);
    const result = await composition.settle(request, jobId, input.idempotencyKey);
    return commerceHttpJson(commerceActionResponse({
      status: result.replayed ? "replayed" : "prepared",
      jobId: result.operation.jobId ?? jobId,
      operationId: result.operation.operationId,
      operation: toErc8183PublicOperation(result.operation),
      job: result.read,
      dispatch: result.dispatch
    }));
  } catch (error) {
    return commerceHttpError(error);
  }
}
