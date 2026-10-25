import { runCurrentSession } from "@/lib/agents/current";
import { runLoopAgent } from "@/lib/agents/loop";
import { runStrandsAgent } from "@/lib/agents/strands";
import type { AgentRunResult, AgentSettings } from "@/lib/types";

export async function runPollAgent(settings: AgentSettings): Promise<AgentRunResult> {
  if (settings.agentMode === "handwritten") {
    return runLoopAgent({ settings });
  }
  if (settings.agentMode === "strands") {
    return runStrandsAgent({ settings });
  }
  return runCurrentSession({ settings });
}
