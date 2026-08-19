import { NextResponse } from "next/server";
import { getDueMistakeCards, getKid, reviewMistakeCard } from "@/lib/db";
import { getSessionUser, isAdmin } from "@/lib/auth";

/**
 * Spaced-repetition mistake cards (Woodpecker-style training).
 *
 * GET  /api/train?kidId=N   → the kid's due cards
 * POST /api/train           → record a review { cardId, correct }
 */
export async function GET(req: Request) {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(req.url);
  const kidId = Number(url.searchParams.get("kidId"));
  if (!Number.isInteger(kidId) || kidId <= 0) {
    return NextResponse.json({ error: "kidId is required." }, { status: 400 });
  }
  const kid = getKid(kidId);
  if (!kid) return NextResponse.json({ error: "Kid not found." }, { status: 404 });
  if (!isAdmin(user) && kid.user_id != null && kid.user_id !== user.id) {
    return NextResponse.json({ error: "Kid not found." }, { status: 404 });
  }

  const cards = getDueMistakeCards(kidId);
  return NextResponse.json({ kid, cards });
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
  const cardId = Number(input.cardId);
  const correct = Boolean(input.correct);
  if (!Number.isInteger(cardId) || cardId <= 0) {
    return NextResponse.json({ error: "cardId is required." }, { status: 400 });
  }

  const card = reviewMistakeCard(cardId, correct);
  if (!card) return NextResponse.json({ error: "Card not found." }, { status: 404 });
  return NextResponse.json({ card });
}
