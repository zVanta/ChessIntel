import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { dailyPuzzle } from "@/lib/python";

/** GET /api/puzzles → today's Lichess puzzle (via the Python service). */
export async function GET() {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const puzzle = await dailyPuzzle();
    return NextResponse.json(puzzle);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Lichess puzzle service unavailable.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
