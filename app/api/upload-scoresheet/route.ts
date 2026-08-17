import { NextResponse } from "next/server";
import { getKid } from "@/lib/db";
import { canGenerateReport } from "@/lib/billing";
import { analyzePgnViaService, ocrScoresheet } from "@/lib/python";
import { persistAnalysis } from "@/lib/persist";

export async function POST(req: Request) {
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

  if (!canGenerateReport(kidId)) {
    return NextResponse.json(
      {
        error:
          "Subscription required. The first report is free; please subscribe to generate more reports.",
      },
      { status: 402 }
    );
  }

  const image = form.get("image");
  if (!(image instanceof File)) {
    return NextResponse.json({ error: "An 'image' file field is required." }, { status: 400 });
  }
  const buffer = Buffer.from(await image.arrayBuffer());

  try {
    const pgn = await ocrScoresheet(buffer, kid.name);
    if (!pgn || !pgn.trim()) {
      return NextResponse.json({ error: "No moves could be read from the scoresheet." }, { status: 422 });
    }
    const result = await analyzePgnViaService(pgn, kid.name);
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
    const message = err instanceof Error ? err.message : "Scoresheet processing failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
