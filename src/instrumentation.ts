export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerLangfuseTracing } = await import("@/lib/langfuse-otel");
  registerLangfuseTracing();
  const { startBackgroundPoller } = await import("@/lib/poller");
  startBackgroundPoller();
}
