import { NextResponse } from "next/server";
import { getKid } from "@/lib/db";
import { canGenerateReport } from "@/lib/billing";
import { analyzePgnViaService } from "@/lib/python";
import { persistAnalysis } from "@/lib/persist";

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

  const pgn = typeof input.pgn === "string" ? input.pgn.trim() : "";
  if (!pgn) {
    return NextResponse.json({ error: "Paste a PGN first." }, { status: 400 });
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

  const notes =
    typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : undefined;
  const answers = Array.isArray(input.answers)
    ? (input.answers as unknown[]).map((a) => String(a ?? "").trim()).filter(Boolean)
    : undefined;

  try {
    const result = await analyzePgnViaService(pgn, kid.name, notes, answers);
    const persisted = persistAnalysis(kidId, result);
    return NextResponse.json(
      {
        report: persisted.report,
        followup: persisted.followup,
        game_count: persisted.games.length,
      },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "PGN analysis failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
