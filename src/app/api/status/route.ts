import { NextResponse } from "next/server";
import { getHealth } from "@/lib/health";
import { pollerStatus } from "@/lib/poller";
import { getSettings, publicSettings } from "@/lib/settings";
import { listEvents, listRecentCommits, listRecentMatches, stats } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const settings = getSettings();
  const health = await getHealth(settings);
  return NextResponse.json({
    settings: publicSettings(settings),
    health,
    poller: pollerStatus(),
    stats: stats(),
    commits: listRecentCommits(),
    matches: listRecentMatches(),
    events: listEvents(),
  });
}
