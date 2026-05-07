import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Kein 'standalone' — wir nutzen einen Custom Server (src/server.ts)
};

export default nextConfig;
