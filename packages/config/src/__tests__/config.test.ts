import { describe, expect, it } from "vitest";
import { AppError, loadRuntimeConfig } from "../index.js";

describe("runtime configuration", () => {
  it("uses safe development defaults without requiring a database secret", () => {
    const config = loadRuntimeConfig({});
    expect(config.environment).toBe("development");
    expect(config.bscChainId).toBe(97);
    expect(config.databaseUrl).toBeUndefined();
  });

  it("parses explicit values without exposing them through an error envelope", () => {
    const config = loadRuntimeConfig({
      NODE_ENV: "test",
      BNBERA_ENV: "preview",
      APP_URL: "https://preview.example.test",
      SIWE_DOMAIN: "preview.example.test",
      DATABASE_URL: "postgresql://user:password@localhost/bnbera",
      DATABASE_SSL: "true",
      BSC_CHAIN_ID: "56"
    });

    expect(config.databaseSsl).toBe(true);
    expect(config.bscChainId).toBe(56);

    const error = new AppError({
      code: "CONFIG_INVALID",
      safeMessage: "Configuration is invalid.",
      requestId: "req_test",
      cause: config.databaseUrl
    });
    expect(JSON.stringify(error.toEnvelope())).not.toContain("password");
  });
});
