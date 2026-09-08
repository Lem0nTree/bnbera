import { randomUUID } from "node:crypto";
import { AppError } from "@bnbera/config";
import { CreatorAuthorityError } from "./creator-authority-runtime";
import { CreatorRepositoryError } from "./creator-repository";

export async function parseCreatorJson<T>(request: Request, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }): Promise<T> {
  let body: unknown;
  try { body = await request.json(); } catch { throw new AppError({ code: "CREATOR_REQUEST_INVALID", safeMessage: "The Creator request must be valid JSON.", requestId: "req_creator", nextAction: "check_request" }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AppError({ code: "CREATOR_REQUEST_INVALID", safeMessage: "Use the audited health-factor template fields only.", requestId: "req_creator", nextAction: "check_request" });
  return parsed.data;
}

export function creatorJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", Vary: "Accept" } });
}

export function creatorHttpError(error: unknown): Response {
  const requestId = randomUUID();
  const code = error instanceof CreatorAuthorityError || error instanceof CreatorRepositoryError ? error.code : error instanceof AppError ? error.code : "CREATOR_UNAVAILABLE";
  const safeMessage = error instanceof CreatorAuthorityError || error instanceof CreatorRepositoryError ? error.message
    : error instanceof AppError ? error.toEnvelope().error.message
      : "Creator is temporarily unavailable.";
  const status = code === "AUTH_REQUIRED" ? 401 : code === "DRAFT_NOT_FOUND" ? 404 : code === "IDEMPOTENCY_CONFLICT" ? 409 : code.includes("AUTHORITY") || code.includes("UNAVAILABLE") ? 503 : 400;
  return creatorJson({ error: { code, safeMessage, requestId, retriable: status >= 500 } }, status);
}
