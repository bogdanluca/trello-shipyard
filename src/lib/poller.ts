import { runPollAgent } from "./agents/run";
import { parseRepos } from "./repos";
import { getSettings } from "./settings";
import { logEvent } from "./store";
import type { AgentSettings } from "./types";

const pollerGlobal = globalThis as typeof globalThis & {
  __shipyardPoller?: {
    running: boolean;
    timer: NodeJS.Timeout | null;
    lastRunAt: string | null;
    lastError: string | null;
  };
};

const pollerState = (pollerGlobal.__shipyardPoller ??= {
  running: false,
  timer: null,
  lastRunAt: null,
  lastError: null,
});

export function pollerStatus() {
  return {
    running: pollerState.running,
    lastRunAt: pollerState.lastRunAt,
    lastError: pollerState.lastError,
  };
}

export function startBackgroundPoller() {
  if (pollerState.timer) return;
  const tick = async () => {
    const settings = getSettings();
    if (!settings.autoPoll) return;
    if (!isConfigured(settings)) return;
    try {
      await runPoll("scheduled");
    } catch (error) {
      pollerState.lastError = error instanceof Error ? error.message : "Poll failed";
    }
  };
  void tick();
  pollerState.timer = setInterval(() => {
    const settings = getSettings();
    void tick();
    if (pollerState.timer) {
      clearInterval(pollerState.timer);
      pollerState.timer = setInterval(tick, settings.pollIntervalSeconds * 1000);
    }
  }, getSettings().pollIntervalSeconds * 1000);
}

export async function runPoll(trigger: "manual" | "scheduled") {
  if (pollerState.running) {
    return { skipped: true, message: "A poll is already running." };
  }

  pollerState.running = true;
  pollerState.lastError = null;
  const settings = getSettings();

  try {
    if (!isConfigured(settings)) {
      throw new Error(
        "Add a GitHub repo and token plus Trello key, token, and board id."
      );
    }
    const result = await runPollAgent(settings);
    pollerState.lastRunAt = new Date().toISOString();
    logEvent(
      "info",
      `Poll (${trigger}) finished`,
      `${result.newCommits} new commits, ${result.matchedCards} card matches, dryRun=${settings.dryRun}`
    );
    return {
      skipped: false,
      ...result,
      dryRun: settings.dryRun,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Poll failed";
    pollerState.lastError = message;
    logEvent("error", "Poll failed", message);
    throw error;
  } finally {
    pollerState.running = false;
  }
}

function isConfigured(settings: AgentSettings) {
  return (
    parseRepos(settings.githubRepos).length > 0 &&
    Boolean(settings.githubToken) &&
    Boolean(settings.trelloKey) &&
    Boolean(settings.trelloToken) &&
    Boolean(settings.trelloBoardId)
  );
}
