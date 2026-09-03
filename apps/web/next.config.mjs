/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@bnbera/ui", "@bnbera/domain", "@bnbera/config", "@bnbera/marketplace", "@bnbera/agent-ingestion"]
};

export default nextConfig;
