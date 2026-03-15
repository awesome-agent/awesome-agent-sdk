import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Dynamic only — API route uses runtime env vars
  output: "standalone",
  transpilePackages: [
    "@awesome-agent/agent-core",
    "@awesome-agent/adapter-openai",
    "@awesome-agent/ui",
  ],
  turbopack: {},
  webpack: (config) => {
    // Resolve workspace packages from monorepo root node_modules
    config.resolve = config.resolve || {};
    config.resolve.modules = [
      path.resolve(import.meta.dirname, "../../node_modules"),
      "node_modules",
      ...(config.resolve.modules || []),
    ];
    config.resolve.symlinks = true;
    return config;
  },
};

export default nextConfig;
