import { listRecentCommits, resolveBranch } from "./github";
import { heuristicMatches, mergeMatches } from "./matcher";
import { matchCommitWithLlm } from "./lmstudio";
import { parseRepos } from "./repos";
import { getSettings } from "./settings";
import {
  isCommitProcessed,
  logEvent,
  recordCommit,
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

let running = false;
let timer: NodeJS.Timeout | null = null;
let lastRunAt: string | null = null;
let lastError: string | null = null;

export function pollerStatus() {
  return { running, lastRunAt, lastError };
}

export function startBackgroundPoller() {
  if (timer) return;
  const tick = async () => {
    const settings = getSettings();
    if (!settings.autoPoll) return;
    try {
      await runPoll("scheduled");
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Poll failed";
    }
  };
  void tick();
  timer = setInterval(() => {
    const settings = getSettings();
    void tick();
    if (timer) {
      clearInterval(timer);
      timer = setInterval(tick, settings.pollIntervalSeconds * 1000);
    }
  }, getSettings().pollIntervalSeconds * 1000);
}

export async function runPoll(trigger: "manual" | "scheduled") {
  if (running) {
    return { skipped: true, message: "A poll is already running." };
  }

  running = true;
  lastError = null;
  const settings = getSettings();

  try {
    const result = await pollOnce(settings, trigger);
    lastRunAt = new Date().toISOString();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Poll failed";
    lastError = message;
    logEvent("error", "Poll failed", message);
    throw error;
  } finally {
    running = false;
  }
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
    const unseen = commits.filter((commit) => !isCommitProcessed(commit.repo, commit.sha));

    if (unseen[0]) setCursor(repo.fullName, unseen[0].sha);

    for (const commit of unseen.reverse()) {
      newCommits += 1;
      const commitId = recordCommit(commit);
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
      "LM Studio unavailable; using keyword matching only",
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
