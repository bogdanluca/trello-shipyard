import { z } from "zod";
import { parseAgentMode } from "./agents/modes";
import { getDb } from "./db";
import type { AgentSettings } from "./types";

const settingsSchema = z.object({
  githubToken: z.string().default(""),
  githubRepos: z.string().default(""),
  trelloKey: z.string().default(""),
  trelloToken: z.string().default(""),
  trelloBoardId: z.string().default(""),
  trelloDoneListName: z.string().default("Done"),
  lmstudioBaseUrl: z.string().default("http://127.0.0.1:11434/v1"),
  lmstudioModel: z.string().default(""),
  pollIntervalSeconds: z.coerce.number().min(15).max(3600).default(60),
  lookbackCommits: z.coerce.number().min(1).max(100).default(25),
  minConfidence: z.coerce.number().min(0).max(1).default(0.72),
  dryRun: z.coerce.boolean().default(true),
  autoPoll: z.coerce.boolean().default(true),
  agentMode: z.preprocess(
    (value) => (typeof value === "string" ? parseAgentMode(value) : value),
    z.enum(["tool-free", "handwritten"])
  ).default("tool-free"),
});

const KEYS = Object.keys(settingsSchema.shape) as (keyof AgentSettings)[];

function envDefaults(): Partial<AgentSettings> {
  return {
    githubToken: process.env.GITHUB_TOKEN ?? "",
    githubRepos: process.env.GITHUB_REPOS ?? "",
    trelloKey: process.env.TRELLO_API_KEY ?? "",
    trelloToken: process.env.TRELLO_TOKEN ?? "",
    trelloBoardId: process.env.TRELLO_BOARD_ID ?? "",
    trelloDoneListName: process.env.TRELLO_DONE_LIST ?? "Done",
    lmstudioBaseUrl: process.env.LMSTUDIO_BASE_URL ?? "http://127.0.0.1:11434/v1",
    lmstudioModel: process.env.LMSTUDIO_MODEL ?? "",
    pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS ?? 60),
    lookbackCommits: Number(process.env.LOOKBACK_COMMITS ?? 25),
    minConfidence: Number(process.env.MIN_CONFIDENCE ?? 0.72),
    dryRun: (process.env.DRY_RUN ?? "true") !== "false",
    autoPoll: (process.env.AUTO_POLL ?? "true") !== "false",
    agentMode: parseAgentMode(process.env.AGENT_MODE),
  };
}

export function getSettings(): AgentSettings {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const stored = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const merged = { ...envDefaults(), ...deserialize(stored) };
  return settingsSchema.parse(merged);
}

export function saveSettings(partial: Partial<AgentSettings>): AgentSettings {
  const next = settingsSchema.parse({ ...getSettings(), ...partial });
  const db = getDb();
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const tx = db.transaction(() => {
    for (const key of KEYS) {
      upsert.run(key, serialize(next[key]));
    }
  });
  tx();
  return next;
}

function serialize(value: AgentSettings[keyof AgentSettings]) {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function deserialize(stored: Record<string, string>): Partial<AgentSettings> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (key === "dryRun" || key === "autoPoll") {
      out[key] = value === "true";
    } else if (
      key === "pollIntervalSeconds" ||
      key === "lookbackCommits" ||
      key === "minConfidence"
    ) {
      out[key] = Number(value);
    } else if (key === "agentMode") {
      out[key] = parseAgentMode(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function publicSettings(settings: AgentSettings) {
  return {
    ...settings,
    githubToken: mask(settings.githubToken),
    trelloKey: mask(settings.trelloKey),
    trelloToken: mask(settings.trelloToken),
    hasGithubToken: Boolean(settings.githubToken),
    hasTrelloKey: Boolean(settings.trelloKey),
    hasTrelloToken: Boolean(settings.trelloToken),
  };
}

function mask(value: string) {
  if (!value) return "";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export { settingsSchema };
