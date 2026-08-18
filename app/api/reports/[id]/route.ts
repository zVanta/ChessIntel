import { NextResponse } from "next/server";
import { deleteReport, getKid, getReport } from "@/lib/db";
import { getSessionUser, isAdmin } from "@/lib/auth";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid report id." }, { status: 400 });
  }

  const report = getReport(id);
  if (!report) return NextResponse.json({ error: "Report not found." }, { status: 404 });

  const kid = getKid(report.kid_id);
  if (!isAdmin(user) && (!kid || kid.user_id !== user.id)) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  deleteReport(id);
  return NextResponse.json({ ok: true });
}
