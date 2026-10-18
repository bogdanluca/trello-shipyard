import { NextResponse } from "next/server";
import { matchWatchedPush, verifyGithubSignature } from "@/lib/github-webhook";
import { isConfigured, runPoll } from "@/lib/poller";
import { parseRepos } from "@/lib/repos";
import { getSettings } from "@/lib/settings";
import { logEvent } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: "POST GitHub webhook events here (Content-Type: application/json).",
  });
}

export async function POST(request: Request) {
  const settings = getSettings();
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const event = request.headers.get("x-github-event") ?? "";
  const delivery = request.headers.get("x-github-delivery") ?? "";

  if (!settings.githubWebhookSecret) {
    return NextResponse.json(
      { error: "Set a GitHub webhook secret in settings." },
      { status: 503 }
    );
  }
  if (!verifyGithubSignature(settings.githubWebhookSecret, rawBody, signature)) {
    logEvent("warn", "GitHub webhook signature rejected", delivery || event);
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  if (event === "ping") {
    logEvent("info", "GitHub webhook ping", delivery);
    return NextResponse.json({ ok: true, event: "ping" });
  }

  if (event !== "push") {
    return NextResponse.json({ ok: true, ignored: event });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const match = matchWatchedPush(
    parseRepos(settings.githubRepos),
    (payload ?? {}) as { ref?: string; repository?: { full_name?: string; default_branch?: string } }
  );
  if (!match.ok) {
    logEvent("info", "GitHub webhook ignored", match.reason);
    return NextResponse.json({ ok: true, ignored: match.reason });
  }

  if (!isConfigured(settings)) {
    logEvent(
      "warn",
      "GitHub webhook received but the agent is not fully configured",
      `${match.repo}@${match.branch}`
    );
    return NextResponse.json(
      { error: "GitHub and Trello settings are incomplete." },
      { status: 400 }
    );
  }

  logEvent(
    "info",
    "GitHub webhook accepted",
    `${match.repo}@${match.branch} delivery=${delivery}`
  );
  void runPoll("webhook").catch((error) => {
    const message = error instanceof Error ? error.message : "Webhook poll failed";
    logEvent("error", "Webhook poll failed", message);
  });

  return NextResponse.json(
    { accepted: true, repo: match.repo, branch: match.branch },
    { status: 202 }
  );
}
