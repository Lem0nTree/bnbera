import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

// Optional installed-tool contract test. Run with STUDIO_CLI_ROOT pointing to
// @bnbagent/studio-cli@0.0.13. No credentials, network, grant or deploy is used.
const cliRoot = process.env.STUDIO_CLI_ROOT;
test("Studio 0.0.13 rejects extra swap authority and does not collect a second session", { skip: !cliRoot }, async () => {
  const root = cliRoot!;
  const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(metadata.version, "0.0.13");
  const runtime = await import(pathToFileURL(join(root, "node_modules/@bnbagent/studio-runtime/dist/wallet.js")).href);
  const sdk = await import(pathToFileURL(join(root, "node_modules/@bnbagent/sdk/dist/wallets/index.js")).href);
  const native = sdk.defaultAgentPermissions({ chainId: 97, tokenSpend: { limit: 1n } });
  assert.equal(runtime.inspectAltanaSessionPermissions(native, 97).current, true);
  const swap = { to: "0xD99D1c33F9fC3444f8101754aBC46c52416550D1", signature: "swapExactETHForTokens(uint256,address[],address,uint256)" };
  assert.equal(runtime.inspectAltanaSessionPermissions({ ...native, calls: [...native.calls, swap] }, 97).current, false);
  assert.equal(runtime.inspectAltanaSessionPermissions({ calls: [swap] }, 97).current, false);

  // Evaluate the actual installed collector's key selection in an isolated
  // context: every possible env key is present, yet no second session is read.
  const source = readFileSync(join(root, "dist/bag.js"), "utf8");
  const start = source.indexOf("var PAYMASTER_URL_ENV_KEYS =");
  const end = source.indexOf("// src/cli/dev.ts", start);
  assert.ok(start > 0 && end > start);
  const keys = runInNewContext(`${source.slice(start, end)}; runtimeEnvKeysCore({wallet:{kind:'altana'}}, () => true)`, {
    PROVIDER_KEY_ENV: {}, commerceRails: () => ({ erc8183: false }), X402_CAPABLE_RUNTIMES: new Set(),
  }) as string[];
  assert.equal(keys.includes("ALTANA_SWAP_SESSION"), false);
  assert.equal(keys.includes("WALLET_PASSWORD"), false);
});
