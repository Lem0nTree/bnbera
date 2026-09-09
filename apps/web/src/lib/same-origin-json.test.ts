import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSameOriginJsonMutation } from "./same-origin-json";
describe("browser mutation origin boundary", () => {
  afterEach(() => vi.unstubAllEnvs());
  const request = (headers: Record<string, string> = {}) => new Request("https://bnbera.ritarda.to/api/commerce/hire", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });
  it("accepts same-origin requests and authenticated non-browser JSON clients", () => {
    expect(() => assertSameOriginJsonMutation(request({ origin: "https://bnbera.ritarda.to" }))).not.toThrow();
    expect(() => assertSameOriginJsonMutation(request())).not.toThrow();
  });
  it.each([{ origin: "https://evil.ritarda.to" }, { origin: "null" }, { referer: "https://evil.ritarda.to/" }, { "sec-fetch-site": "cross-site" }, { "content-type": "text/plain" }, { referer: "invalid" }])("denies cross-origin/same-site or simple-form bypasses: %j", headers => {
    expect(() => assertSameOriginJsonMutation(request(headers))).toThrow(/same-origin JSON/);
  });
  it("uses the configured public origin behind a private reverse-proxy URL", () => {
    vi.stubEnv("APP_URL", "https://bnbera.ritarda.to");
    const proxied = (origin: string) => new Request("http://localhost:3022/api/commerce/hire", { method: "POST", headers: { "content-type": "application/json", origin }, body: "{}" });
    expect(() => assertSameOriginJsonMutation(proxied("https://bnbera.ritarda.to"))).not.toThrow();
    expect(() => assertSameOriginJsonMutation(proxied("https://evil.ritarda.to"))).toThrow(/same-origin JSON/);
  });
});
