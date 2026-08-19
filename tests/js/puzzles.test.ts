import { afterEach, describe, expect, it, vi } from "vitest";

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
    id: 1,
    email: "test@example.com",
    password_hash: "x",
    role: "user",
    credits: 5,
    created_at: "",
  }),
  isAdmin: () => false,
}));

import { GET } from "../../app/api/puzzles/route";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/puzzles", () => {
  it("reduces the Lichess daily puzzle to the client shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          game: { id: "g1", pgn: "1. e4" },
          puzzle: {
            id: "p1",
            rating: 1700,
            themes: ["fork", "mateIn1"],
            fen: "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
            solution: ["c4f7", "e8f7"],
            plays: 42,
          },
        }),
      })
    );
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "p1",
      rating: 1700,
      themes: ["fork", "mateIn1"],
      fen: "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
      solution: ["c4f7", "e8f7"],
      plays: 42,
    });
  });

  it("returns 502 on a malformed payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ puzzle: {} }) })
    );
    const res = await GET();
    expect(res.status).toBe(502);
  });
});
