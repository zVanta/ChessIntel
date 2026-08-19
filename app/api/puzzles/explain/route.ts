import { NextResponse } from "next/server";
import { explainPuzzle } from "@/lib/python";
import { getSessionUser } from "@/lib/auth";
import { rateLimited } from "@/lib/rateLimit";

/** Explain a wrong move in a puzzle — hint first, full reveal on request. */
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

  const playedMove = typeof input.playedMove === "string" ? input.playedMove.trim() : "";
  if (!playedMove) {
    return NextResponse.json({ error: "playedMove is required." }, { status: 400 });
  }
  if (rateLimited(`puzzle:${user.id}`, 30, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests — take a short break." }, { status: 429 });
  }

  const fen = typeof input.fen === "string" ? input.fen : "";
  const solutionMove = typeof input.solutionMove === "string" ? input.solutionMove.trim() : "";
  const themes = Array.isArray(input.themes)
    ? (input.themes as unknown[]).map((t) => String(t ?? "").trim()).filter(Boolean)
    : [];
  const kidName = typeof input.kidName === "string" ? input.kidName.trim() : undefined;
  const reveal = Boolean(input.reveal);

  try {
    const { answer } = await explainPuzzle({
      fen,
      played_move: playedMove,
      solution_move: solutionMove,
      themes,
      kid_name: kidName || "Player",
      reveal,
    });
    return NextResponse.json({ answer });
  } catch (err) {
    const message = err instanceof Error ? err.message : "The coach is unreachable right now.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
