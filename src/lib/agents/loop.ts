import { firstLoadedModel } from "@/lib/lmstudio";
import { logEvent } from "@/lib/store";
import { executeShipyardTool, OPENAI_TOOLS, type ToolContext } from "@/lib/tools/shipyard-tools";
import type { AgentSettings, Commit, TrelloCard } from "@/lib/types";

const MAX_STEPS = 8;

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
  commit: Commit;
  commitId: number;
  cards: TrelloCard[];
  doneListId: string;
}): Promise<number> {
  const ctx: ToolContext = {
    settings: input.settings,
    commit: input.commit,
    commitId: input.commitId,
    cards: input.cards,
    doneListId: input.doneListId,
    matchedCards: { count: 0 },
  };

  const root = input.settings.lmstudioBaseUrl.replace(/\/$/, "");
  const model = input.settings.lmstudioModel || (await firstLoadedModel(root));
  const sha = input.commit.sha.slice(0, 7);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You decide whether a GitHub commit finishes a Trello card. Use tools. Call list_open_cards first. If a card is clearly completed, call move_card_to_done. If nothing matches, call no_match. Do not invent card ids.",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          commit: {
            repo: input.commit.repo,
            sha,
            branch: input.commit.branch,
            message: input.commit.message.slice(0, 4000),
            author: input.commit.author,
          },
          dryRun: input.settings.dryRun,
          minConfidence: input.settings.minConfidence,
        },
        null,
        2
      ),
    },
  ];

  logEvent(
    "info",
    `Tool loop started for ${input.commit.repo}@${sha}`,
    `model=${model}`,
    input.commitId
  );

  try {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const message = await chat(root, model, messages);
      messages.push(message);
      logModelTurn(input.commitId, step + 1, message);

      const calls = message.tool_calls ?? [];
      if (calls.length === 0) {
        logEvent(
          "info",
          `Tool loop step ${step + 1}: model stopped`,
          "No tool calls in this reply.",
          input.commitId
        );
        break;
      }

      for (const call of calls) {
        logEvent(
          "info",
          `Tool loop step ${step + 1}: calling ${call.function.name}`,
          clip(call.function.arguments || "{}"),
          input.commitId
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
          input.commitId
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
    logEvent("error", "Hand-written tool loop failed", detail, input.commitId);
  }

  logEvent(
    "info",
    `Tool loop finished for ${input.commit.repo}@${sha}`,
    `${ctx.matchedCards.count} card matches`,
    input.commitId
  );

  return ctx.matchedCards.count;
}

function logModelTurn(commitId: number, step: number, message: ChatMessage) {
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
  const response = await fetch(`${root}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages,
      tools: OPENAI_TOOLS,
      tool_choice: "auto",
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Local model ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as {
    choices?: Array<{ message?: ChatMessage }>;
  };
  const message = body.choices?.[0]?.message;
  if (!message) throw new Error("Local model returned no message.");
  return message;
}
