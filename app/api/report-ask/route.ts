import { NextResponse } from "next/server";
import { getKid, getReport } from "@/lib/db";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { askViaService } from "@/lib/python";

export async function POST(req: Request) {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const input = (body ?? {}) as Record<string, unknown>;

  const reportId = Number(input.reportId);
  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (!Number.isInteger(reportId) || reportId <= 0) {
    return NextResponse.json({ error: "Invalid report id." }, { status: 400 });
  }
  if (!question) {
    return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
  }

  const report = getReport(reportId);
  if (!report) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }
  const kid = getKid(report.kid_id);
  if (!isAdmin(user) && kid && kid.user_id != null && kid.user_id !== user.id) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  let markdown = report.summary_text;
  try {
    const payload = JSON.parse(report.json_payload) as { report_markdown?: string };
    if (payload.report_markdown) markdown = payload.report_markdown;
  } catch {
    // fall back to summary_text
  }

  const context = `Here is ${kid?.name ?? "the player"}'s most recent coach report:\n\n${markdown}`;

  try {
    const { answer } = await askViaService(question, kid?.name, context.slice(0, 8000));
    return NextResponse.json({ answer });
  } catch (err) {
    const message = err instanceof Error ? err.message : "The coach is unreachable right now.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
