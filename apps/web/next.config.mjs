import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // agent-ingestion contains pg and server-only provider adapters; web routes
  // consume its contracts only through server seams and must not bundle it.
  transpilePackages: ["@bnbera/ui", "@bnbera/domain", "@bnbera/config", "@bnbera/marketplace"],
  serverExternalPackages: ["pg"],
  // The semantic lock is statically imported by the server seam. Keep the
  // checked-in source in output-file-traced standalone artifacts as well.
  outputFileTracingRoot: repositoryRoot,
  outputFileTracingIncludes: {
    "/*": ["../../config/standards.lock.json"]
  }
};

export default nextConfig;
