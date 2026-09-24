import type { CardMatch, Commit, TrelloCard } from "./types";

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "to",
  "for",
  "of",
  "in",
  "on",
  "with",
  "from",
  "into",
  "by",
  "is",
  "are",
  "was",
  "were",
  "be",
  "this",
  "that",
  "it",
  "as",
  "at",
  "or",
  "fix",
  "fixed",
  "fixes",
  "add",
  "added",
  "adds",
  "update",
  "updated",
  "updates",
  "implement",
  "implemented",
]);

export function heuristicMatches(commit: Commit, cards: TrelloCard[]): CardMatch[] {
  const commitText = normalize(commit.message);
  const commitTokens = tokens(commit.message);
  const matches: CardMatch[] = [];

  for (const card of cards) {
    const title = normalize(card.name);
    const haystack = normalize(`${card.name} ${card.desc} ${card.shortLink}`);
    let confidence = 0;
    let reason = "";

    if (card.shortLink && commitText.includes(card.shortLink.toLowerCase())) {
      confidence = 0.95;
      reason = "Commit mentions the Trello card short link.";
    } else if (title && commitText.includes(title)) {
      confidence = 0.9;
      reason = "Commit message contains the full card title.";
    } else {
      const titleTokens = [...tokens(card.name)];
      const overlap = titleTokens.filter((token) => commitTokens.has(token));
      if (titleTokens.length > 0 && overlap.length > 0) {
        const ratio = overlap.length / titleTokens.length;
        if (ratio >= 0.6 || overlap.length >= 3) {
          confidence = Math.min(0.84, 0.45 + ratio * 0.4);
          reason = `Shared keywords: ${overlap.slice(0, 6).join(", ")}.`;
        }
      }
      if (!reason) {
        const descTokens = [...tokens(card.desc)].slice(0, 40);
        const descOverlap = descTokens.filter((token) => commitTokens.has(token));
        if (descOverlap.length >= 4) {
          confidence = 0.7;
          reason = `Commit overlaps the card description (${descOverlap.slice(0, 5).join(", ")}).`;
        }
      }
    }

    if (confidence > 0 && haystack) {
      matches.push({
        cardId: card.id,
        cardName: card.name,
        confidence,
        reason,
        source: "heuristic",
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

export function mergeMatches(
  llm: CardMatch[],
  heuristic: CardMatch[],
  minConfidence: number
): CardMatch[] {
  const merged = new Map<string, CardMatch>();
  for (const match of [...heuristic, ...llm]) {
    const current = merged.get(match.cardId);
    if (!current || match.confidence > current.confidence) {
      merged.set(match.cardId, match);
    } else if (current.source !== "llm" && match.source === "llm") {
      merged.set(match.cardId, {
        ...match,
        confidence: Math.max(current.confidence, match.confidence),
      });
    }
  }
  return [...merged.values()]
    .filter((match) => match.confidence >= minConfidence)
    .sort((a, b) => b.confidence - a.confidence);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2 && !STOPWORDS.has(token))
  );
}
