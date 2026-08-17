import { NextResponse } from "next/server";
import { getKid, getProgressForKid, getReportsForKid } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: { kidId: string } }
) {
  const kidId = Number(params.kidId);
  if (!Number.isInteger(kidId) || kidId <= 0) {
    return NextResponse.json({ error: "Invalid kid id." }, { status: 400 });
  }
  const kid = getKid(kidId);
  if (!kid) {
    return NextResponse.json({ error: "Kid not found." }, { status: 404 });
  }
  const reports = getReportsForKid(kidId);
  const progress = getProgressForKid(kidId);
  return NextResponse.json({ kid, reports, progress });
}
