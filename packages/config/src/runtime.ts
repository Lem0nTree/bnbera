import { z } from "zod";

const optionalUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:" || new URL(value).protocol === "http:");

export const runtimeEnvironmentSchema = z.enum([
  "development",
  "preview",
  "hackathon",
  "production"
]);

export const runtimeConfigSchema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]),
  environment: runtimeEnvironmentSchema,
  appUrl: optionalUrlSchema,
  siweDomain: z.string().trim().min(1).max(253),
  databaseUrl: z.string().min(1).optional(),
  databaseSsl: z.boolean().default(false),
  bscChainId: z.number().int().positive().default(97)
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

type StringEnvironment = Record<string, string | undefined>;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error("DATABASE_SSL must be true or false");
}

function parseChainId(value: string | undefined): number {
  if (value === undefined) {
    return 97;
  }
  const chainId = Number(value);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("BSC_CHAIN_ID must be a positive integer");
  }
  return chainId;
}

/**
 * Parse configuration without logging or copying secret values. Callers may
 * pass a restricted environment object in tests instead of process.env.
 */
export function loadRuntimeConfig(env: StringEnvironment = process.env): RuntimeConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const environment = env.BNBERA_ENV ?? (nodeEnv === "production" ? "production" : "development");
  const appUrl = env.APP_URL ?? "http://localhost:3000";
  const siweDomain = env.SIWE_DOMAIN ?? new URL(appUrl).host;

  return runtimeConfigSchema.parse({
    nodeEnv,
    environment,
    appUrl,
    siweDomain,
    databaseUrl: env.DATABASE_URL,
    databaseSsl: parseBoolean(env.DATABASE_SSL, false),
    bscChainId: parseChainId(env.BSC_CHAIN_ID)
  });
}
