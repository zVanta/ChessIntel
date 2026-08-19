import { beforeEach, describe, expect, it } from "vitest";
import {
  addRepertoireMove,
  createKid,
  createRepertoire,
  createUser,
  getRepertoire,
  getRepertoireMoves,
  listRepertoires,
  resetDbForTests,
} from "../../lib/db";

describe("opening repertoires", () => {
  beforeEach(() => {
    process.env.DATABASE_PATH = ":memory:";
    resetDbForTests();
  });

  it("creates, lists, and stores moves", () => {
    const user = createUser("p@e.com", "h", "user", 5);
    const kid = createKid({ userId: user.id, name: "Aiden", chesscomUsername: "", lichessUsername: "" });

    const rep = createRepertoire(kid.id, "Italian", "white");
    expect(rep.color).toBe("white");
    expect(listRepertoires(kid.id)).toHaveLength(1);

    const move = addRepertoireMove(rep.id, "fen-before", "e2e4", "e4", "fen-after");
    expect(move.san).toBe("e4");
    const moves = getRepertoireMoves(rep.id);
    expect(moves).toHaveLength(1);
    expect(getRepertoire(rep.id)?.name).toBe("Italian");
  });

  it("keeps repertoires separate per kid", () => {
    const user = createUser("p@e.com", "h", "user", 5);
    const kidA = createKid({ userId: user.id, name: "A", chesscomUsername: "", lichessUsername: "" });
    const kidB = createKid({ userId: user.id, name: "B", chesscomUsername: "", lichessUsername: "" });

    createRepertoire(kidA.id, "A line", "white");
    expect(listRepertoires(kidA.id)).toHaveLength(1);
    expect(listRepertoires(kidB.id)).toHaveLength(0);
  });
});
