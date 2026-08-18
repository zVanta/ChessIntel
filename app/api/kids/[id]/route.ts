import { NextResponse } from "next/server";
import { deleteKid, getKid, updateKid } from "@/lib/db";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { validateKidInput } from "@/lib/validation";

function canAccess(user: NonNullable<ReturnType<typeof getSessionUser>>, kidId: number): boolean {
  if (isAdmin(user)) return true;
  const kid = getKid(kidId);
  return kid?.user_id === user.id;
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const kidId = Number(params.id);
  if (!Number.isInteger(kidId) || kidId <= 0) {
    return NextResponse.json({ error: "Invalid kid id." }, { status: 400 });
  }
  if (!canAccess(user, kidId)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const input = (body ?? {}) as Record<string, unknown>;

  const validation = validateKidInput(input);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  updateKid(kidId, {
    name: String(input.name).trim(),
    chesscom_username: input.chesscomUsername ? String(input.chesscomUsername).trim() : null,
    lichess_username: input.lichessUsername ? String(input.lichessUsername).trim() : null,
    age: input.age ? String(input.age).trim() : null,
    uscf_rating: input.uscfRating ? String(input.uscfRating).trim() : null,
    fide_rating: input.fideRating ? String(input.fideRating).trim() : null,
    online_rating: input.onlineRating ? String(input.onlineRating).trim() : null,
    focus_notes: input.focusNotes ? String(input.focusNotes).trim() : null,
  });

  return NextResponse.json({ kid: getKid(kidId) });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const kidId = Number(params.id);
  if (!Number.isInteger(kidId) || kidId <= 0) {
    return NextResponse.json({ error: "Invalid kid id." }, { status: 400 });
  }
  if (!canAccess(user, kidId)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  deleteKid(kidId);
  return NextResponse.json({ ok: true });
}
