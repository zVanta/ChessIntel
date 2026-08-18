import { NextResponse } from "next/server";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getDb, listUsers } from "@/lib/db";

export async function GET() {
  const user = getSessionUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  const db = getDb();
  const users = listUsers().map((u) => {
    const kids = db
      .prepare(`SELECT COUNT(*) AS n FROM kids WHERE user_id = ?`)
      .get(u.id) as { n: number };
    const reports = db
      .prepare(
        `SELECT COUNT(*) AS n FROM reports r JOIN kids k ON k.id = r.kid_id WHERE k.user_id = ?`
      )
      .get(u.id) as { n: number };
    return {
      id: u.id,
      email: u.email,
      role: u.role,
      credits: u.credits,
      created_at: u.created_at,
      kids_count: kids.n,
      reports_count: reports.n,
      subscription_status: u.subscription_status,
    };
  });

  return NextResponse.json({ users });
}
