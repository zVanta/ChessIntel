import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { getDb, resetDbForTests } from "../../lib/db";

describe("migration from the pre-auth schema", () => {
  it("adds user_id, seeds admin, and adopts existing kids", () => {
    const file = path.join(
      os.tmpdir(),
      `cc-migrate-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    process.env.DATABASE_PATH = file;
    resetDbForTests();

    // Simulate the OLD schema (kids table with no user_id / profile columns).
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE kids (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        chesscom_username TEXT,
        lichess_username TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        stripe_customer_id TEXT,
        subscription_status TEXT NOT NULL DEFAULT 'none'
      );
      INSERT INTO kids (name) VALUES ('OldKid');
    `);
    raw.close();

    // Opening through getDb() runs the migration.
    const db = getDb();
    const cols = (db.prepare(`PRAGMA table_info(kids)`).all() as { name: string }[]).map(
      (c) => c.name
    );
    expect(cols).toContain("user_id");

    const admin = db.prepare(`SELECT * FROM users WHERE role = 'admin'`).get() as { id: number };
    expect(admin).toBeTruthy();
    const kid = db.prepare(`SELECT * FROM kids WHERE name = 'OldKid'`).get() as {
      user_id: number;
    };
    expect(kid.user_id).toBe(admin.id);

    resetDbForTests();
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(file + suffix, { force: true });
    }
  });
});
