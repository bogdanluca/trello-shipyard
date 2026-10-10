import { heuristicMatches, mergeMatches } from "@/lib/matcher";
import { matchCommitWithLlm } from "@/lib/lmstudio";
import { logEvent, recordMatch } from "@/lib/store";
import { moveCardToList } from "@/lib/trello";
import type { AgentSettings, CardMatch, Commit, TrelloCard } from "@/lib/types";

/** Heuristic + optional JSON LLM classifier. The model does not call tools. */
export async function runCurrentAgent(input: {
  settings: AgentSettings;
  commit: Commit;
  commitId: number;
  cards: TrelloCard[];
  doneListId: string;
}): Promise<number> {
  const matches = await matchCommit(input.settings, input.commit, input.cards);
  if (matches.length === 0) {
    logEvent(
      "info",
      `No Trello cards for ${input.commit.repo}@${input.commit.sha.slice(0, 7)}`,
      input.commit.message.split("\n")[0]
    );
    return 0;
  }

  let matchedCards = 0;
  for (const match of matches) {
    const card = input.cards.find((item) => item.id === match.cardId);
    if (!card) continue;
    matchedCards += 1;
    await applyMatch(input.settings, input.commitId, match, card, input.doneListId);
  }
  return matchedCards;
}

async function matchCommit(
  settings: AgentSettings,
  commit: Commit,
  cards: TrelloCard[]
): Promise<CardMatch[]> {
  const heuristic = heuristicMatches(commit, cards);
  let llm: CardMatch[] = [];

  try {
    llm = await matchCommitWithLlm({
      baseUrl: settings.lmstudioBaseUrl,
      model: settings.lmstudioModel,
      commit,
      cards,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "LM Studio error";
    logEvent(
      "warn",
      "Local model server unavailable; using keyword matching only",
      detail
    );
  }

  return mergeMatches(llm, heuristic, settings.minConfidence);
}

async function applyMatch(
  settings: AgentSettings,
  commitId: number,
  match: CardMatch,
  card: TrelloCard,
  doneListId: string
) {
  if (settings.dryRun) {
    recordMatch({
      commitId,
      cardId: card.id,
      cardName: card.name,
      confidence: match.confidence,
      reason: match.reason,
      action: "dry_run",
    });
    logEvent(
      "info",
      `Dry run: would move “${card.name}” to Done`,
      `${match.source} ${match.confidence.toFixed(2)} — ${match.reason}`
    );
    return;
  }

  try {
    await moveCardToList(
      settings.trelloKey,
      settings.trelloToken,
      card.id,
      doneListId
    );
    card.idList = doneListId;
    recordMatch({
      commitId,
      cardId: card.id,
      cardName: card.name,
      confidence: match.confidence,
      reason: match.reason,
      action: "moved",
    });
    logEvent(
      "info",
      `Moved “${card.name}” to Done`,
      `${match.source} ${match.confidence.toFixed(2)} — ${match.reason}`
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Move failed";
    recordMatch({
      commitId,
      cardId: card.id,
      cardName: card.name,
      confidence: match.confidence,
      reason: match.reason,
      action: "skipped",
    });
    logEvent("error", `Failed to move “${card.name}”`, detail);
  }
}
