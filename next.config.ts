import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "better-sqlite3",
    "@strands-agents/sdk",
    "openai",
    "@langfuse/otel",
    "@langfuse/tracing",
    "@langfuse/openai",
    "@opentelemetry/sdk-trace-node",
    "@opentelemetry/api",
  ],
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
