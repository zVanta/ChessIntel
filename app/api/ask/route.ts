import { NextResponse } from "next/server";
import { askViaService } from "@/lib/python";

export async function POST(req: Request) {
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

  const notes =
    typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : undefined;
  const kidName = typeof input.kidName === "string" ? input.kidName.trim() : undefined;

  try {
    const { answer } = await askViaService(question, kidName, notes);
    return NextResponse.json({ answer });
  } catch (err) {
    const message = err instanceof Error ? err.message : "The coach is unreachable right now.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
