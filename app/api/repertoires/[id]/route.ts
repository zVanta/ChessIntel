import { NextResponse } from "next/server";
import { deleteRepertoire, getKid, getRepertoire, getRepertoireMoves } from "@/lib/db";
import { getSessionUser, isAdmin } from "@/lib/auth";

function canAccess(user: ReturnType<typeof getSessionUser>, kidUserId: number | null): boolean {
  if (!user) return false;
  return isAdmin(user) || kidUserId == null || kidUserId === user.id;
}

/** GET /api/repertoires/[id] → repertoire + its moves. DELETE → remove it. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
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

  return NextResponse.json({ repertoire, moves: getRepertoireMoves(id) });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
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

  deleteRepertoire(id);
  return NextResponse.json({ ok: true });
}
