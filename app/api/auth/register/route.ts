import { NextResponse } from "next/server";
import { getUserByEmail, createUser } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { rateLimited } from "@/lib/rateLimit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const input = (body ?? {}) as Record<string, unknown>;

  try {
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const password = typeof input.password === "string" ? input.password : "";

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }
    if (password.length > 200) {
      return NextResponse.json({ error: "Password must be 200 characters or fewer." }, { status: 400 });
    }
    if (rateLimited(`register:${email}`, 5, 60 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    }
    if (getUserByEmail(email)) {
      return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
    }

    const user = createUser(email, hashPassword(password), "user", 1);
    const res = NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          credits: user.credits,
          subscription_status: user.subscription_status,
        },
      },
      { status: 201 }
    );
    res.cookies.set(SESSION_COOKIE, createSessionToken(user.id), sessionCookieOptions());
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Account creation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
