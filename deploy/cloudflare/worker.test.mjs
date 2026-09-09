import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.mjs";
test("fails closed without a stable authenticated origin or for an unknown host", async () => {
  assert.equal((await worker.fetch(new Request("https://bnbera.ritarda.to/"), {})).status, 503);
  assert.equal((await worker.fetch(new Request("https://wrong.example/"), { UPSTREAM_ORIGIN: "https://origin.example" })).status, 421);
  assert.equal((await worker.fetch(new Request("https://bnbera.ritarda.to/"), { UPSTREAM_ORIGIN: "https://test.trycloudflare.com", ORIGIN_ACCESS_CLIENT_ID: "id", ORIGIN_ACCESS_CLIENT_SECRET: "secret" })).status, 503);
});
test("forwards cookies and public origin, replaces spoofed headers, rewrites redirects and does not cache", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url.toString(), "https://stable-origin.example/api/commerce?x=1");
      assert.equal(options.headers.get("Cookie"), "session=opaque");
      assert.equal(options.headers.get("Origin"), "https://bnbera.ritarda.to");
      assert.equal(options.headers.get("X-Forwarded-Host"), "bnbera.ritarda.to");
      assert.equal(options.headers.get("CF-Access-Client-Secret"), "installed-secret");
      assert.equal(options.headers.get("Forwarded"), null);
      assert.equal(options.redirect, "manual");
      return new Response(null, { status: 302, headers: { Location: "https://stable-origin.example/my-hires", "Set-Cookie": "session=opaque; Secure; HttpOnly; Path=/" } });
    };
    const response = await worker.fetch(new Request("https://bnbera.ritarda.to/api/commerce?x=1", { headers: { Cookie: "session=opaque", Origin: "https://bnbera.ritarda.to", "X-Forwarded-Host": "evil.example", "CF-Access-Client-Secret": "attacker", Forwarded: "host=evil.example" } }), { UPSTREAM_ORIGIN: "https://stable-origin.example", ORIGIN_ACCESS_CLIENT_ID: "installed-id", ORIGIN_ACCESS_CLIENT_SECRET: "installed-secret" });
    assert.equal(response.headers.get("Location"), "https://bnbera.ritarda.to/my-hires");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.match(response.headers.get("Set-Cookie"), /HttpOnly/);
  } finally { globalThis.fetch = original; }
});
