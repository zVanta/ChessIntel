import { NextResponse } from "next/server";
import { suggestRepertoireMoves } from "@/lib/python";
import { getSessionUser } from "@/lib/auth";

/** GET /api/repertoires/suggest?fen=... → Stockfish's top moves for a position. */
export async function GET(req: Request) {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const fen = new URL(req.url).searchParams.get("fen") || "";
  if (!fen.trim()) {
    return NextResponse.json({ error: "fen is required." }, { status: 400 });
  }

  try {
    const result = await suggestRepertoireMoves(fen.trim(), 5);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "The engine is unreachable right now.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
