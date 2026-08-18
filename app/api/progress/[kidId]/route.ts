import { NextResponse } from "next/server";
import { getKid, getProgressForKid, getReportsForKid } from "@/lib/db";
import { getSessionUser, isAdmin } from "@/lib/auth";

export async function GET(
  _req: Request,
  { params }: { params: { kidId: string } }
) {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const kidId = Number(params.kidId);
  if (!Number.isInteger(kidId) || kidId <= 0) {
    return NextResponse.json({ error: "Invalid kid id." }, { status: 400 });
  }
  const kid = getKid(kidId);
  if (!kid) {
    return NextResponse.json({ error: "Kid not found." }, { status: 404 });
  }
  if (!isAdmin(user) && kid.user_id != null && kid.user_id !== user.id) {
    return NextResponse.json({ error: "Kid not found." }, { status: 404 });
  }
  const reports = getReportsForKid(kidId);
  const progress = getProgressForKid(kidId);
  return NextResponse.json({ kid, reports, progress });
}
