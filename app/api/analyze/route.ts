import { NextResponse } from "next/server";
import { getKid } from "@/lib/db";
import { canGenerateReport } from "@/lib/billing";
import { runAnalysis } from "@/lib/python";
import { persistAnalysis } from "@/lib/persist";
import { completeJob, createJob, failJob } from "@/lib/jobs";

const PLATFORMS = ["lichess", "chesscom"] as const;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const input = (body ?? {}) as Record<string, unknown>;

  const kidId = Number(input.kidId);
  if (!Number.isInteger(kidId) || kidId <= 0) {
    return NextResponse.json({ error: "kidId is required." }, { status: 400 });
  }
  const kid = getKid(kidId);
  if (!kid) {
    return NextResponse.json({ error: "Kid not found." }, { status: 404 });
  }

  // Resolve platform/username: explicit request wins, otherwise fall back to
  // the kid's configured usernames (Lichess preferred when both are set).
  const requestedPlatform = input.platform as string | undefined;
  let platform: string | null = requestedPlatform ?? null;
  if (platform && !PLATFORMS.includes(platform as (typeof PLATFORMS)[number])) {
    return NextResponse.json({ error: "platform must be 'lichess' or 'chesscom'." }, { status: 400 });
  }
  if (!platform) {
    platform = kid.lichess_username ? "lichess" : kid.chesscom_username ? "chesscom" : null;
  }
  if (!platform) {
    return NextResponse.json(
      { error: "No platform configured for this kid." },
      { status: 400 }
    );
  }

  const username =
    (input.username as string | undefined)?.trim() ||
    (platform === "lichess" ? kid.lichess_username : kid.chesscom_username) ||
    null;
  if (!username) {
    return NextResponse.json(
      { error: `No ${platform} username set for this kid.` },
      { status: 400 }
    );
  }

  if (!canGenerateReport(kidId)) {
    return NextResponse.json(
      {
        error:
          "Subscription required. The first report is free; please subscribe to generate more reports.",
      },
      { status: 402 }
    );
  }

  const rawMax = Number(input.maxGames ?? 20);
  const maxGames = Math.max(1, Math.min(50, Number.isFinite(rawMax) ? rawMax : 20));

  const notes =
    typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : undefined;
  const answers = Array.isArray(input.answers)
    ? (input.answers as unknown[]).map((a) => String(a ?? "").trim()).filter(Boolean)
    : undefined;

  const job = createJob();
  void (async () => {
    try {
      const result = await runAnalysis({
        platform,
        username,
        kid_name: kid.name,
        max_games: maxGames,
        since_days: 30,
        notes,
        answers,
      });
      const persisted = persistAnalysis(kidId, result);
      completeJob(job.id, {
        report: persisted.report,
        followup: persisted.followup,
        game_count: persisted.games.length,
      });
    } catch (err) {
      failJob(job.id, err instanceof Error ? err.message : "Analysis failed.");
    }
  })();

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
