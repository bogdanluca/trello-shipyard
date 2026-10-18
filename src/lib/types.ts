export type ConnectionStatus = "ok" | "missing" | "error";

export type AgentMode = "current" | "loop";

export type AgentRunResult = {
  newCommits: number;
  matchedCards: number;
  doneList?: string;
};

export type AgentSettings = {
  githubToken: string;
  githubRepos: string;
  trelloKey: string;
  trelloToken: string;
  trelloBoardId: string;
  trelloDoneListName: string;
  lmstudioBaseUrl: string;
  lmstudioModel: string;
  pollIntervalSeconds: number;
  lookbackCommits: number;
  minConfidence: number;
  dryRun: boolean;
  autoPoll: boolean;
  agentMode: AgentMode;
};

export type RepoRef = {
  owner: string;
  name: string;
  fullName: string;
  branch?: string;
};

export type Commit = {
  repo: string;
  sha: string;
  branch: string;
  message: string;
  author: string;
  committedAt: string;
  htmlUrl: string;
};

export type TrelloCard = {
  id: string;
  name: string;
  desc: string;
  idList: string;
  listName: string;
  url: string;
  shortLink: string;
};

export type TrelloList = {
  id: string;
  name: string;
};

export type CardMatch = {
  cardId: string;
  cardName: string;
  confidence: number;
  reason: string;
  source: "llm" | "heuristic" | "loop";
};

export type ProcessedCommit = {
  id: number;
  repo: string;
  sha: string;
  branch: string;
  message: string;
  author: string;
  committedAt: string;
  processedAt: string;
};

export type MatchRecord = {
  id: number;
  commitId: number;
  repo: string;
  sha: string;
  commitMessage: string;
  cardId: string;
  cardName: string;
  confidence: number;
  reason: string;
  action: "moved" | "dry_run" | "skipped";
  createdAt: string;
};

export type AgentEvent = {
  id: number;
  level: "info" | "warn" | "error";
  message: string;
  detail: string | null;
  createdAt: string;
  commitId: number | null;
};

export type ServiceHealth = {
  github: { status: ConnectionStatus; detail: string };
  trello: { status: ConnectionStatus; detail: string };
  lmstudio: { status: ConnectionStatus; detail: string };
};
