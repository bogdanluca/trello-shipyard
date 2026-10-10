import { listRecentCommits, resolveBranch } from "./github";
import { heuristicMatches, mergeMatches } from "./matcher";
import { matchCommitWithLlm } from "./lmstudio";
import { parseRepos } from "./repos";
import { getSettings } from "./settings";
import {
  isCommitProcessed,
  logEvent,
  claimCommit,
  recordMatch,
  setCursor,
} from "./store";
import {
  findDoneList,
  listBoardCards,
  listBoardLists,
  moveCardToList,
} from "./trello";
import type { AgentSettings, CardMatch, Commit, TrelloCard } from "./types";

const pollerGlobal = globalThis as typeof globalThis & {
  __shipyardPoller?: {
    running: boolean;
    timer: NodeJS.Timeout | null;
    lastRunAt: string | null;
    lastError: string | null;
  };
};

const pollerState = (pollerGlobal.__shipyardPoller ??= {
  running: false,
  timer: null,
  lastRunAt: null,
  lastError: null,
});

export function pollerStatus() {
  return {
    running: pollerState.running,
    lastRunAt: pollerState.lastRunAt,
    lastError: pollerState.lastError,
  };
}

export function startBackgroundPoller() {
  if (pollerState.timer) return;
  const tick = async () => {
    const settings = getSettings();
    if (!settings.autoPoll) return;
    if (!isConfigured(settings)) return;
    try {
      await runPoll("scheduled");
    } catch (error) {
      pollerState.lastError = error instanceof Error ? error.message : "Poll failed";
    }
  };
  void tick();
  pollerState.timer = setInterval(() => {
    const settings = getSettings();
    void tick();
    if (pollerState.timer) {
      clearInterval(pollerState.timer);
      pollerState.timer = setInterval(tick, settings.pollIntervalSeconds * 1000);
    }
  }, getSettings().pollIntervalSeconds * 1000);
}

export async function runPoll(trigger: "manual" | "scheduled") {
  if (pollerState.running) {
    return { skipped: true, message: "A poll is already running." };
  }

  pollerState.running = true;
  pollerState.lastError = null;
  const settings = getSettings();

  try {
    const result = await pollOnce(settings, trigger);
    pollerState.lastRunAt = new Date().toISOString();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Poll failed";
    pollerState.lastError = message;
    logEvent("error", "Poll failed", message);
    throw error;
  } finally {
    pollerState.running = false;
  }
}

function isConfigured(settings: AgentSettings) {
  return (
    parseRepos(settings.githubRepos).length > 0 &&
    Boolean(settings.githubToken) &&
    Boolean(settings.trelloKey) &&
    Boolean(settings.trelloToken) &&
    Boolean(settings.trelloBoardId)
  );
}

async function pollOnce(settings: AgentSettings, trigger: string) {
  const repos = parseRepos(settings.githubRepos);
  if (repos.length === 0) {
    throw new Error("Add at least one GitHub repository (owner/name).");
  }
  if (!settings.githubToken) throw new Error("GitHub token is missing.");
  if (!settings.trelloKey || !settings.trelloToken || !settings.trelloBoardId) {
    throw new Error("Trello key, token, or board id is missing.");
  }

  const lists = await listBoardLists(
    settings.trelloKey,
    settings.trelloToken,
    settings.trelloBoardId
  );
  const doneList = findDoneList(lists, settings.trelloDoneListName);
  if (!doneList) {
    throw new Error(
      `No Trello list named “${settings.trelloDoneListName}” (or Done/Complete) was found.`
    );
  }

  const cards = (
    await listBoardCards(
      settings.trelloKey,
      settings.trelloToken,
      settings.trelloBoardId,
      lists
    )
  ).filter((card) => card.idList !== doneList.id);

  let newCommits = 0;
  let matchedCards = 0;

  for (const repo of repos) {
    const branch = await resolveBranch(settings.githubToken, repo);
    const commits = await listRecentCommits(
      settings.githubToken,
      repo,
      branch,
      settings.lookbackCommits
    );
    // GitHub returns newest-first. Stop at the first SHA we already handled so
    // holes older than that tip are not backfilled on later polls.
    const unseen: typeof commits = [];
    for (const commit of commits) {
      if (isCommitProcessed(commit.repo, commit.sha)) break;
      unseen.push(commit);
    }

    for (const commit of unseen.reverse()) {
      const commitId = claimCommit(commit);
      if (commitId == null) continue;
      newCommits += 1;
      const matches = await matchCommit(settings, commit, cards);
      if (matches.length === 0) {
        logEvent(
          "info",
          `No Trello cards for ${repo.fullName}@${commit.sha.slice(0, 7)}`,
          commit.message.split("\n")[0]
        );
        continue;
      }

      for (const match of matches) {
        const card = cards.find((item) => item.id === match.cardId);
        if (!card) continue;
        matchedCards += 1;
        await applyMatch(settings, commitId, match, card, doneList.id);
      }
    }

    if (commits[0]) setCursor(repo.fullName, commits[0].sha);
  }

  logEvent(
    "info",
    `Poll (${trigger}) finished`,
    `${newCommits} new commits, ${matchedCards} card matches, dryRun=${settings.dryRun}`
  );

  return {
    skipped: false,
    newCommits,
    matchedCards,
    dryRun: settings.dryRun,
    doneList: doneList.name,
  };
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
