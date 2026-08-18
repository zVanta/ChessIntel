import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { getUserById } from "./db";
import type { User } from "./types";

export const SESSION_COOKIE = "cc_session";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// If no secret is configured, generate a random one for this process. This
// keeps sessions un-forgeable (there is no hardcoded secret in the repo), at
// the cost of signing everyone out on restart. Set AUTH_SECRET to persist.
const AUTH_SECRET =
  process.env.AUTH_SECRET && process.env.AUTH_SECRET.length > 0
    ? process.env.AUTH_SECRET
    : (() => {
        console.warn(
          "[auth] AUTH_SECRET is not set — generated a random session secret for this process. " +
            "Logins will reset on restart. Set AUTH_SECRET to persist sessions."
        );
        return randomBytes(32).toString("hex");
      })();

export function sessionCookieOptions(): {
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

function sign(payload: string): string {
  return createHmac("sha256", AUTH_SECRET).update(payload).digest("hex");
}

/** Create a signed session token carrying the user id and an expiry time. */
export function createSessionToken(userId: number): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token: string): number | null {
  const [userIdStr, expiresStr, sig] = String(token).split(".");
  if (!userIdStr || !expiresStr || !sig) return null;

  const payload = `${userIdStr}.${expiresStr}`;
  const expected = sign(payload);
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const userId = Number(userIdStr);
  const expiresAt = Number(expiresStr);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  return userId;
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
