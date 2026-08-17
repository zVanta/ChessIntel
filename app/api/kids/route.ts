import { NextResponse } from "next/server";
import { createKid, getKidsWithMeta } from "@/lib/db";
import { validateKidInput } from "@/lib/validation";

export async function GET() {
  const kids = getKidsWithMeta();
  return NextResponse.json({ kids });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const input = (body ?? {}) as Record<string, unknown>;

  const validation = validateKidInput({
    name: input.name,
    chesscomUsername: input.chesscomUsername,
    lichessUsername: input.lichessUsername,
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const name = String(input.name).trim();
  const chesscom = input.chesscomUsername ? String(input.chesscomUsername).trim() : null;
  const lichess = input.lichessUsername ? String(input.lichessUsername).trim() : null;

  const kid = createKid(name, chesscom, lichess);
  return NextResponse.json({ kid }, { status: 201 });
}
