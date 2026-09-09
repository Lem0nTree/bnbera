import { toErc8183PublicOperation } from "@bnbera/agent-commerce";
import {
  commerceActionResponse,
  commerceSubmitRequestSchema
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
    const input = await parseCommerceJson(request, commerceSubmitRequestSchema);
    const composition = await getCommerceComposition(request);
    const result = await composition.submit(request, jobId, input);
    const resolvedJobId = result.operation.jobId ?? result.result?.jobId ?? jobId;
    const job = await composition.readWithoutActor(resolvedJobId);
    return commerceHttpJson(commerceActionResponse({
      status: result.replayed ? "replayed" : "confirmed",
      jobId: resolvedJobId,
      operationId: result.operation.operationId,
      operation: toErc8183PublicOperation(result.operation),
      job
    }));
  } catch (error) {
    return commerceHttpError(error);
  }
}
