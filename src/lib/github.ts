import type { Commit, RepoRef } from "./types";

const API = "https://api.github.com";

export async function resolveBranch(
  token: string,
  repo: RepoRef
): Promise<string> {
  if (repo.branch) return repo.branch;

  const response = await githubFetch(token, `/repos/${repo.fullName}`);
  if (!response.ok) {
    throw new Error(
      `GitHub ${response.status} while reading ${repo.fullName}: ${await response.text()}`
    );
  }
  const body = (await response.json()) as { default_branch?: string };
  return body.default_branch || "main";
}

export async function listRecentCommits(
  token: string,
  repo: RepoRef,
  branch: string,
  limit: number
): Promise<Commit[]> {
  const response = await githubFetch(
    token,
    `/repos/${repo.fullName}/commits?sha=${encodeURIComponent(branch)}&per_page=${limit}`
  );
  if (response.status === 409) return [];
  if (!response.ok) {
    throw new Error(
      `GitHub ${response.status} listing commits for ${repo.fullName}@${branch}: ${await response.text()}`
    );
  }

  const body = (await response.json()) as Array<{
    sha: string;
    html_url: string;
    commit: {
      message: string;
      author?: { name?: string; date?: string };
      committer?: { name?: string; date?: string };
    };
  }>;

  return body.map((item) => ({
    repo: repo.fullName,
    sha: item.sha,
    branch,
    message: item.commit.message.trim(),
    author: item.commit.author?.name || item.commit.committer?.name || "",
    committedAt:
      item.commit.author?.date || item.commit.committer?.date || "",
    htmlUrl: item.html_url,
  }));
}

export async function checkGithub(token: string): Promise<string> {
  if (!token) throw new Error("Add a GitHub personal access token.");
  const response = await githubFetch(token, "/user");
  if (!response.ok) {
    throw new Error(`GitHub ${response.status}: ${await response.text()}`);
  }
  const user = (await response.json()) as { login: string };
  return `Authenticated as ${user.login}`;
}

function githubFetch(token: string, path: string) {
  return fetch(`${API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "shipyard-agent",
    },
    cache: "no-store",
  });
}
