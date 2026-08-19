import { NextResponse } from "next/server";
import { createRepertoire, getKid, listRepertoires } from "@/lib/db";
import { getSessionUser, isAdmin } from "@/lib/auth";

/** GET /api/repertoires?kidId=N → the kid's repertoires. POST → create one. */
export async function GET(req: Request) {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const kidId = Number(new URL(req.url).searchParams.get("kidId"));
  if (!Number.isInteger(kidId) || kidId <= 0) {
    return NextResponse.json({ error: "kidId is required." }, { status: 400 });
  }
  const kid = getKid(kidId);
  if (!kid) return NextResponse.json({ error: "Kid not found." }, { status: 404 });
  if (!isAdmin(user) && kid.user_id != null && kid.user_id !== user.id) {
    return NextResponse.json({ error: "Kid not found." }, { status: 404 });
  }
  return NextResponse.json({ repertoires: listRepertoires(kidId) });
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
  const kidId = Number(input.kidId);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const color = input.color === "black" ? "black" : "white";

  if (!Number.isInteger(kidId) || kidId <= 0) {
    return NextResponse.json({ error: "kidId is required." }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  if (name.length > 80) {
    return NextResponse.json({ error: "Name is too long." }, { status: 400 });
  }
  const kid = getKid(kidId);
  if (!kid) return NextResponse.json({ error: "Kid not found." }, { status: 404 });
  if (!isAdmin(user) && kid.user_id != null && kid.user_id !== user.id) {
    return NextResponse.json({ error: "Kid not found." }, { status: 404 });
  }

  const repertoire = createRepertoire(kidId, name, color);
  return NextResponse.json({ repertoire });
}
