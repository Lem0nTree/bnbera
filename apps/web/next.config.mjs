/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Build a retained candidate without replacing a running preview's assets.
  distDir: process.env.BNBERA_NEXT_DIST_DIR || ".next",
  // agent-ingestion contains pg and server-only provider adapters; web routes
  // consume its contracts only through server seams and must not bundle it.
  transpilePackages: ["@bnbera/ui", "@bnbera/domain", "@bnbera/config", "@bnbera/marketplace"],
  serverExternalPackages: ["pg"]
};

export default nextConfig;
