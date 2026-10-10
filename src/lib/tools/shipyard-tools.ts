import { logEvent } from "@/lib/store";
import { applyCardDecision } from "@/lib/tools/apply-card";
import type { AgentSettings, Commit, TrelloCard } from "@/lib/types";

export type ToolContext = {
  settings: AgentSettings;
  commit: Commit;
  commitId: number;
  cards: TrelloCard[];
  doneListId: string;
  matchedCards: { count: number };
};

export const OPENAI_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "list_open_cards",
      description:
        "List open Trello cards that are not already in Done. Call this before deciding.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "move_card_to_done",
      description:
        "Record that this commit finishes a card and move it to Done (or dry-run if enabled).",
      parameters: {
        type: "object",
        properties: {
          cardId: { type: "string", description: "Trello card id or short link" },
          reason: { type: "string", description: "Why this commit completes the card" },
          confidence: {
            type: "number",
            description: "Confidence from 0 to 1",
          },
        },
        required: ["cardId", "reason"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "no_match",
      description: "Call this when no open card is completed by the commit.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Why nothing matches" },
        },
        required: ["reason"],
        additionalProperties: false,
      },
    },
  },
];

export async function executeShipyardTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext
): Promise<string> {
  const args = asRecord(rawArgs);

  if (name === "list_open_cards") {
    return JSON.stringify(
      ctx.cards.map((card) => ({
        id: card.id,
        name: card.name,
        shortLink: card.shortLink,
        list: card.listName,
        desc: card.desc.slice(0, 400),
      }))
    );
  }

  if (name === "no_match") {
    const reason = String(args.reason ?? "No matching card.");
    logEvent(
      "info",
      `No Trello cards for ${ctx.commit.repo}@${ctx.commit.sha.slice(0, 7)}`,
      reason,
      ctx.commitId
    );
    return JSON.stringify({ ok: true, matched: 0 });
  }

  if (name === "move_card_to_done") {
    const cardId = String(args.cardId ?? "");
    const card =
      ctx.cards.find((item) => item.id === cardId) ??
      ctx.cards.find((item) => item.shortLink === cardId);
    if (!card) {
      return JSON.stringify({ ok: false, error: `Unknown card: ${cardId}` });
    }
    const confidence = clamp(Number(args.confidence ?? 0.8));
    if (confidence < ctx.settings.minConfidence) {
      return JSON.stringify({
        ok: false,
        error: `Confidence ${confidence} is below min ${ctx.settings.minConfidence}`,
      });
    }
    await applyCardDecision(
      ctx.settings,
      ctx.commitId,
      {
        cardId: card.id,
        cardName: card.name,
        confidence,
        reason: String(args.reason ?? "").trim() || "Tool loop matched this card.",
        source: "loop",
      },
      card,
      ctx.doneListId
    );
    ctx.matchedCards.count += 1;
    return JSON.stringify({ ok: true, cardId: card.id, cardName: card.name });
  }

  return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return {};
}

function clamp(value: number) {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
