import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * CSRF guard for cookie-authenticated endpoints.
 *
 * Cookie auth is vulnerable to cross-site request forgery. SameSite=Lax blocks
 * most cases, but this middleware adds a belt-and-braces check: any mutating
 * request must come from the same origin as the request Host. Requests with no
 * Origin/Referer (Stripe webhooks, CLI tools) are allowed through.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function middleware(req: NextRequest) {
  if (SAFE_METHODS.has(req.method)) {
    return NextResponse.next();
  }

  const source = req.headers.get("origin") || req.headers.get("referer");
  if (!source) {
    // Non-browser client (Stripe webhook, CLI). Signature/token checks apply
    // at the route level.
    return NextResponse.next();
  }

  let sourceHost: string;
  try {
    sourceHost = new URL(source).host;
  } catch {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const host = req.headers.get("host") || "";
  if (sourceHost === host) {
    return NextResponse.next();
  }

  return NextResponse.json({ error: "Cross-origin request blocked." }, { status: 403 });
}

export const config = {
  matcher: ["/api/:path*"],
};
