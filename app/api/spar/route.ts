import { NextResponse } from "next/server";
import { sparMove } from "@/lib/python";
import { getSessionUser } from "@/lib/auth";

/** POST /api/spar { fen, elo } → one move from the sparring partner. */
export async function POST(req: Request) {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: { fen?: string; elo?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const fen = (body.fen || "").trim();
  if (!fen) {
    return NextResponse.json({ error: "fen is required." }, { status: 400 });
  }

  try {
    const result = await sparMove(fen, Number(body.elo) || 1200);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "The engine is unreachable right now.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
