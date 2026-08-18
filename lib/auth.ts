import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { getUserById } from "./db";
import type { User } from "./types";

const SESSION_COOKIE = "cc_session";
const AUTH_SECRET = process.env.AUTH_SECRET || "checkmate-coach-dev-secret-change-me";

function sign(payload: string): string {
  return createHmac("sha256", AUTH_SECRET).update(payload).digest("hex");
}

/** Create a signed, tamper-proof session token for a user id. */
export function createSessionToken(userId: number): string {
  const payload = String(userId);
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token: string): number | null {
  const [payload, sig] = String(token).split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const userId = Number(payload);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

/** Set the session cookie (route handlers only — cookies() is mutable there). */
export function setSessionCookie(userId: number): void {
  const token = createSessionToken(userId);
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSessionCookie(): void {
  cookies().set(SESSION_COOKIE, "", { maxAge: 0, path: "/" });
}

/** Resolve the currently signed-in user from the request cookie, if any. */
export function getSessionUser(): User | null {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = verifySessionToken(token);
  if (!userId) return null;
  return getUserById(userId) ?? null;
}

export function isAdmin(user: User | null): boolean {
  return user?.role === "admin";
}
