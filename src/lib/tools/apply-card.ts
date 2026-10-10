import { logEvent, recordMatch } from "@/lib/store";
import { moveCardToList } from "@/lib/trello";
import type { AgentSettings, CardMatch, TrelloCard } from "@/lib/types";

export async function applyCardDecision(
  settings: AgentSettings,
  commitId: number,
  match: CardMatch,
  card: TrelloCard,
  doneListId: string
) {
  if (settings.dryRun) {
    recordMatch({
      commitId,
      cardId: card.id,
      cardName: card.name,
      confidence: match.confidence,
      reason: match.reason,
      action: "dry_run",
    });
    logEvent(
      "info",
      `Dry run: would move “${card.name}” to Done`,
      `${match.source} ${match.confidence.toFixed(2)} — ${match.reason}`
    );
    return;
  }

  try {
    await moveCardToList(
      settings.trelloKey,
      settings.trelloToken,
      card.id,
      doneListId
    );
    card.idList = doneListId;
    recordMatch({
      commitId,
      cardId: card.id,
      cardName: card.name,
      confidence: match.confidence,
      reason: match.reason,
      action: "moved",
    });
    logEvent(
      "info",
      `Moved “${card.name}” to Done`,
      `${match.source} ${match.confidence.toFixed(2)} — ${match.reason}`
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Move failed";
    recordMatch({
      commitId,
      cardId: card.id,
      cardName: card.name,
      confidence: match.confidence,
      reason: match.reason,
      action: "skipped",
    });
    logEvent("error", `Failed to move “${card.name}”`, detail);
  }
}
