import { NextResponse } from "next/server";
import { getGamesForReport, getKidsWithMeta, getReportsForKid } from "@/lib/db";
import { getSessionUser, isAdmin } from "@/lib/auth";

/**
 * Data export (subject access request). Returns a JSON document with the
 * signed-in user's kids, reports, and game PGNs. Admins export their own data
 * (not everyone's) — this is for personal data portability.
 */
export async function GET() {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const kids = getKidsWithMeta(user.id).map((k) => {
    const reports = getReportsForKid(k.id).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      recurring_habit: r.recurring_habit,
      drill: r.drill,
      points_lost: r.points_lost,
      summary_text: r.summary_text,
      games: getGamesForReport(r.id).map((g) => ({
        source: g.source,
        external_id: g.external_id,
        pgn: g.pgn,
        analyzed_at: g.analyzed_at,
      })),
    }));
    return {
      id: k.id,
      name: k.name,
      age: k.age,
      uscf_rating: k.uscf_rating,
      fide_rating: k.fide_rating,
      online_rating: k.online_rating,
      chesscom_username: k.chesscom_username,
      lichess_username: k.lichess_username,
      focus_notes: k.focus_notes,
      created_at: k.created_at,
      reports,
    };
  });

  const payload = {
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email, role: user.role, credits: user.credits },
    kids,
  };

  return NextResponse.json(payload, {
    headers: {
      "Content-Disposition": 'attachment; filename="checkmate-coach-data.json"',
    },
  });
}
