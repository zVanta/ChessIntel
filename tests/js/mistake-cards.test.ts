import { beforeEach, describe, expect, it } from "vitest";
import {
  createKid,
  createMistakeCards,
  createReport,
  createUser,
  getDueMistakeCards,
  resetDbForTests,
  reviewMistakeCard,
} from "../../lib/db";

describe("mistake cards (spaced repetition)", () => {
  beforeEach(() => {
    process.env.DATABASE_PATH = ":memory:";
    resetDbForTests();
  });

  function seedKid() {
    const user = createUser("parent@example.com", "hash", "user", 5);
    const kid = createKid({ userId: user.id, name: "Aiden", chesscomUsername: "", lichessUsername: "" });
    const report = createReport(kid.id, "summary", "Fork awareness", "drill", 3.2, "{}");
    return { kid, report };
  }

  it("creates cards due immediately and reschedules on review", () => {
    const { kid, report } = seedKid();
    createMistakeCards(kid.id, report.id, [
      { fen: "fen1", san: "Qe6", best: "Qb8", color: "black", cp_loss: 310, concept: "Fork awareness", threat_detail: "allowed a fork" },
    ]);

    const due = getDueMistakeCards(kid.id);
    expect(due).toHaveLength(1);
    expect(due[0].repetitions).toBe(0);

    // A correct answer pushes the card out of the due queue for 1 day.
    const afterCorrect = reviewMistakeCard(due[0].id, true)!;
    expect(afterCorrect.repetitions).toBe(1);
    expect(afterCorrect.interval_days).toBe(1);
    expect(afterCorrect.due_at).toBeGreaterThan(Date.now());
    expect(getDueMistakeCards(kid.id)).toHaveLength(0);
  });

  it("a lapse resets the interval and increments the lapse counter", () => {
    const { kid, report } = seedKid();
    createMistakeCards(kid.id, report.id, [
      { fen: "fen2", san: "Nd4", best: "Nxe6", color: "white", cp_loss: 480, concept: "Piece safety", threat_detail: null },
    ]);
    const due = getDueMistakeCards(kid.id);
    const afterWrong = reviewMistakeCard(due[0].id, false)!;
    expect(afterWrong.repetitions).toBe(0);
    expect(afterWrong.lapses).toBe(1);
    expect(afterWrong.interval_days).toBe(1);
    expect(afterWrong.due_at).toBeGreaterThan(Date.now());
  });

  it("correct reviews back off exponentially", () => {
    const { kid, report } = seedKid();
    createMistakeCards(kid.id, report.id, [
      { fen: "fen3", san: "Qd8", best: "Nh6", color: "black", cp_loss: 900, concept: "Hung pieces", threat_detail: "left a queen hanging" },
    ]);
    let card = getDueMistakeCards(kid.id)[0];
    card = reviewMistakeCard(card.id, true)!;
    expect(card.interval_days).toBe(1);
    card = reviewMistakeCard(card.id, true)!;
    expect(card.interval_days).toBe(2);
    card = reviewMistakeCard(card.id, true)!;
    expect(card.interval_days).toBe(4);
  });
});
