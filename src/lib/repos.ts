import type { RepoRef } from "./types";

export function parseRepos(raw: string): RepoRef[] {
  const seen = new Set<string>();
  const repos: RepoRef[] = [];

  for (const line of raw.split(/[\n,]+/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    let value = trimmed.replace(/^https?:\/\/github\.com\//i, "");
    value = value.replace(/\.git$/, "");

    let branch: string | undefined;
    const branchSplit = value.split(":");
    if (branchSplit.length === 2 && !branchSplit[1].includes("/")) {
      value = branchSplit[0];
      branch = branchSplit[1] || undefined;
    }

    const parts = value.split("/").filter(Boolean);
    if (parts.length < 2) continue;
    const owner = parts[0];
    const name = parts[1];
    const fullName = `${owner}/${name}`;
    const key = `${fullName}:${branch ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    repos.push({ owner, name, fullName, branch });
  }

  return repos;
}
