import type { CardMatch, Commit, TrelloCard } from "./types";
import { extractJsonObject } from "./json";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function checkLmStudio(baseUrl: string, model: string) {
  const root = baseUrl.replace(/\/$/, "");
  const response = await fetch(`${root}/models`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Local model server ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as {
    data?: Array<{ id: string }>;
  };
  const models = body.data?.map((item) => item.id) ?? [];
  if (models.length === 0) {
    throw new Error(
      "The server is reachable, but no model is loaded. In Ollama run `ollama pull` / `ollama serve`; in llama.cpp start the server with a GGUF."
    );
  }
  if (model && !models.includes(model)) {
    return `Connected. “${model}” is not loaded; available: ${models.join(", ")}`;
  }
  return `Connected. Loaded: ${models.join(", ")}`;
}

export async function matchCommitWithLlm(input: {
  baseUrl: string;
  model: string;
  commit: Commit;
  cards: TrelloCard[];
}): Promise<CardMatch[]> {
  const root = input.baseUrl.replace(/\/$/, "");
  const model = input.model || (await firstLoadedModel(root));
  const payload = {
    model,
    temperature: 0.1,
    messages: buildMessages(input.commit, input.cards) satisfies ChatMessage[],
  };

  const response = await fetch(`${root}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`LM Studio ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content ?? "";
  return parseMatchResponse(content, input.cards);
}

async function firstLoadedModel(root: string) {
  const response = await fetch(`${root}/models`, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not list local models.");
  const body = (await response.json()) as { data?: Array<{ id: string }> };
  const id = body.data?.[0]?.id;
  if (!id) {
    throw new Error("No model is available on the local server.");
  }
  return id;
}

function buildMessages(commit: Commit, cards: TrelloCard[]): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You match a GitHub commit to Trello cards that the commit actually completes. Be conservative. Only match a card when the commit message clearly corresponds to the card title or description. Ignore cards that are only loosely related. Reply with JSON only.",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          commit: {
            repo: commit.repo,
            sha: commit.sha.slice(0, 7),
            branch: commit.branch,
            message: commit.message.slice(0, 4000),
            author: commit.author,
          },
          cards: cards.map((card) => ({
            id: card.id,
            name: card.name,
            desc: card.desc.slice(0, 1200),
            list: card.listName,
            shortLink: card.shortLink,
          })),
          response_schema: {
            matches: [
              {
                cardId: "trello card id",
                confidence: "number from 0 to 1",
                reason: "one sentence",
              },
            ],
          },
        },
        null,
        2
      ),
    },
  ];
}

export function parseMatchResponse(content: string, cards: TrelloCard[]): CardMatch[] {
  const parsed = extractJsonObject(content) as {
    matches?: Array<{ cardId?: string; card_id?: string; confidence?: number; reason?: string }>;
  };
  const byId = new Map(cards.map((card) => [card.id, card]));
  const byLink = new Map(cards.map((card) => [card.shortLink, card]));
  const matches: CardMatch[] = [];

  for (const item of parsed.matches ?? []) {
    const rawId = item.cardId || item.card_id || "";
    const card = byId.get(rawId) ?? byLink.get(rawId);
    if (!card) continue;
    const confidence = clamp(Number(item.confidence ?? 0));
    matches.push({
      cardId: card.id,
      cardName: card.name,
      confidence,
      reason: (item.reason ?? "").trim() || "LM Studio matched this card.",
      source: "llm",
    });
  }

  return uniqueMatches(matches);
}

function clamp(value: number) {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function uniqueMatches(matches: CardMatch[]) {
  const best = new Map<string, CardMatch>();
  for (const match of matches) {
    const current = best.get(match.cardId);
    if (!current || match.confidence > current.confidence) {
      best.set(match.cardId, match);
    }
  }
  return [...best.values()];
}
