import { NextResponse } from "next/server";
import { askViaService } from "@/lib/python";
import { getSessionUser } from "@/lib/auth";
import { rateLimited } from "@/lib/rateLimit";

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

  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (!question) {
    return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
  }
  if (question.length > 2000) {
    return NextResponse.json({ error: "Question is too long." }, { status: 400 });
  }
  if (rateLimited(`ask:${user.id}`, 30, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "You're asking a lot — take a short break." }, { status: 429 });
  }

  const notes =
    typeof input.notes === "string" && input.notes.trim() ? input.notes.trim().slice(0, 8000) : undefined;
  const kidName = typeof input.kidName === "string" ? input.kidName.trim() : undefined;

  try {
    const { answer } = await askViaService(question, kidName, notes);
    return NextResponse.json({ answer });
  } catch (err) {
    const message = err instanceof Error ? err.message : "The coach is unreachable right now.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
