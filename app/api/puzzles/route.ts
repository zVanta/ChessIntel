import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { randomPuzzle } from "@/lib/python";

export const dynamic = "force-dynamic";

/** GET /api/puzzles → a fresh random puzzle (proxied via the Python service). */
export async function GET() {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const puzzle = await randomPuzzle();
    return NextResponse.json(puzzle, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Puzzle service unavailable.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
