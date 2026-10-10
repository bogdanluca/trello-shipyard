import { runCurrentAgent } from "@/lib/agents/current";
import { runLoopAgent } from "@/lib/agents/loop";
import type { AgentSettings, Commit, TrelloCard } from "@/lib/types";

export async function runCommitAgent(input: {
  settings: AgentSettings;
  commit: Commit;
  commitId: number;
  cards: TrelloCard[];
  doneListId: string;
}): Promise<number> {
  if (input.settings.agentMode === "loop") {
    return runLoopAgent(input);
  }
  return runCurrentAgent(input);
}
