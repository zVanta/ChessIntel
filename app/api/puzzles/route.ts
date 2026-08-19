import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

const LICHESS_DAILY = "https://lichess.org/api/puzzle/daily";
const USER_AGENT = "CheckmateCoach/1.0 (https://github.com/zVanta/ChessIntel)";

export interface DailyPuzzle {
  id: string;
  rating: number;
  themes: string[];
  fen: string;
  solution: string[];
  plays: number;
}

/** Fetch today's Lichess puzzle and reduce it to what the client needs. */
export async function GET() {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const res = await fetch(LICHESS_DAILY, {
      headers: { "User-Agent": USER_AGENT },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Lichess puzzle service unavailable." }, { status: 502 });
    }
    const data = (await res.json()) as {
      puzzle?: {
        id?: string;
        rating?: number;
        themes?: string[];
        fen?: string;
        solution?: string[];
        plays?: number;
      };
    };
    const puzzle = data.puzzle;
    if (!puzzle?.fen || !Array.isArray(puzzle.solution) || puzzle.solution.length === 0) {
      return NextResponse.json({ error: "Unexpected puzzle payload." }, { status: 502 });
    }
    const payload: DailyPuzzle = {
      id: puzzle.id || "",
      rating: puzzle.rating ?? 0,
      themes: puzzle.themes ?? [],
      fen: puzzle.fen,
      solution: puzzle.solution,
      plays: puzzle.plays ?? 0,
    };
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ error: "Could not reach Lichess." }, { status: 502 });
  }
}
