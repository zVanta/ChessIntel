import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { recordPuzzleCompletion } from "@/lib/db";

export const dynamic = "force-dynamic";

/** POST /api/puzzles/complete → save a solved puzzle to the user's profile. */
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
  const puzzleId = String(input.puzzleId || "").trim();
  const tries = Number(input.tries);
  const solved = Boolean(input.solved);

  if (!puzzleId) {
    return NextResponse.json({ error: "puzzleId is required." }, { status: 400 });
  }

  const completion = recordPuzzleCompletion(
    user.id,
    puzzleId,
    Number.isFinite(tries) ? tries : 0,
    solved
  );
  return NextResponse.json({ completion });
}
