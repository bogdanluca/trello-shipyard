import { NextResponse } from "next/server";
import { getSettings, publicSettings, saveSettings, settingsSchema } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(publicSettings(getSettings()));
}

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const current = getSettings();
  const incoming = settingsSchema.partial().parse(body);

  if (keepExistingSecret(incoming.githubToken)) incoming.githubToken = current.githubToken;
  if (keepExistingSecret(incoming.trelloKey)) incoming.trelloKey = current.trelloKey;
  if (keepExistingSecret(incoming.trelloToken)) incoming.trelloToken = current.trelloToken;
  if (keepExistingSecret(incoming.githubWebhookSecret)) {
    incoming.githubWebhookSecret = current.githubWebhookSecret;
  }

  const saved = saveSettings(incoming);
  return NextResponse.json(publicSettings(saved));
}

function keepExistingSecret(value?: string) {
  return !value || value.includes("••••");
}
