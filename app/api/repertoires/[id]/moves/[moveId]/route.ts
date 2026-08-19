import { NextResponse } from "next/server";
import { deleteRepertoireMove, getKid, getRepertoire, getRepertoireMove } from "@/lib/db";
import { getSessionUser, isAdmin } from "@/lib/auth";

function canAccess(user: ReturnType<typeof getSessionUser>, kidUserId: number | null): boolean {
  if (!user) return false;
  return isAdmin(user) || kidUserId == null || kidUserId === user.id;
}

/** DELETE /api/repertoires/[id]/moves/[moveId] */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; moveId: string } }
) {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const id = Number(params.id);
  const moveId = Number(params.moveId);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(moveId) || moveId <= 0) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }
  const repertoire = getRepertoire(id);
  const move = getRepertoireMove(moveId);
  if (!repertoire || !move || move.repertoire_id !== id) {
    return NextResponse.json({ error: "Move not found." }, { status: 404 });
  }
  const kid = getKid(repertoire.kid_id);
  if (!kid || !canAccess(user, kid.user_id)) {
    return NextResponse.json({ error: "Move not found." }, { status: 404 });
  }

  deleteRepertoireMove(moveId);
  return NextResponse.json({ ok: true });
}
