import { NextResponse } from "next/server";
import { runPoll } from "@/lib/poller";

export const runtime = "nodejs";

export async function POST() {
  try {
    const result = await runPoll("manual");
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Poll failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
