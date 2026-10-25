export function langfuseEnv(name: string) {
  return (process.env[name] ?? "").trim().replace(/^["']|["']$/g, "");
}

export function isLangfuseEnabled() {
  return Boolean(
    langfuseEnv("LANGFUSE_PUBLIC_KEY") &&
      langfuseEnv("LANGFUSE_SECRET_KEY") &&
      langfuseEnv("LANGFUSE_BASE_URL")
  );
}
