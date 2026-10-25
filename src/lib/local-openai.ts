import { observeOpenAI } from "@langfuse/openai";
import { updateActiveObservation } from "@langfuse/tracing";
import OpenAI from "openai";
import { isLangfuseEnabled } from "@/lib/langfuse-env";

export function localOpenAI(baseUrl: string, generationName: string) {
  const client = new OpenAI({
    apiKey: "ollama",
    baseURL: baseUrl.replace(/\/$/, ""),
  });
  if (!isLangfuseEnabled()) return client;
  return observeOpenAI(client, { generationName });
}

export function recordModelThinking(message: {
  reasoning?: string | null;
  reasoning_content?: string | null;
}) {
  const thinking = [message.reasoning, message.reasoning_content]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n\n");
  if (!thinking || !isLangfuseEnabled()) return thinking;
  updateActiveObservation(
    { metadata: { thinking } },
    { asType: "generation" }
  );
  return thinking;
}
