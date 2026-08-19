import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { getDb, getKidHistory, resetDbForTests } from "../../lib/db";

describe("getKidHistory", () => {
  it("returns habits oldest-first with held status", () => {
    const file = path.join(
      os.tmpdir(),
      `cc-history-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    process.env.DATABASE_PATH = file;
    resetDbForTests();

    const db = getDb();
    const kidInfo = db.prepare(`INSERT INTO kids (name) VALUES (?)`).run("Kid");
    const kidId = Number(kidInfo.lastInsertRowid);

    const insertReport = (summary: string, habit: string, pointsLost: number) => {
      const info = db
        .prepare(
          `INSERT INTO reports (kid_id, summary_text, recurring_habit, drill, points_lost, json_payload)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(kidId, summary, habit, "drill", pointsLost, "{}");
      return Number(info.lastInsertRowid);
    };

    const r1 = insertReport("s1", "Hung pieces", 3.2);
    const r2 = insertReport("s2", "Fork awareness", 2.1);

    // The second report checked the first report's habit: it held.
    db.prepare(
      `INSERT INTO drill_followups (report_id, kid_id, later_report_id, held) VALUES (?, ?, ?, ?)`
    ).run(r1, kidId, r2, 1);

    const history = getKidHistory(kidId);
    expect(history).toEqual([
      { habit: "Hung pieces", points_lost: 3.2, held: true, date: expect.any(String) },
      { habit: "Fork awareness", points_lost: 2.1, held: null, date: expect.any(String) },
    ]);

    resetDbForTests();
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(file + suffix, { force: true });
    }
  });
});
