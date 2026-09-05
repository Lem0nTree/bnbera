import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Integration tests import Next route handlers from the repository root.
 * Mirror the app's TypeScript `@/*` path so those handlers resolve in Vite
 * without changing production imports or requiring a Next build first.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url))
    }
  }
});
