"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Play, RefreshCw, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type {
  AgentEvent,
  AgentMode,
  AgentSettings,
  MatchRecord,
  ProcessedCommit,
  ServiceHealth,
} from "@/lib/types";

type StatusPayload = {
  settings: AgentSettings & {
    hasGithubToken: boolean;
    hasTrelloKey: boolean;
    hasTrelloToken: boolean;
  };
  health: ServiceHealth;
  poller: { running: boolean; lastRunAt: string | null; lastError: string | null };
  stats: { processedCommits: number; cardsMoved: number; dryRunMatches: number };
  commits: ProcessedCommit[];
  matches: MatchRecord[];
  events: AgentEvent[];
};

const LLM_PRESETS = [
  { label: "Ollama", url: "http://127.0.0.1:11434/v1" },
  { label: "llama.cpp", url: "http://127.0.0.1:8080/v1" },
  { label: "LM Studio", url: "http://127.0.0.1:1234/v1" },
] as const;

const AGENT_MODES: { id: AgentMode; label: string; hint: string }[] = [
  {
    id: "current",
    label: "Current",
    hint: "Keywords plus a JSON classifier. The model does not call tools.",
  },
  {
    id: "loop",
    label: "Tool loop",
    hint: "The model calls list_recent_commits, list_open_cards, move_card_to_done, and no_match. This file runs them.",
  },
];

const emptyForm: AgentSettings = {
  githubToken: "",
  githubRepos: "",
  trelloKey: "",
  trelloToken: "",
  trelloBoardId: "",
  trelloDoneListName: "Done",
  lmstudioBaseUrl: "http://127.0.0.1:11434/v1",
  lmstudioModel: "",
  pollIntervalSeconds: 60,
  lookbackCommits: 25,
  minConfidence: 0.72,
  dryRun: true,
  autoPoll: true,
  agentMode: "current",
};

export function Dashboard() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [form, setForm] = useState<AgentSettings>(emptyForm);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "run" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedCommitId, setExpandedCommitId] = useState<number | null>(null);

  async function refresh(syncForm = false) {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load agent status.");
    const data = (await response.json()) as StatusPayload;
    setStatus(data);
    if (!syncForm) return;
    setForm({
      githubToken: "",
      githubRepos: data.settings.githubRepos,
      trelloKey: "",
      trelloToken: "",
      trelloBoardId: data.settings.trelloBoardId,
      trelloDoneListName: data.settings.trelloDoneListName,
      lmstudioBaseUrl: data.settings.lmstudioBaseUrl,
      lmstudioModel: data.settings.lmstudioModel,
      pollIntervalSeconds: data.settings.pollIntervalSeconds,
      lookbackCommits: data.settings.lookbackCommits,
      minConfidence: data.settings.minConfidence,
      dryRun: data.settings.dryRun,
      autoPoll: data.settings.autoPoll,
      agentMode: data.settings.agentMode,
    });
  }

  useEffect(() => {
    refresh(true).catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : "Failed to load.");
    });
    const id = setInterval(() => {
      refresh(false).catch(() => undefined);
    }, 15000);
    return () => clearInterval(id);
  }, []);

  const healthItems = useMemo(() => {
    if (!status) return [];
    return [
      { name: "GitHub", ...status.health.github },
      { name: "Trello", ...status.health.trello },
      { name: "Local model", ...status.health.lmstudio },
    ];
  }, [status]);

  const activityEvents = useMemo(() => {
    if (!status) return [];
    return status.events
      .filter((event) => event.commitId == null)
      .filter((event, index, events) => {
        const previous = events[index - 1];
        return (
          !previous ||
          previous.message !== event.message ||
          previous.detail !== event.detail
        );
      });
  }, [status]);

  const eventsByCommitId = useMemo(() => {
    const grouped = new Map<number, AgentEvent[]>();
    if (!status) return grouped;
    for (const event of [...status.events].reverse()) {
      if (event.commitId == null) continue;
      const list = grouped.get(event.commitId) ?? [];
      list.push(event);
      grouped.set(event.commitId, list);
    }
    return grouped;
  }, [status]);

  async function onSave() {
    setBusy("save");
    setNotice(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) throw new Error("Could not save settings.");
      await refresh(true);
      setNotice("Settings saved to the local SQLite database.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onRun() {
    setBusy("run");
    setNotice(null);
    try {
      const response = await fetch("/api/run", { method: "POST" });
      const data = (await response.json()) as {
        error?: string;
        skipped?: boolean;
        newCommits?: number;
        matchedCards?: number;
        dryRun?: boolean;
        message?: string;
      };
      if (!response.ok) throw new Error(data.error || "Poll failed.");
      if (data.skipped) {
        setNotice(data.message ?? "A poll is already running.");
      } else {
        setNotice(
          `Checked main/master. ${data.newCommits ?? 0} new commits, ${data.matchedCards ?? 0} card matches${data.dryRun ? " (dry run — cards were not moved)." : "."}`
        );
      }
      await refresh(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Poll failed.");
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-6 py-16">
        <h1 className="text-2xl font-semibold">Shipyard could not start</h1>
        <p className="mt-2 text-muted-foreground">{loadError}</p>
        <Button className="mt-6 w-fit" onClick={() => location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-6 py-16">
        <p className="text-muted-foreground">Loading agent state…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Local agent
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Shipyard</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Watches GitHub <code className="font-mono text-foreground">main</code>{" "}
            / <code className="font-mono text-foreground">master</code>, asks your
            local model (Ollama, llama.cpp, or LM Studio) whether the commit finishes a Trello card, then
            moves matching cards to Done. State lives in SQLite under{" "}
            <code className="font-mono text-foreground">data/shipyard.db</code>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => refresh(false)} disabled={busy !== null}>
            <RefreshCw data-icon="inline-start" />
            Refresh
          </Button>
          <Button onClick={onRun} disabled={busy !== null}>
            <Play data-icon="inline-start" />
            {busy === "run" ? "Polling…" : "Run now"}
          </Button>
        </div>
      </header>

      {notice ? (
        <p className="rounded-lg border bg-card px-3 py-2 text-sm">{notice}</p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3">
        {healthItems.map((item) => (
          <Card key={item.name} size="sm">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>{item.name}</CardTitle>
                <StatusBadge status={item.status} />
              </div>
              <CardDescription>{item.detail}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="Commits processed" value={status.stats.processedCommits} />
        <Stat label="Cards moved" value={status.stats.cardsMoved} />
        <Stat label="Dry-run matches" value={status.stats.dryRunMatches} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Connections</CardTitle>
            <CardDescription>
              Leave dry run on until you have checked a few matches. Secrets stay
              on this machine.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="GitHub token" htmlFor="githubToken">
              <Input
                id="githubToken"
                type="password"
                value={form.githubToken}
                placeholder="ghp_…"
                onChange={(event) =>
                  setForm((current) => ({ ...current, githubToken: event.target.value }))
                }
              />
            </Field>
            <Field
              label="Repositories"
              htmlFor="githubRepos"
              hint="One per line: owner/repo or owner/repo:branch. Default branch is used when omitted."
            >
              <Textarea
                id="githubRepos"
                rows={4}
                value={form.githubRepos}
                placeholder={"acme/api\nacme/web:main"}
                onChange={(event) =>
                  setForm((current) => ({ ...current, githubRepos: event.target.value }))
                }
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Trello API key" htmlFor="trelloKey">
                <Input
                  id="trelloKey"
                  type="password"
                  value={form.trelloKey}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, trelloKey: event.target.value }))
                  }
                />
              </Field>
              <Field
                label="Trello token"
                htmlFor="trelloToken"
                hint={
                  status.settings.hasTrelloToken
                    ? "A token is already saved. Paste a new one to replace it; leave blank to keep it."
                    : "Paste the Trello token. It stays after you move to another field."
                }
              >
                <Input
                  id="trelloToken"
                  type="password"
                  autoComplete="off"
                  value={form.trelloToken}
                  placeholder={
                    status.settings.hasTrelloToken ? "Saved — paste to replace" : "Paste token"
                  }
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      trelloToken: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Trello board id" htmlFor="trelloBoardId">
                <Input
                  id="trelloBoardId"
                  value={form.trelloBoardId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      trelloBoardId: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Done list name" htmlFor="trelloDoneListName">
                <Input
                  id="trelloDoneListName"
                  value={form.trelloDoneListName}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      trelloDoneListName: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Local model base URL"
                htmlFor="lmstudioBaseUrl"
                hint="Any OpenAI-compatible /v1 server. Intel Macs: use Ollama. Optional; keyword matching still works without it."
              >
                <div className="mb-2 flex flex-wrap gap-2">
                  {LLM_PRESETS.map((preset) => (
                    <Button
                      key={preset.label}
                      type="button"
                      size="sm"
                      variant={
                        form.lmstudioBaseUrl === preset.url ? "default" : "outline"
                      }
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          lmstudioBaseUrl: preset.url,
                        }))
                      }
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
                <Input
                  id="lmstudioBaseUrl"
                  value={form.lmstudioBaseUrl}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      lmstudioBaseUrl: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                label="Model id"
                htmlFor="lmstudioModel"
                hint="Leave blank to use whichever model is loaded."
              >
                <Input
                  id="lmstudioModel"
                  value={form.lmstudioModel}
                  placeholder="optional"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      lmstudioModel: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Poll interval (s)" htmlFor="pollIntervalSeconds">
                <Input
                  id="pollIntervalSeconds"
                  type="number"
                  min={15}
                  value={form.pollIntervalSeconds}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      pollIntervalSeconds: Number(event.target.value),
                    }))
                  }
                />
              </Field>
              <Field label="Lookback commits" htmlFor="lookbackCommits">
                <Input
                  id="lookbackCommits"
                  type="number"
                  min={1}
                  value={form.lookbackCommits}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      lookbackCommits: Number(event.target.value),
                    }))
                  }
                />
              </Field>
              <Field label="Min confidence" htmlFor="minConfidence">
                <Input
                  id="minConfidence"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={form.minConfidence}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      minConfidence: Number(event.target.value),
                    }))
                  }
                />
              </Field>
            </div>
            <Field
              label="Matching mode"
              htmlFor="agentMode"
              hint={AGENT_MODES.find((mode) => mode.id === form.agentMode)?.hint}
            >
              <div className="flex flex-wrap gap-2">
                {AGENT_MODES.map((mode) => (
                  <Button
                    key={mode.id}
                    type="button"
                    size="sm"
                    variant={form.agentMode === mode.id ? "default" : "outline"}
                    onClick={() =>
                      setForm((current) => ({ ...current, agentMode: mode.id }))
                    }
                  >
                    {mode.label}
                  </Button>
                ))}
              </div>
            </Field>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex items-center gap-3 text-sm">
                <Switch
                  checked={form.dryRun}
                  onCheckedChange={(checked) =>
                    setForm((current) => ({ ...current, dryRun: Boolean(checked) }))
                  }
                />
                Dry run (do not move cards)
              </label>
              <label className="flex items-center gap-3 text-sm">
                <Switch
                  checked={form.autoPoll}
                  onCheckedChange={(checked) =>
                    setForm((current) => ({ ...current, autoPoll: Boolean(checked) }))
                  }
                />
                Poll while the dashboard is running
              </label>
            </div>
            <Button onClick={onSave} disabled={busy !== null}>
              <Save data-icon="inline-start" />
              {busy === "save" ? "Saving…" : "Save settings"}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent matches</CardTitle>
              <CardDescription>
                {status.poller.lastRunAt ? (
                  <>
                    Last poll <LocalTime iso={status.poller.lastRunAt} />
                  </>
                ) : (
                  "No poll has finished yet."
                )}
                {status.poller.lastError ? ` ${status.poller.lastError}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {status.matches.length === 0 ? (
                <Empty text="No card matches yet. Run a poll after a commit lands on main." />
              ) : (
                <ul className="space-y-3">
                  {status.matches.map((match) => (
                    <li key={match.id} className="rounded-lg border px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">{match.cardName}</p>
                        <Badge variant={match.action === "moved" ? "default" : "secondary"}>
                          {match.action}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {match.repo}@{match.sha.slice(0, 7)} ·{" "}
                        {Math.round(match.confidence * 100)}% · {match.reason}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent commits</CardTitle>
              <CardDescription>
                Expand a row to see the agent log for that SHA.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {status.commits.length === 0 ? (
                <Empty text="No commits stored yet. The agent only records SHAs it has already seen." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="w-8 py-2 pr-2 font-medium" />
                        <th className="py-2 pr-3 font-medium">SHA</th>
                        <th className="py-2 pr-3 font-medium">Message</th>
                        <th className="py-2 font-medium">Processed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {status.commits.map((commit) => {
                        const open = expandedCommitId === commit.id;
                        const logs = eventsByCommitId.get(commit.id) ?? [];
                        return (
                          <CommitRow
                            key={commit.id}
                            commit={commit}
                            open={open}
                            logs={logs}
                            onToggle={() =>
                              setExpandedCommitId(open ? null : commit.id)
                            }
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
            <CardDescription>
              Poll-level events. Per-commit agent traces are on the commit rows.
            </CardDescription>
        </CardHeader>
        <CardContent>
          {activityEvents.length === 0 ? (
            <Empty text="The agent has not written any events yet." />
          ) : (
            <ul className="space-y-2">
              {activityEvents.map((event) => (
                <li key={event.id} className="grid gap-1 border-b py-2 last:border-0 sm:grid-cols-[160px_70px_1fr]">
                  <LocalTime iso={event.createdAt} />
                  <span className="text-xs font-medium uppercase text-muted-foreground">
                    {event.level}
                  </span>
                  <div>
                    <p className="text-sm">{event.message}</p>
                    {event.detail ? (
                      <p className="text-xs text-muted-foreground">{event.detail}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CommitRow({
  commit,
  open,
  logs,
  onToggle,
}: {
  commit: ProcessedCommit;
  open: boolean;
  logs: AgentEvent[];
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-b last:border-0">
        <td className="py-2 pr-2 align-top">
          <Button type="button" size="sm" variant="ghost" onClick={onToggle}>
            {open ? <ChevronDown /> : <ChevronRight />}
          </Button>
        </td>
        <td className="py-2 pr-3 align-top font-mono text-xs">
          {commit.sha.slice(0, 7)}
        </td>
        <td className="py-2 pr-3 align-top">
          <p>{commit.message.split("\n")[0]}</p>
          <p className="text-xs text-muted-foreground">
            {commit.repo} · {commit.branch}
          </p>
        </td>
        <td className="py-2 align-top">
          <LocalTime iso={commit.processedAt} />
        </td>
      </tr>
      {open ? (
        <tr className="border-b last:border-0">
          <td colSpan={4} className="pb-3">
            {logs.length === 0 ? (
              <p className="px-2 text-xs text-muted-foreground">
                No per-commit logs yet. Older SHAs were processed before this
                table existed. New polls write the agent trace here.
              </p>
            ) : (
              <ul className="space-y-2 rounded-lg border px-3 py-2">
                {logs.map((event) => (
                  <li key={event.id}>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <LocalTime iso={event.createdAt} />
                      <span className="text-xs font-medium uppercase text-muted-foreground">
                        {event.level}
                      </span>
                      <p className="text-sm">{event.message}</p>
                    </div>
                    {event.detail ? (
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
                        {event.detail}
                      </pre>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function LocalTime({ iso }: { iso: string }) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    setLabel(new Date(iso).toLocaleString());
  }, [iso]);

  return (
    <time dateTime={iso} className="text-xs text-muted-foreground">
      {label || "\u00a0"}
    </time>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function StatusBadge({ status }: { status: "ok" | "missing" | "error" }) {
  const label = status === "ok" ? "connected" : status === "missing" ? "not set" : "down";
  return (
    <Badge variant={status === "ok" ? "default" : status === "missing" ? "secondary" : "destructive"}>
      {label}
    </Badge>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}
