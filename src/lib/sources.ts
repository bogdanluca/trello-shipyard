import { listRecentCommits as fetchGithubCommits, resolveBranch } from "./github";
import { parseRepos } from "./repos";
import { isCommitProcessed, setCursor } from "./store";
import { findDoneList, listBoardCards, listBoardLists } from "./trello";
import type { AgentSettings, Commit } from "./types";

export async function loadOpenBoardCards(settings: AgentSettings) {
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

  return { cards, doneList };
}

export async function loadRecentCommits(settings: AgentSettings) {
  const repos = parseRepos(settings.githubRepos);
  if (repos.length === 0) {
    throw new Error("Add at least one GitHub repository (owner/name).");
  }
  if (!settings.githubToken) throw new Error("GitHub token is missing.");

  const unseen: Commit[] = [];
  const summaries: Array<{
    repo: string;
    branch: string;
    unseenCount: number;
    stoppedAt: string | null;
  }> = [];

  for (const repo of repos) {
    const branch = await resolveBranch(settings.githubToken, repo);
    const commits = await fetchGithubCommits(
      settings.githubToken,
      repo,
      branch,
      settings.lookbackCommits
    );
    // GitHub returns newest-first. Stop at the first SHA we already handled so
    // holes older than that tip are not backfilled on later polls.
    const repoUnseen: Commit[] = [];
    let stoppedAt: string | null = null;
    for (const commit of commits) {
      if (isCommitProcessed(commit.repo, commit.sha)) {
        stoppedAt = commit.sha;
        break;
      }
      repoUnseen.push(commit);
    }
    unseen.push(...repoUnseen.slice().reverse());
    if (commits[0]) setCursor(repo.fullName, commits[0].sha);
    summaries.push({
      repo: repo.fullName,
      branch,
      unseenCount: repoUnseen.length,
      stoppedAt,
    });
  }

  return { unseen, repos: summaries };
}
