import { NextResponse } from "next/server";
import { deleteUser } from "@/lib/db";
import { getSessionUser, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

export async function GET() {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      credits: user.credits,
      subscription_status: user.subscription_status,
    },
  });
}

export async function DELETE() {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (user.role === "admin") {
    return NextResponse.json({ error: "Admin accounts cannot self-delete." }, { status: 400 });
  }
  deleteUser(user.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}
