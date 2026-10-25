import { agentModeNote } from "@/lib/agents/modes";
import { loadOpenBoardCards, loadRecentCommits } from "@/lib/sources";
import { claimCommit, logEvent, recordCommit } from "@/lib/store";
import { applyCardDecision } from "@/lib/tools/apply-card";
import type { AgentSettings, Commit, TrelloCard } from "@/lib/types";

export type ToolContext = {
  settings: AgentSettings;
  commits: Commit[];
  cards: TrelloCard[];
  doneListId: string | null;
  doneListName: string | null;
  claimedIds: Map<string, number>;
  lastCommitId: number | null;
  newCommits: { count: number };
  matchedCards: { count: number };
};

export const AGENT_SYSTEM_PROMPT =
  "You match unseen GitHub commits to open Trello cards. Use tools. Call list_recent_commits, then list_open_cards. For each unseen commit, call move_card_to_done or no_match with that commit sha. Do not invent shas or card ids.";

export function createToolContext(settings: AgentSettings): ToolContext {
  return {
    settings,
    commits: [],
    cards: [],
    doneListId: null,
    doneListName: null,
    claimedIds: new Map(),
    lastCommitId: null,
    newCommits: { count: 0 },
    matchedCards: { count: 0 },
  };
}

export const OPENAI_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "list_recent_commits",
      description:
        "Call GitHub for recent commits on the configured repos. Returns unseen SHAs (stops at the first already processed tip).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_open_cards",
      description:
        "Call Trello and list open cards that are not already in Done. Call this before deciding.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "move_card_to_done",
      description:
        "Record that a commit finishes a card and move it to Done (or dry-run if enabled).",
      parameters: {
        type: "object",
        properties: {
          sha: { type: "string", description: "GitHub commit sha from list_recent_commits" },
          cardId: { type: "string", description: "Trello card id or short link" },
          reason: { type: "string", description: "Why this commit completes the card" },
          confidence: {
            type: "number",
            description: "Confidence from 0 to 1",
          },
        },
        required: ["sha", "cardId", "reason"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "no_match",
      description: "Call this when no open card is completed by a commit.",
      parameters: {
        type: "object",
        properties: {
          sha: { type: "string", description: "GitHub commit sha from list_recent_commits" },
          reason: { type: "string", description: "Why nothing matches" },
        },
        required: ["sha", "reason"],
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

  if (name === "list_recent_commits") {
    const loaded = await loadRecentCommits(ctx.settings);
    ctx.commits = loaded.unseen;
    return JSON.stringify({
      unseen: loaded.unseen.map((commit) => ({
        repo: commit.repo,
        sha: commit.sha,
        shortSha: commit.sha.slice(0, 7),
        branch: commit.branch,
        message: commit.message.slice(0, 400),
        author: commit.author,
      })),
      repos: loaded.repos,
    });
  }

  if (name === "list_open_cards") {
    const loaded = await loadOpenBoardCards(ctx.settings);
    ctx.cards = loaded.cards;
    ctx.doneListId = loaded.doneList.id;
    ctx.doneListName = loaded.doneList.name;
    return JSON.stringify({
      doneList: loaded.doneList.name,
      cards: loaded.cards.map((card) => ({
        id: card.id,
        name: card.name,
        shortLink: card.shortLink,
        list: card.listName,
        desc: card.desc.slice(0, 400),
      })),
    });
  }

  if (name === "no_match") {
    const handled = claimFromArgs(ctx, String(args.sha ?? ""));
    if (!handled.ok) return JSON.stringify(handled);
    const reason = String(args.reason ?? "No matching card.");
    logEvent(
      "info",
      `No Trello cards for ${handled.commit.repo}@${handled.commit.sha.slice(0, 7)}`,
      agentModeNote(ctx.settings.agentMode, reason),
      handled.commitId
    );
    return JSON.stringify({ ok: true, matched: 0, sha: handled.commit.sha });
  }

  if (name === "move_card_to_done") {
    const handled = claimFromArgs(ctx, String(args.sha ?? ""));
    if (!handled.ok) return JSON.stringify(handled);
    if (!ctx.doneListId) {
      return JSON.stringify({
        ok: false,
        error: "Call list_open_cards before move_card_to_done.",
      });
    }
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
      handled.commitId,
      {
        cardId: card.id,
        cardName: card.name,
        confidence,
        reason: String(args.reason ?? "").trim() || "Tool loop matched this card.",
        source: ctx.settings.agentMode === "strands" ? "strands" : "handwritten",
      },
      card,
      ctx.doneListId
    );
    ctx.matchedCards.count += 1;
    return JSON.stringify({
      ok: true,
      sha: handled.commit.sha,
      cardId: card.id,
      cardName: card.name,
    });
  }

  return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` });
}

function claimFromArgs(ctx: ToolContext, sha: string) {
  const commit = findCommit(ctx.commits, sha);
  if (!commit) {
    return {
      ok: false as const,
      error: sha
        ? `Unknown sha: ${sha}. Call list_recent_commits first.`
        : "sha is required.",
    };
  }
  const commitId = claimOrReuse(ctx, commit);
  return { ok: true as const, commit, commitId };
}

function findCommit(commits: Commit[], sha: string) {
  const needle = sha.trim().toLowerCase();
  if (!needle) return undefined;
  return commits.find(
    (commit) =>
      commit.sha.toLowerCase() === needle ||
      commit.sha.toLowerCase().startsWith(needle) ||
      needle.startsWith(commit.sha.slice(0, 7).toLowerCase())
  );
}

function claimOrReuse(ctx: ToolContext, commit: Commit) {
  const existing = ctx.claimedIds.get(commit.sha);
  if (existing != null) {
    ctx.lastCommitId = existing;
    return existing;
  }
  const claimed = claimCommit(commit);
  const commitId = claimed ?? recordCommit(commit);
  if (claimed != null) ctx.newCommits.count += 1;
  ctx.claimedIds.set(commit.sha, commitId);
  ctx.lastCommitId = commitId;
  logEvent(
    "info",
    `${ctx.settings.agentMode} handling ${commit.repo}@${commit.sha.slice(0, 7)}`,
    commit.message.split("\n")[0],
    commitId
  );
  return commitId;
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
