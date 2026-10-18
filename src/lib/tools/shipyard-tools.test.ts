import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeShipyardTool, type ToolContext } from "./shipyard-tools";
import type { AgentSettings, Commit, TrelloCard } from "@/lib/types";

vi.mock("@/lib/sources", () => ({
  loadRecentCommits: vi.fn(),
  loadOpenBoardCards: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  claimCommit: vi.fn(() => 11),
  recordCommit: vi.fn(() => 11),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/tools/apply-card", () => ({
  applyCardDecision: vi.fn(),
}));

import { loadOpenBoardCards, loadRecentCommits } from "@/lib/sources";
import { applyCardDecision } from "@/lib/tools/apply-card";

const settings = {
  minConfidence: 0.72,
  dryRun: true,
} as AgentSettings;

const commit: Commit = {
  repo: "acme/api",
  sha: "abc1234def",
  branch: "main",
  message: "Fix poller",
  author: "Ada",
  committedAt: "2026-10-10T00:00:00Z",
  htmlUrl: "https://github.com/acme/api/commit/abc1234def",
};

const card: TrelloCard = {
  id: "card-1",
  name: "Fix poller",
  desc: "",
  idList: "list-1",
  listName: "Doing",
  url: "https://trello.com/c/abc/1",
  shortLink: "abc",
};

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    settings,
    commits: [commit],
    cards: [card],
    doneListId: "done",
    doneListName: "Done",
    claimedIds: new Map(),
    lastCommitId: null,
    newCommits: { count: 0 },
    matchedCards: { count: 0 },
    ...overrides,
  };
}

describe("executeShipyardTool", () => {
  beforeEach(() => {
    vi.mocked(loadRecentCommits).mockReset();
    vi.mocked(loadOpenBoardCards).mockReset();
    vi.mocked(applyCardDecision).mockReset();
  });

  it("lists recent commits from GitHub", async () => {
    vi.mocked(loadRecentCommits).mockResolvedValue({
      unseen: [commit],
      repos: [
        { repo: "acme/api", branch: "main", unseenCount: 1, stoppedAt: null },
      ],
    });
    const state = ctx({ commits: [] });
    const result = JSON.parse(await executeShipyardTool("list_recent_commits", {}, state));
    expect(result.unseen[0].shortSha).toBe("abc1234");
    expect(state.commits).toEqual([commit]);
  });

  it("lists open cards from Trello", async () => {
    vi.mocked(loadOpenBoardCards).mockResolvedValue({
      cards: [card],
      doneList: { id: "done", name: "Done" },
    });
    const state = ctx({ cards: [], doneListId: null });
    const result = JSON.parse(await executeShipyardTool("list_open_cards", {}, state));
    expect(result.cards).toEqual([
      {
        id: "card-1",
        name: "Fix poller",
        shortLink: "abc",
        list: "Doing",
        desc: "",
      },
    ]);
    expect(state.doneListId).toBe("done");
  });

  it("rejects unknown cards", async () => {
    const result = JSON.parse(
      await executeShipyardTool(
        "move_card_to_done",
        { sha: "abc1234", cardId: "nope", reason: "x" },
        ctx()
      )
    );
    expect(result.ok).toBe(false);
  });

  it("requires a sha from list_recent_commits", async () => {
    const result = JSON.parse(
      await executeShipyardTool(
        "no_match",
        { sha: "deadbeef", reason: "nothing" },
        ctx({ commits: [] })
      )
    );
    expect(result.ok).toBe(false);
  });
});
