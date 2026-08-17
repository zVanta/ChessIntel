import { beforeEach, describe, expect, it, vi } from "vitest";

// Keep the route test free of Next.js runtime: replace NextResponse with a
// thin wrapper over the standard Response object.
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
  },
}));

import { POST } from "../../app/api/kids/route";
import { resetDbForTests } from "../../lib/db";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/kids", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/kids", () => {
  beforeEach(() => {
    process.env.DATABASE_PATH = ":memory:";
    resetDbForTests();
  });

  it("rejects a missing name", async () => {
    const res = await POST(makeRequest({ chesscomUsername: "alice_123" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/name/i);
  });

  it("rejects an invalid chess.com username", async () => {
    const res = await POST(makeRequest({ name: "Alice", chesscomUsername: "bad user!" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/invalid/i);
  });

  it("rejects an invalid Lichess username", async () => {
    const res = await POST(makeRequest({ name: "Alice", lichessUsername: "a!" }));
    expect(res.status).toBe(400);
  });

  it("rejects when no username is provided", async () => {
    const res = await POST(makeRequest({ name: "Alice" }));
    expect(res.status).toBe(400);
  });

  it("creates a kid with valid input", async () => {
    const res = await POST(
      makeRequest({
        name: "Alice",
        chesscomUsername: "alice_123",
        lichessUsername: "alice-123",
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.kid.name).toBe("Alice");
    expect(data.kid.chesscom_username).toBe("alice_123");
    expect(data.kid.lichess_username).toBe("alice-123");
  });
});
