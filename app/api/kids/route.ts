import { NextResponse } from "next/server";
import { createKid, getKidsWithMeta } from "@/lib/db";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { validateKidInput } from "@/lib/validation";
import { billingEnabled } from "@/lib/billing";

export async function GET() {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const kids = getKidsWithMeta(isAdmin(user) ? undefined : user.id);
  return NextResponse.json({ kids, billingEnabled: billingEnabled() });
}

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

  const validation = validateKidInput(input);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const kid = createKid({
    name: String(input.name).trim(),
    chesscomUsername: input.chesscomUsername ? String(input.chesscomUsername).trim() : null,
    lichessUsername: input.lichessUsername ? String(input.lichessUsername).trim() : null,
    age: input.age ? String(input.age).trim() : null,
    uscfRating: input.uscfRating ? String(input.uscfRating).trim() : null,
    fideRating: input.fideRating ? String(input.fideRating).trim() : null,
    onlineRating: input.onlineRating ? String(input.onlineRating).trim() : null,
    focusNotes: input.focusNotes ? String(input.focusNotes).trim() : null,
    userId: user.id,
  });
  return NextResponse.json({ kid }, { status: 201 });
}
