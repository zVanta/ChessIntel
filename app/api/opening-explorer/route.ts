import { NextResponse } from "next/server";
import { openingExplorer } from "@/lib/lichess";
import { getSessionUser } from "@/lib/auth";

/** GET /api/opening-explorer?fen=... → popular moves from the Lichess database. */
export async function GET(req: Request) {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const fen = new URL(req.url).searchParams.get("fen") || "";
  if (!fen.trim()) {
    return NextResponse.json({ error: "fen is required." }, { status: 400 });
  }

  try {
    const result = await openingExplorer(fen.trim());
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "The opening explorer is unreachable.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
