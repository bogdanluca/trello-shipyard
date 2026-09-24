import { checkGithub } from "./github";
import { checkLmStudio } from "./lmstudio";
import { checkTrello } from "./trello";
import type { AgentSettings, ServiceHealth } from "./types";

export async function getHealth(settings: AgentSettings): Promise<ServiceHealth> {
  const [github, trello, lmstudio] = await Promise.all([
    probe(() => checkGithub(settings.githubToken), !settings.githubToken),
    probe(
      () =>
        checkTrello(settings.trelloKey, settings.trelloToken, settings.trelloBoardId),
      !settings.trelloKey || !settings.trelloToken || !settings.trelloBoardId
    ),
    probe(
      () => checkLmStudio(settings.lmstudioBaseUrl, settings.lmstudioModel),
      false,
      "LM Studio is not running. Start the local server (usually port 1234) or the agent will use keyword matching only."
    ),
  ]);

  return { github, trello, lmstudio };
}

async function probe(
  fn: () => Promise<string>,
  missing: boolean,
  missingMessage = "Not configured yet."
): Promise<ServiceHealth[keyof ServiceHealth]> {
  if (missing) return { status: "missing", detail: missingMessage };
  try {
    return { status: "ok", detail: await fn() };
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
