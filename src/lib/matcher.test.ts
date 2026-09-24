import { describe, expect, it } from "vitest";
import { extractJsonObject } from "./json";
import { parseMatchResponse } from "./lmstudio";
import { heuristicMatches, mergeMatches } from "./matcher";
import type { Commit, TrelloCard } from "./types";

const commit = (message: string): Commit => ({
  repo: "acme/api",
  sha: "abc1234def",
  branch: "main",
  message,
  author: "Ada",
  committedAt: "2026-09-24T00:00:00Z",
  htmlUrl: "https://github.com/acme/api/commit/abc1234def",
});

const card = (overrides: Partial<TrelloCard> = {}): TrelloCard => ({
  id: "card-1",
  name: "Add password reset email",
  desc: "Send a reset link when a user forgets their password.",
  idList: "list-1",
  listName: "In Progress",
  url: "https://trello.com/c/abc123/1",
  shortLink: "abc123",
  ...overrides,
});

describe("heuristicMatches", () => {
  it("matches a commit that repeats the card title", () => {
    const matches = heuristicMatches(
      commit("Add password reset email\n\nCloses the Trello card."),
      [card()]
    );
    expect(matches[0]?.cardId).toBe("card-1");
    expect(matches[0]?.confidence).toBeGreaterThan(0.8);
  });

  it("matches a Trello short link in the commit message", () => {
    const matches = heuristicMatches(commit("Finish work for abc123"), [card()]);
    expect(matches[0]?.reason).toMatch(/short link/i);
  });

  it("ignores unrelated work", () => {
    const matches = heuristicMatches(commit("Bump lodash"), [card()]);
    expect(matches).toHaveLength(0);
  });
});

describe("mergeMatches", () => {
  it("keeps LLM matches above the confidence floor", () => {
    const merged = mergeMatches(
      [
        {
          cardId: "card-1",
          cardName: "Add password reset email",
          confidence: 0.81,
          reason: "Commit implements the card.",
          source: "llm",
        },
      ],
      [],
      0.72
    );
    expect(merged).toHaveLength(1);
  });

  it("drops low-confidence guesses", () => {
    const merged = mergeMatches(
      [
        {
          cardId: "card-1",
          cardName: "Add password reset email",
          confidence: 0.2,
          reason: "Maybe.",
          source: "llm",
        },
      ],
      [],
      0.72
    );
    expect(merged).toHaveLength(0);
  });
});

describe("LLM JSON parsing", () => {
  it("reads a fenced JSON object and maps card ids", () => {
    const parsed = extractJsonObject(
      'Sure.\n```json\n{"matches":[{"cardId":"card-1","confidence":0.9,"reason":"Close."}]}\n```'
    );
    expect(parsed.matches).toHaveLength(1);

    const matches = parseMatchResponse(
      JSON.stringify({
        matches: [{ card_id: "card-1", confidence: 0.88, reason: "Done." }],
      }),
      [card()]
    );
    expect(matches[0]).toMatchObject({ cardId: "card-1", source: "llm" });
  });
});
