import { firstLoadedModel } from "@/lib/lmstudio";
import { localOpenAI, recordModelThinking } from "@/lib/local-openai";
import { logEvent } from "@/lib/store";
import {
  AGENT_SYSTEM_PROMPT,
  createToolContext,
  executeShipyardTool,
  OPENAI_TOOLS,
} from "@/lib/tools/shipyard-tools";
import type { AgentRunResult, AgentSettings } from "@/lib/types";

const MAX_STEPS = 20;

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

type ToolCall = {
  id: string;
  type?: "function";
  function: { name: string; arguments: string };
};

/** Hand-written tool loop: the model asks for tools; this file runs them. */
export async function runLoopAgent(input: {
  settings: AgentSettings;
}): Promise<AgentRunResult> {
  const ctx = createToolContext(input.settings);

  const root = input.settings.lmstudioBaseUrl.replace(/\/$/, "");
  const model = input.settings.lmstudioModel || (await firstLoadedModel(root));
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        AGENT_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          dryRun: input.settings.dryRun,
          minConfidence: input.settings.minConfidence,
          lookbackCommits: input.settings.lookbackCommits,
          repos: input.settings.githubRepos,
        },
        null,
        2
      ),
    },
  ];

  logEvent("info", `${input.settings.agentMode} session started`, `model=${model}`);

  try {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const message = await chat(root, model, messages);
      messages.push(message);
      logModelTurn(ctx.lastCommitId, step + 1, message);

      const calls = message.tool_calls ?? [];
      if (calls.length === 0) {
        logEvent(
          "info",
          `Tool loop step ${step + 1}: model stopped`,
          "No tool calls in this reply.",
          ctx.lastCommitId
        );
        break;
      }

      for (const call of calls) {
        logEvent(
          "info",
          `Tool loop step ${step + 1}: calling ${call.function.name}`,
          clip(call.function.arguments || "{}"),
          ctx.lastCommitId
        );
        const result = await executeShipyardTool(
          call.function.name,
          call.function.arguments,
          ctx
        );
        logEvent(
          "info",
          `Tool loop step ${step + 1}: ${call.function.name} result`,
          clip(result),
          ctx.lastCommitId
        );
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Tool loop failed";
    logEvent(
      "error",
      `${input.settings.agentMode} session failed`,
      detail,
      ctx.lastCommitId
    );
  }

  logEvent(
    "info",
    `${input.settings.agentMode} session finished`,
    `${ctx.newCommits.count} commits handled, ${ctx.matchedCards.count} card matches`
  );

  return {
    newCommits: ctx.newCommits.count,
    matchedCards: ctx.matchedCards.count,
    doneList: ctx.doneListName ?? undefined,
  };
}

function logModelTurn(commitId: number | null, step: number, message: ChatMessage) {
  const thinking = [message.reasoning, message.reasoning_content]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n\n");
  if (thinking) {
    logEvent("info", `Tool loop step ${step}: model reasoning`, clip(thinking), commitId);
  }
  const text = message.content?.trim();
  if (text) {
    logEvent("info", `Tool loop step ${step}: model reply`, clip(text), commitId);
  }
  const calls = message.tool_calls ?? [];
  if (calls.length > 0) {
    logEvent(
      "info",
      `Tool loop step ${step}: model requested ${calls.length} tool call(s)`,
      calls.map((call) => call.function.name).join(", "),
      commitId
    );
  }
}

function clip(text: string, max = 2000) {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

async function chat(
  root: string,
  model: string,
  messages: ChatMessage[]
): Promise<ChatMessage> {
  const completion = await localOpenAI(root, "chat-completion").chat.completions.create({
    model,
    temperature: 0.1,
    messages,
    tools: OPENAI_TOOLS,
    tool_choice: "auto",
  });
  const message = completion.choices[0]?.message as ChatMessage | undefined;
  if (!message) throw new Error("Local model returned no message.");
  recordModelThinking(message);
  return message;
}
