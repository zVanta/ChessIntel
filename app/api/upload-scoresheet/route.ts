import { NextResponse } from "next/server";
import { getKid } from "@/lib/db";
import { analyzePgnViaService, ocrScoresheet } from "@/lib/python";
import { persistAnalysis } from "@/lib/persist";
import { completeJob, createJob, failJob } from "@/lib/jobs";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { consumeCredit, refundCredit } from "@/lib/credits";

export async function POST(req: Request) {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const kidId = Number(form.get("kidId"));
  if (!Number.isInteger(kidId) || kidId <= 0) {
    return NextResponse.json({ error: "kidId is required." }, { status: 400 });
  }
  const kid = getKid(kidId);
  if (!kid) {
    return NextResponse.json({ error: "Kid not found." }, { status: 404 });
  }
  if (!isAdmin(user) && kid.user_id !== user.id) {
    return NextResponse.json({ error: "Kid not found." }, { status: 404 });
  }

  if (!consumeCredit(user.id)) {
    return NextResponse.json(
      { error: "No credits left. Fund credits on your Profile page." },
      { status: 402 }
    );
  }

  const image = form.get("image");
  if (!(image instanceof File)) {
    refundCredit(user.id);
    return NextResponse.json({ error: "An 'image' file field is required." }, { status: 400 });
  }
  const buffer = Buffer.from(await image.arrayBuffer());

  const notesRaw = form.get("notes");
  const notes =
    typeof notesRaw === "string" && notesRaw.trim() ? notesRaw.trim() : undefined;
  const sideRaw = form.get("side");
  const side = sideRaw === "white" || sideRaw === "black" ? sideRaw : undefined;
  const usernames = [kid.lichess_username, kid.chesscom_username].filter(
    (u): u is string => typeof u === "string" && u.trim().length > 0
  );
  let answers: string[] | undefined;
  const answersRaw = form.get("answers");
  if (typeof answersRaw === "string" && answersRaw.trim()) {
    try {
      const parsed = JSON.parse(answersRaw);
      if (Array.isArray(parsed)) {
        answers = parsed.map((a) => String(a ?? "").trim()).filter(Boolean);
      }
    } catch {
      answers = undefined;
    }
  }

  const job = createJob();
  void (async () => {
    try {
      const pgn = await ocrScoresheet(buffer, kid.name);
      if (!pgn || !pgn.trim()) {
        throw new Error("No moves could be read from the scoresheet.");
      }
      const result = await analyzePgnViaService(pgn, kid.name, notes, answers, { side, usernames });
      const persisted = persistAnalysis(kidId, result);
      completeJob(job.id, {
        report: persisted.report,
        followup: persisted.followup,
        game_count: persisted.games.length,
      });
    } catch (err) {
      refundCredit(user.id);
      failJob(job.id, err instanceof Error ? err.message : "Scoresheet processing failed.");
    }
  })();

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
