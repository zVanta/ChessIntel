import { afterEach, describe, expect, it, vi } from "vitest";
import { dailyPuzzle, puzzleFenFromPgn } from "../../lib/lichess";

describe("puzzleFenFromPgn", () => {
  it("replays the PGN to the initial ply", () => {
    const pgn = '[Event "?"]\n\n1. e4 e5 2. Nf3 *';
    const fen = puzzleFenFromPgn(pgn, 2);
    const fields = fen?.split(" ");
    expect(fields?.[1]).toBe("w"); // White to move after 1...e5
    expect(fields?.[5]).toBe("2"); // start of move 2
    expect(fen).toContain("4p3"); // the black e5 pawn
  });

  it("returns the start position at ply 0", () => {
    const fen = puzzleFenFromPgn("1. e4 e5 2. Nf3 *", 0);
    expect(fen).toContain("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -");
  });

  it("returns null for garbage PGN", () => {
    expect(puzzleFenFromPgn("not a pgn", 0)).toBeNull();
  });
});

describe("dailyPuzzle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the FEN the API provides directly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          game: { pgn: "d4 d5" },
          puzzle: {
            id: "p1",
            rating: 1900,
            solution: ["e2e4"],
            themes: ["mateIn1"],
            plays: 10,
            fen: "FEN_FROM_API",
            initialPly: 5,
          },
        }),
      })
    );
    const puzzle = await dailyPuzzle();
    expect(puzzle.fen).toBe("FEN_FROM_API");
    expect(puzzle.id).toBe("p1");
    expect(puzzle.solution).toEqual(["e2e4"]);
  });

  it("falls back to PGN replay when the FEN is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          game: { pgn: "1. e4 e5 2. Nf3 *" },
          puzzle: { id: "p2", rating: 100, solution: ["g1f3"], themes: [], plays: 1, initialPly: 2 },
        }),
      })
    );
    const puzzle = await dailyPuzzle();
    expect(puzzle.fen.split(" ")[1]).toBe("w");
  });
});
