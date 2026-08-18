import { NextResponse } from "next/server";
import { getReportsWithMeta } from "@/lib/db";
import { getSessionUser, isAdmin } from "@/lib/auth";

export async function GET() {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  // Users only see their own players' reports; admins see every report.
  const reports = getReportsWithMeta(isAdmin(user) ? undefined : user.id);
  return NextResponse.json({ reports });
}
