import { describe, expect, it } from "vitest";
import { executeShipyardTool, type ToolContext } from "./shipyard-tools";
import type { AgentSettings, Commit, TrelloCard } from "@/lib/types";

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

function ctx(): ToolContext {
  return {
    settings,
    commit,
    commitId: 1,
    cards: [card],
    doneListId: "done",
    matchedCards: { count: 0 },
  };
}

describe("executeShipyardTool", () => {
  it("lists open cards", async () => {
    const result = JSON.parse(await executeShipyardTool("list_open_cards", {}, ctx()));
    expect(result).toEqual([
      {
        id: "card-1",
        name: "Fix poller",
        shortLink: "abc",
        list: "Doing",
        desc: "",
      },
    ]);
  });

  it("rejects unknown cards", async () => {
    const result = JSON.parse(
      await executeShipyardTool("move_card_to_done", { cardId: "nope", reason: "x" }, ctx())
    );
    expect(result.ok).toBe(false);
  });
});
