import { heuristicMatches, mergeMatches } from "@/lib/matcher";
import { matchCommitWithLlm } from "@/lib/lmstudio";
import { logEvent } from "@/lib/store";
import { applyCardDecision } from "@/lib/tools/apply-card";
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
    await applyCardDecision(input.settings, input.commitId, match, card, input.doneListId);
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
