import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // Paths are rooted at the monorepo checkout because the canonical db tasks
  // are invoked from the repository root.
  schema: "./packages/db/src/schema.ts",
  out: "./packages/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // This local fallback is for schema generation only. Production and CI
    // must inject DATABASE_URL through their secret manager.
    url: process.env.DATABASE_URL ?? "postgresql://bnbera:bnbera@localhost:5432/bnbera"
  },
  strict: true,
  verbose: true
});
