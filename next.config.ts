import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for optimized Docker/serverless deployments
  output: "standalone",
};

export default nextConfig;
