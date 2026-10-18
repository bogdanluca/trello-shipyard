import { runCurrentSession } from "@/lib/agents/current";
import { runLoopAgent } from "@/lib/agents/loop";
import type { AgentRunResult, AgentSettings } from "@/lib/types";

export async function runPollAgent(settings: AgentSettings): Promise<AgentRunResult> {
  if (settings.agentMode === "loop") {
    return runLoopAgent({ settings });
  }
  return runCurrentSession({ settings });
}
