import { describe, expect, it } from "vitest";
import { AppError, loadRuntimeConfig } from "../index.js";

describe("runtime configuration", () => {
  it("uses safe development defaults without requiring a database secret", () => {
    const config = loadRuntimeConfig({});
    expect(config.environment).toBe("development");
    expect(config.bscChainId).toBe(97);
    expect(config.databaseUrl).toBeUndefined();
    expect(config.erc8004IngestionEnabled).toBe(false);
    expect(config.erc8004ScanDiscoveryEnabled).toBe(false);
    expect(config.marketplaceSemanticRetrievalEnabled).toBe(false);
    expect(config.embedding).toBeNull();
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

  it("parses embedding metadata while retaining only a secret reference", () => {
    const config = loadRuntimeConfig({
      NODE_ENV: "test",
      BNBERA_ENV: "preview",
      APP_URL: "https://preview.example.test",
      SIWE_DOMAIN: "preview.example.test",
      ERC8004_EMBEDDING_PROVIDER: "openrouter",
      ERC8004_EMBEDDING_MODEL: "openai/text-embedding-3-small",
      ERC8004_EMBEDDING_MODEL_VERSION: "openrouter-openai-text-embedding-3-small-v1",
      ERC8004_EMBEDDING_DIMENSION: "1536",
      ERC8004_EMBEDDING_SECRET_REFERENCE: "ERC8004_EMBEDDING_API_KEY"
    });

    expect(config.embedding).toEqual({
      provider: "openrouter",
      model: "openai/text-embedding-3-small",
      modelVersion: "openrouter-openai-text-embedding-3-small-v1",
      dimension: 1536,
      secretReference: "ERC8004_EMBEDDING_API_KEY"
    });
    expect(config.embedding).not.toHaveProperty("apiKey");
  });

  it("requires embedding metadata when semantic retrieval is enabled", () => {
    expect(() => loadRuntimeConfig({
      NODE_ENV: "test",
      MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED: "true"
    })).toThrow(/embedding configuration/i);
  });

  it("does not enable read-only gates for malformed or missing feature flags", () => {
    const config = loadRuntimeConfig({
      NODE_ENV: "test",
      ERC8004_INGESTION_ENABLED: "TRUE",
      ERC8004SCAN_DISCOVERY_ENABLED: "1",
      MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED: "yes"
    });

    expect(config.erc8004IngestionEnabled).toBe(false);
    expect(config.erc8004ScanDiscoveryEnabled).toBe(false);
    expect(config.marketplaceSemanticRetrievalEnabled).toBe(false);
  });

  it("rejects a non-BSC chain before any read pipeline can be configured", () => {
    expect(() => loadRuntimeConfig({ NODE_ENV: "test", BSC_CHAIN_ID: "1" })).toThrow(/56.*97/i);
    expect(() => loadRuntimeConfig({ NODE_ENV: "test", BSC_CHAIN_ID: "0x61" })).toThrow(/56.*97/i);
  });
});
