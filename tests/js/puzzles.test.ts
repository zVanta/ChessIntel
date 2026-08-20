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
    id: 1,
    email: "test@example.com",
    password_hash: "x",
    role: "user",
    credits: 5,
    created_at: "",
  }),
  isAdmin: () => false,
}));

vi.mock("../../lib/python", () => ({
  randomPuzzle: vi.fn(),
}));

import { GET } from "../../app/api/puzzles/route";
import { randomPuzzle } from "../../lib/python";

beforeEach(() => {
  vi.mocked(randomPuzzle).mockReset();
});

describe("GET /api/puzzles", () => {
  it("proxies the service puzzle to the client", async () => {
    vi.mocked(randomPuzzle).mockResolvedValue({
      id: "p1",
      rating: 1700,
      themes: ["fork", "mateIn1"],
      fen: "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
      solution: ["c4f7", "e8f7"],
      plays: 42,
    });

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

  it("returns 502 when the service fails", async () => {
    vi.mocked(randomPuzzle).mockRejectedValue(
      new Error("Puzzle service unavailable (500)")
    );

    const res = await GET();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("Puzzle service unavailable");
  });
});
