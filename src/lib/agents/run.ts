import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import { runCurrentSession } from "@/lib/agents/current";
import { runLoopAgent } from "@/lib/agents/loop";
import { runStrandsAgent } from "@/lib/agents/strands";
import type { AgentRunResult, AgentSettings } from "@/lib/types";

export async function runPollAgent(
  settings: AgentSettings,
  trigger: "manual" | "scheduled" | "webhook" = "manual"
): Promise<AgentRunResult> {
  return startActiveObservation(
    "match-commits",
    async (observation) => {
      observation.update({
        input: {
          trigger,
          agentMode: settings.agentMode,
          dryRun: settings.dryRun,
        },
      });
      const result = await propagateAttributes(
        {
          tags: [settings.agentMode, trigger],
          metadata: {
            agentMode: settings.agentMode,
            trigger,
            dryRun: settings.dryRun,
          },
        },
        async () => {
          if (settings.agentMode === "handwritten") {
            return runLoopAgent({ settings });
          }
          if (settings.agentMode === "strands") {
            return runStrandsAgent({ settings });
          }
          return runCurrentSession({ settings });
        }
      );
      observation.update({
        output: {
          newCommits: result.newCommits,
          matchedCards: result.matchedCards,
          doneList: result.doneList ?? null,
        },
      });
      return result;
    },
    { asType: "agent" }
  );
}
