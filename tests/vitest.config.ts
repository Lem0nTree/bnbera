import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const source = (relativePath: string) => fileURLToPath(new URL(`../${relativePath}`, import.meta.url));

/**
 * QA-only runner aliases workspace packages to source so the harness can run
 * before a package build/install has produced dist exports. This config does
 * not define or replace any marketplace API contract.
 */
export default defineConfig({
  resolve: {
    alias: {
      "zod": source("packages/domain/node_modules/zod/lib/index.mjs"),
      "@bnbera/domain": source("packages/domain/src/index.ts"),
      "@bnbera/config": source("packages/config/src/index.ts"),
      "@bnbera/agent-ingestion/directory": source("packages/agent-ingestion/src/directory.ts"),
      "@bnbera/agent-ingestion": source("packages/agent-ingestion/src/index.ts"),
      "@bnbera/marketplace": source("packages/marketplace/src/index.ts"),
      "@/": source("apps/web/src/")
    }
  },
  test: {
    include: ["tests/**/*.test.ts"]
  }
});
