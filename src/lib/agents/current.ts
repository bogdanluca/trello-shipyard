import { agentModeNote } from "@/lib/agents/modes";
import { heuristicMatches, mergeMatches } from "@/lib/matcher";
import { matchCommitWithLlm } from "@/lib/lmstudio";
import { loadOpenBoardCards, loadRecentCommits } from "@/lib/sources";
import { claimCommit, logEvent } from "@/lib/store";
import { applyCardDecision } from "@/lib/tools/apply-card";
import type {
  AgentRunResult,
  AgentSettings,
  CardMatch,
  Commit,
  TrelloCard,
} from "@/lib/types";

/** Current mode fetches GitHub/Trello itself; the model only classifies JSON. */
export async function runCurrentSession(input: {
  settings: AgentSettings;
}): Promise<AgentRunResult> {
  const { cards, doneList } = await loadOpenBoardCards(input.settings);
  const { unseen } = await loadRecentCommits(input.settings);
  let newCommits = 0;
  let matchedCards = 0;

  logEvent(
    "info",
    `${input.settings.agentMode} session started`,
    `${unseen.length} unseen commits`
  );

  for (const commit of unseen) {
    const commitId = claimCommit(commit);
    if (commitId == null) continue;
    newCommits += 1;
    logEvent(
      "info",
      `${input.settings.agentMode} handling ${commit.repo}@${commit.sha.slice(0, 7)}`,
      commit.message.split("\n")[0],
      commitId
    );
    matchedCards += await runCurrentAgent({
      settings: input.settings,
      commit,
      commitId,
      cards,
      doneListId: doneList.id,
    });
  }

  logEvent(
    "info",
    `${input.settings.agentMode} session finished`,
    `${newCommits} commits handled, ${matchedCards} card matches`
  );

  return { newCommits, matchedCards, doneList: doneList.name };
}

/** Heuristic + optional JSON LLM classifier. The model does not call tools. */
export async function runCurrentAgent(input: {
  settings: AgentSettings;
  commit: Commit;
  commitId: number;
  cards: TrelloCard[];
  doneListId: string;
}): Promise<number> {
  const matches = await matchCommit(
    input.settings,
    input.commit,
    input.cards,
    input.commitId
  );
  if (matches.length === 0) {
    logEvent(
      "info",
      `No Trello cards for ${input.commit.repo}@${input.commit.sha.slice(0, 7)}`,
      agentModeNote(
        input.settings.agentMode,
        input.commit.message.split("\n")[0]
      ),
      input.commitId
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
  cards: TrelloCard[],
  commitId: number
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
      agentModeNote(settings.agentMode, detail),
      commitId
    );
  }

  return mergeMatches(llm, heuristic, settings.minConfidence);
}
