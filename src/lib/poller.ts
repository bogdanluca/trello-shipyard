import { runCommitAgent } from "./agents/run";
import { listRecentCommits, resolveBranch } from "./github";
import { parseRepos } from "./repos";
import { getSettings } from "./settings";
import { isCommitProcessed, logEvent, claimCommit, setCursor } from "./store";
import { findDoneList, listBoardCards, listBoardLists } from "./trello";
import type { AgentSettings } from "./types";

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
      matchedCards += await runCommitAgent({
        settings,
        commit,
        commitId,
        cards,
        doneListId: doneList.id,
      });
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
