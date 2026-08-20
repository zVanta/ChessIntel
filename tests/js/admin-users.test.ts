import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
  },
}));

vi.mock("../../lib/auth", () => ({
  getSessionUser: () => ({
    id: 999,
    email: "admin@test.com",
    password_hash: "x",
    role: "admin",
    credits: 999999,
    created_at: "",
  }),
  isAdmin: () => true,
}));

import { PATCH } from "../../app/api/admin/users/[id]/route";
import { resetDbForTests } from "../../lib/db";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/users/1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/admin/users/[id]", () => {
  beforeEach(() => {
    process.env.DATABASE_PATH = ":memory:";
    resetDbForTests();
  });

  it("rejects negative credits", async () => {
    const res = await PATCH(makeRequest({ credits: -5 }), { params: { id: "1" } });
    expect(res.status).toBe(400);
  });

  it("rejects non-integer credits", async () => {
    const res = await PATCH(makeRequest({ credits: 1.5 }), { params: { id: "1" } });
    expect(res.status).toBe(400);
  });

  it("rejects absurd credit amounts", async () => {
    const res = await PATCH(makeRequest({ credits: 9_999_999 }), { params: { id: "1" } });
    expect(res.status).toBe(400);
  });

  it("accepts a valid credit grant", async () => {
    const res = await PATCH(makeRequest({ credits: 25 }), { params: { id: "1" } });
    expect(res.status).toBe(200);
  });
});
