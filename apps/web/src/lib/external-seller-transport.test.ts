import { describe, expect, it, vi } from "vitest";
import { createExternalSellerTransport } from "./external-seller-transport";

const target = { url: new URL("https://seller.example/a2a"), addresses: ["8.8.8.8"] };
function setup(response = new Response('{"ok":true}', { headers: { "content-type": "application/json" } })) {
  const fetcher = vi.fn(async () => response) as unknown as typeof fetch;
  const resolve = vi.fn(async () => target);
  return { transport: createExternalSellerTransport({ fetch: fetcher, resolve }), fetcher, resolve };
}
describe("external seller HTTPS transport", () => {
  it("uses bounded JSON without credentials, redirects or retries and checks DNS twice", async () => {
    const f = setup(); expect(await f.transport.request(target.url.toString(), { task: "read" })).toEqual({ ok: true });
    expect(f.resolve).toHaveBeenCalledTimes(2);
    expect(f.fetcher).toHaveBeenCalledWith(target.url, expect.objectContaining({ method: "POST", redirect: "manual", credentials: "omit", cache: "no-store" }));
  });
  it.each([
    new Response("{}", { status: 302, headers: { location: "https://other.example", "content-type": "application/json" } }),
    new Response("{}", { headers: { "content-type": "text/html" } }),
    new Response("x".repeat(65537), { headers: { "content-type": "application/json" } }),
    new Response('{"access_token":"never persist"}', { headers: { "content-type": "application/json" } })
  ])("rejects unsafe responses", async response => { const f = setup(response); await expect(f.transport.get(target.url.toString())).rejects.toThrow(); });
  it("fails closed when DNS changes and never retries POST", async () => {
    const f = setup(); f.resolve.mockResolvedValueOnce(target).mockResolvedValueOnce({ ...target, addresses: ["1.1.1.1"] });
    await expect(f.transport.request(target.url.toString(), {})).rejects.toThrow(/network target changed/u);
    expect(f.fetcher).toHaveBeenCalledOnce();
  });
  it("rejects excessive JSON nesting before recursive public payload validation", async () => {
    const f = setup(new Response('['.repeat(18)+'0'+']'.repeat(18), { headers: { "content-type": "application/json" } }));
    await expect(f.transport.get(target.url.toString())).rejects.toThrow(/structure/u);
  });
});
