import { NextResponse } from "next/server";

/**
 * Stub endpoint. The daily puzzle is now fetched client-side from Lichess, so
 * nothing in the current app calls this route. It exists only so that older
 * cached browser bundles get a JSON response instead of an HTML 404 (which
 * surfaced as "Unexpected token '<' ... is not valid JSON").
 */
export function GET() {
  return NextResponse.json(
    { error: "This endpoint has moved. Please refresh the page to load the latest version." },
    { status: 410 }
  );
}
