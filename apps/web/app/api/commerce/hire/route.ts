import {
  toErc8183PublicOperation
} from "@bnbera/agent-commerce";
import {
  commerceActionResponse,
  commerceHireRequestSchema
} from "@/lib/commerce-contract";
import {
  commerceHttpError,
  commerceHttpJson,
  parseCommerceJson
} from "@/lib/commerce-http";
import { getCommerceComposition } from "@/lib/commerce-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const input = await parseCommerceJson(request, commerceHireRequestSchema);
    const composition = await getCommerceComposition();
    const result = await composition.prepareHireIntent(request, input);
    const jobId = result.operation.jobId;
    return commerceHttpJson(commerceActionResponse({
      status: result.replayed ? "replayed" : "prepared",
      jobId,
      operationId: result.operation.operationId,
      operation: toErc8183PublicOperation(result.operation),
      job: result.read,
      dispatch: result.dispatch
    }));
  } catch (error) {
    return commerceHttpError(error);
  }
}
