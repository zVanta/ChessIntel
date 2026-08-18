import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => {
      const res = new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      });
      // Route handlers call res.cookies.set(...); polyfill it as a no-op.
      (res as unknown as { cookies: { set: () => void } }).cookies = { set: () => {} };
      return res;
    },
  },
}));

const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined,
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
  }),
}));

import { POST } from "../../app/api/auth/register/route";
import { resetDbForTests } from "../../lib/db";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    process.env.DATABASE_PATH = ":memory:";
    resetDbForTests();
  });

  it("registers a new user with JSON response", async () => {
    const res = await POST(makeRequest({ email: "new@example.com", password: "password123" }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.user.email).toBe("new@example.com");
    expect(data.user.credits).toBe(1);
  });

  it("rejects a short password", async () => {
    const res = await POST(makeRequest({ email: "new@example.com", password: "short" }));
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate email", async () => {
    await POST(makeRequest({ email: "dup@example.com", password: "password123" }));
    const res = await POST(makeRequest({ email: "dup@example.com", password: "password123" }));
    expect(res.status).toBe(409);
  });
});
