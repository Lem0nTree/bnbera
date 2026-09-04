/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // agent-ingestion contains pg and server-only provider adapters; web routes
  // consume its contracts only through server seams and must not bundle it.
  transpilePackages: ["@bnbera/ui", "@bnbera/domain", "@bnbera/config", "@bnbera/marketplace"],
  serverExternalPackages: ["pg"]
};

export default nextConfig;
