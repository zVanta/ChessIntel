import { describe, expect, it } from "vitest";
import { puzzleFenFromPgn } from "../../lib/lichess";

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
