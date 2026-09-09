import { describe, expect, it } from "vitest";
import { AppError } from "@bnbera/config";
import { authHttpError } from "./commerce-auth";
import { commerceHttpError } from "./commerce-http";

describe("mutation origin HTTP denial", () => {
  it("returns forbidden rather than unavailable or unauthenticated for an invalid origin", () => {
    const error = new AppError({ code: "REQUEST_ORIGIN_INVALID", safeMessage: "Request origin is invalid.", requestId: "req_origin_test", nextAction: "reload_page" });
    expect(authHttpError(error).status).toBe(403);
    expect(commerceHttpError(error).status).toBe(403);
  });
});
