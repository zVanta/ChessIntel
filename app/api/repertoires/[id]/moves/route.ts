import { NextResponse } from "next/server";
import { addRepertoireMove, getKid, getRepertoire } from "@/lib/db";
import { getSessionUser, isAdmin } from "@/lib/auth";

function canAccess(user: ReturnType<typeof getSessionUser>, kidUserId: number | null): boolean {
  if (!user) return false;
  return isAdmin(user) || kidUserId == null || kidUserId === user.id;
}

/**
 * POST /api/repertoires/[id]/moves
 * Body: { fenBefore, uci, san, fenAfter }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }
  const repertoire = getRepertoire(id);
  if (!repertoire) return NextResponse.json({ error: "Repertoire not found." }, { status: 404 });
  const kid = getKid(repertoire.kid_id);
  if (!kid || !canAccess(user, kid.user_id)) {
    return NextResponse.json({ error: "Repertoire not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const input = (body ?? {}) as Record<string, unknown>;
  const fenBefore = typeof input.fenBefore === "string" ? input.fenBefore.trim() : "";
  const uci = typeof input.uci === "string" ? input.uci.trim() : "";
  const san = typeof input.san === "string" ? input.san.trim() : "";
  const fenAfter = typeof input.fenAfter === "string" ? input.fenAfter.trim() : "";
  if (!fenBefore || !uci || !san || !fenAfter) {
    return NextResponse.json(
      { error: "fenBefore, uci, san and fenAfter are required." },
      { status: 400 }
    );
  }

  const move = addRepertoireMove(id, fenBefore, uci, san, fenAfter);
  return NextResponse.json({ move });
}
