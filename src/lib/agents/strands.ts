import {
  AfterToolCallEvent,
  Agent,
  BeforeToolCallEvent,
  tool,
} from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { z } from "zod";
import { firstLoadedModel } from "@/lib/lmstudio";
import { localOpenAI } from "@/lib/local-openai";
import { logEvent } from "@/lib/store";
import {
  AGENT_SYSTEM_PROMPT,
  createToolContext,
  executeShipyardTool,
  type ToolContext,
} from "@/lib/tools/shipyard-tools";
import type { AgentRunResult, AgentSettings } from "@/lib/types";

/** Same tools as the hand-written loop; Strands owns the agent loop. */
export async function runStrandsAgent(input: {
  settings: AgentSettings;
}): Promise<AgentRunResult> {
  const ctx = createToolContext(input.settings);
  const root = input.settings.lmstudioBaseUrl.replace(/\/$/, "");
  const modelId = input.settings.lmstudioModel || (await firstLoadedModel(root));
  const model = new OpenAIModel({
    api: "chat",
    client: localOpenAI(root, "chat-completion"),
    modelId,
    temperature: 0.1,
  });

  const agent = new Agent({
    model,
    systemPrompt: AGENT_SYSTEM_PROMPT,
    tools: shipyardStrandsTools(ctx),
    printer: false,
    toolExecutor: "sequential",
    sandbox: false,
  });

  agent.addHook(BeforeToolCallEvent, (event) => {
    logEvent(
      "info",
      `Strands calling ${event.toolUse.name}`,
      clip(JSON.stringify(event.toolUse.input ?? {})),
      ctx.lastCommitId
    );
  });
  agent.addHook(AfterToolCallEvent, (event) => {
    logEvent(
      "info",
      `Strands ${event.toolUse.name} result`,
      clip(JSON.stringify(event.result)),
      ctx.lastCommitId
    );
  });

  logEvent(
    "info",
    `${input.settings.agentMode} session started`,
    `model=${modelId} provider=strands`
  );

  try {
    const prompt = JSON.stringify(
      {
        dryRun: input.settings.dryRun,
        minConfidence: input.settings.minConfidence,
        lookbackCommits: input.settings.lookbackCommits,
        repos: input.settings.githubRepos,
      },
      null,
      2
    );
    const result = await agent.invoke(prompt, { limits: { turns: 20 } });
    const reply = extractText(result.lastMessage);
    if (reply) {
      logEvent("info", "Strands model reply", clip(reply), ctx.lastCommitId);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Strands agent failed";
    logEvent(
      "error",
      `${input.settings.agentMode} session failed`,
      detail,
      ctx.lastCommitId
    );
  } finally {
    await agent.shutdown();
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

function shipyardStrandsTools(ctx: ToolContext) {
  return [
    tool({
      name: "list_recent_commits",
      description:
        "Call GitHub for recent commits on the configured repos. Returns unseen SHAs (stops at the first already processed tip).",
      inputSchema: z.object({}),
      callback: async () => parseJson(await executeShipyardTool("list_recent_commits", {}, ctx)),
    }),
    tool({
      name: "list_open_cards",
      description:
        "Call Trello and list open cards that are not already in Done. Call this before deciding.",
      inputSchema: z.object({}),
      callback: async () => parseJson(await executeShipyardTool("list_open_cards", {}, ctx)),
    }),
    tool({
      name: "move_card_to_done",
      description:
        "Record that a commit finishes a card and move it to Done (or dry-run if enabled).",
      inputSchema: z.object({
        sha: z.string().describe("GitHub commit sha from list_recent_commits"),
        cardId: z.string().describe("Trello card id or short link"),
        reason: z.string().describe("Why this commit completes the card"),
        confidence: z.number().min(0).max(1).optional().describe("Confidence from 0 to 1"),
      }),
      callback: async (input) =>
        parseJson(await executeShipyardTool("move_card_to_done", input, ctx)),
    }),
    tool({
      name: "no_match",
      description: "Call this when no open card is completed by a commit.",
      inputSchema: z.object({
        sha: z.string().describe("GitHub commit sha from list_recent_commits"),
        reason: z.string().describe("Why nothing matches"),
      }),
      callback: async (input) => parseJson(await executeShipyardTool("no_match", input, ctx)),
    }),
  ];
}

function parseJson(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function extractText(message: unknown) {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (block && typeof block === "object" && "text" in block) {
        return String((block as { text?: string }).text ?? "");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function clip(text: string, max = 2000) {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}
