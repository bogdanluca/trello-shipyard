"use client";

import { useEffect, useMemo, useState } from "react";
import { GitCommitHorizontal, Play, RefreshCw, Save } from "lucide-react";
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

const emptyForm: AgentSettings = {
  githubToken: "",
  githubRepos: "",
  trelloKey: "",
  trelloToken: "",
  trelloBoardId: "",
  trelloDoneListName: "Done",
  lmstudioBaseUrl: "http://127.0.0.1:1234/v1",
  lmstudioModel: "",
  pollIntervalSeconds: 60,
  lookbackCommits: 25,
  minConfidence: 0.72,
  dryRun: true,
  autoPoll: true,
};

export function Dashboard() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [form, setForm] = useState<AgentSettings>(emptyForm);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "run" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load agent status.");
    const data = (await response.json()) as StatusPayload;
    setStatus(data);
    setForm({
      githubToken: data.settings.githubToken,
      githubRepos: data.settings.githubRepos,
      trelloKey: data.settings.trelloKey,
      trelloToken: data.settings.trelloToken,
      trelloBoardId: data.settings.trelloBoardId,
      trelloDoneListName: data.settings.trelloDoneListName,
      lmstudioBaseUrl: data.settings.lmstudioBaseUrl,
      lmstudioModel: data.settings.lmstudioModel,
      pollIntervalSeconds: data.settings.pollIntervalSeconds,
      lookbackCommits: data.settings.lookbackCommits,
      minConfidence: data.settings.minConfidence,
      dryRun: data.settings.dryRun,
      autoPoll: data.settings.autoPoll,
    });
  }

  useEffect(() => {
    refresh()
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : "Failed to load.");
      });
    const id = setInterval(() => {
      refresh().catch(() => undefined);
    }, 15000);
    return () => clearInterval(id);
  }, []);

  const healthItems = useMemo(() => {
    if (!status) return [];
    return [
      { name: "GitHub", ...status.health.github },
      { name: "Trello", ...status.health.trello },
      { name: "LM Studio", ...status.health.lmstudio },
    ];
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
      await refresh();
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
      await refresh();
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
            local LM Studio model whether the commit finishes a Trello card, then
            moves matching cards to Done. State lives in SQLite under{" "}
            <code className="font-mono text-foreground">data/shipyard.db</code>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => refresh()} disabled={busy !== null}>
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
              <Field label="Trello token" htmlFor="trelloToken">
                <Input
                  id="trelloToken"
                  type="password"
                  value={form.trelloToken}
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
                label="LM Studio base URL"
                htmlFor="lmstudioBaseUrl"
                hint="Developer → Local Server. Optional; keyword matching still works without it."
              >
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
                {status.poller.lastRunAt
                  ? `Last poll ${new Date(status.poller.lastRunAt).toLocaleString()}`
                  : "No poll has finished yet."}
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
            </CardHeader>
            <CardContent>
              {status.commits.length === 0 ? (
                <Empty text="No commits stored yet. The agent only records SHAs it has already seen." />
              ) : (
                <ul className="space-y-3">
                  {status.commits.map((commit) => (
                    <li key={commit.id} className="flex gap-3">
                      <GitCommitHorizontal className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="font-mono text-xs text-muted-foreground">
                          {commit.repo}@{commit.sha.slice(0, 7)} · {commit.branch}
                        </p>
                        <p className="text-sm">{commit.message.split("\n")[0]}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {status.events.length === 0 ? (
            <Empty text="The agent has not written any events yet." />
          ) : (
            <ul className="space-y-2">
              {status.events.map((event) => (
                <li key={event.id} className="grid gap-1 border-b py-2 last:border-0 sm:grid-cols-[90px_1fr]">
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
