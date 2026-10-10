import { getDb, nowIso } from "./db";
import type { AgentEvent, Commit, MatchRecord, ProcessedCommit } from "./types";

export function isCommitProcessed(repo: string, sha: string) {
  const row = getDb()
    .prepare("SELECT id FROM processed_commits WHERE repo = ? AND sha = ?")
    .get(repo, sha);
  return Boolean(row);
}

export function recordCommit(commit: Commit): number {
  return claimCommit(commit) ?? existingCommitId(commit.repo, commit.sha);
}

/** Inserts the SHA, or returns null if this repo/sha was already processed. */
export function claimCommit(commit: Commit): number | null {
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO processed_commits
        (repo, sha, branch, message, author, committed_at, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      commit.repo,
      commit.sha,
      commit.branch,
      commit.message,
      commit.author,
      commit.committedAt,
      nowIso()
    );

  if (result.changes === 0) return null;
  return Number(result.lastInsertRowid);
}

function existingCommitId(repo: string, sha: string) {
  const existing = getDb()
    .prepare("SELECT id FROM processed_commits WHERE repo = ? AND sha = ?")
    .get(repo, sha) as { id: number };
  return existing.id;
}

export function recordMatch(input: {
  commitId: number;
  cardId: string;
  cardName: string;
  confidence: number;
  reason: string;
  action: "moved" | "dry_run" | "skipped";
}) {
  getDb()
    .prepare(
      `INSERT INTO matches
        (commit_id, card_id, card_name, confidence, reason, action, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.commitId,
      input.cardId,
      input.cardName,
      input.confidence,
      input.reason,
      input.action,
      nowIso()
    );
}

export function logEvent(
  level: AgentEvent["level"],
  message: string,
  detail?: string,
  commitId?: number | null
) {
  getDb()
    .prepare(
      "INSERT INTO events (level, message, detail, created_at, commit_id) VALUES (?, ?, ?, ?, ?)"
    )
    .run(level, message, detail ?? null, nowIso(), commitId ?? null);
}

export function setCursor(repo: string, lastSha: string) {
  getDb()
    .prepare(
      `INSERT INTO poll_cursors (repo, last_sha, last_polled_at)
       VALUES (?, ?, ?)
       ON CONFLICT(repo) DO UPDATE SET last_sha = excluded.last_sha, last_polled_at = excluded.last_polled_at`
    )
    .run(repo, lastSha, nowIso());
}

export function listRecentCommits(limit = 25): ProcessedCommit[] {
  return getDb()
    .prepare(
      `SELECT id, repo, sha, branch, message, author,
              committed_at AS committedAt, processed_at AS processedAt
       FROM processed_commits
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(limit) as ProcessedCommit[];
}

export function listRecentMatches(limit = 25): MatchRecord[] {
  return getDb()
    .prepare(
      `SELECT m.id, m.commit_id AS commitId, c.repo, c.sha, c.message AS commitMessage,
              m.card_id AS cardId, m.card_name AS cardName, m.confidence, m.reason,
              m.action, m.created_at AS createdAt
       FROM matches m
       JOIN processed_commits c ON c.id = m.commit_id
       ORDER BY m.id DESC
       LIMIT ?`
    )
    .all(limit) as MatchRecord[];
}

export function listEvents(limit = 200): AgentEvent[] {
  return getDb()
    .prepare(
      `SELECT id, level, message, detail, created_at AS createdAt,
              commit_id AS commitId
       FROM events
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(limit) as AgentEvent[];
}

export function stats() {
  const db = getDb();
  const commits = db.prepare("SELECT COUNT(*) AS n FROM processed_commits").get() as {
    n: number;
  };
  const moved = db
    .prepare("SELECT COUNT(*) AS n FROM matches WHERE action = 'moved'")
    .get() as { n: number };
  const dryRun = db
    .prepare("SELECT COUNT(*) AS n FROM matches WHERE action = 'dry_run'")
    .get() as { n: number };
  return {
    processedCommits: commits.n,
    cardsMoved: moved.n,
    dryRunMatches: dryRun.n,
  };
}
