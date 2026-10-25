import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { isLangfuseEnabled, langfuseEnv } from "@/lib/langfuse-env";

const SECRET_PATTERN =
  /(sk-lf-|pk-lf-|ghp_|github_pat_|ATAT)[A-Za-z0-9._-]{8,}/g;

export { isLangfuseEnabled, langfuseEnv };

let processor: LangfuseSpanProcessor | null = null;
let registered = false;

export function getLangfuseSpanProcessor() {
  processor ??= new LangfuseSpanProcessor({
    publicKey: langfuseEnv("LANGFUSE_PUBLIC_KEY") || undefined,
    secretKey: langfuseEnv("LANGFUSE_SECRET_KEY") || undefined,
    baseUrl: langfuseEnv("LANGFUSE_BASE_URL") || undefined,
    environment: langfuseEnv("LANGFUSE_TRACING_ENVIRONMENT") || "development",
    flushAt: 1,
    flushInterval: 1,
    mask: ({ data }) => {
      if (typeof data === "string") {
        return data.replace(SECRET_PATTERN, "$1••••");
      }
      return data;
    },
  });
  return processor;
}

export function registerLangfuseTracing() {
  if (registered || !isLangfuseEnabled()) return;
  registered = true;
  const provider = new NodeTracerProvider({
    spanProcessors: [getLangfuseSpanProcessor()],
  });
  provider.register();
}

export async function flushLangfuse() {
  if (!processor) return;
  await processor.forceFlush();
}
