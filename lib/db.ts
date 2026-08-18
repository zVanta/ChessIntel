import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { hashPassword } from "./password";
import type {
  DrillFollowup,
  GameRow,
  GameWithReport,
  Kid,
  KidWithMeta,
  ProgressRow,
  Report,
  User,
} from "./types";

let _db: Database.Database | null = null;
let _dbPath: string | null = null;

function resolveDbPath(): string {
  const configured = process.env.DATABASE_PATH;
  if (configured && configured !== "") return configured;
  const dir = path.join(process.cwd(), "data");
  return path.join(dir, "chess.db");
}

function ensureColumn(db: Database.Database, table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      credits INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      age TEXT,
      uscf_rating TEXT,
      fide_rating TEXT,
      online_rating TEXT,
      chesscom_username TEXT,
      lichess_username TEXT,
      focus_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      stripe_customer_id TEXT,
      subscription_status TEXT NOT NULL DEFAULT 'none'
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kid_id INTEGER NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      summary_text TEXT NOT NULL,
      recurring_habit TEXT NOT NULL,
      drill TEXT NOT NULL,
      points_lost REAL NOT NULL,
      json_payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      external_id TEXT,
      pgn TEXT NOT NULL,
      analyzed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS drill_followups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      kid_id INTEGER NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
      later_report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      held INTEGER NOT NULL,
      checked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_reports_kid ON reports(kid_id);
    CREATE INDEX IF NOT EXISTS idx_games_report ON games(report_id);
    CREATE INDEX IF NOT EXISTS idx_followups_kid ON drill_followups(kid_id);
  `);

  // Idempotent column additions for older databases. Must run BEFORE creating
  // any index that references the new columns.
  ensureColumn(db, "kids", "user_id", "INTEGER");
  ensureColumn(db, "kids", "age", "TEXT");
  ensureColumn(db, "kids", "uscf_rating", "TEXT");
  ensureColumn(db, "kids", "fide_rating", "TEXT");
  ensureColumn(db, "kids", "online_rating", "TEXT");
  ensureColumn(db, "kids", "focus_notes", "TEXT");
  ensureColumn(db, "kids", "stripe_customer_id", "TEXT");
  ensureColumn(db, "kids", "subscription_status", "TEXT NOT NULL DEFAULT 'none'");

  db.exec(`CREATE INDEX IF NOT EXISTS idx_kids_user ON kids(user_id);`);

  seedAdmin(db);
}

function seedAdmin(db: Database.Database): void {
  const existing = db
    .prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`)
    .get() as { id: number } | undefined;
  if (existing) return;

  const email = process.env.ADMIN_EMAIL || "admin@checkmatecoach.app";
  const password = process.env.ADMIN_PASSWORD || "4fc4c8604a6348b7aa84d0285f3920e3";
  const hash = hashPassword(password);
  const info = db
    .prepare(`INSERT INTO users (email, password_hash, role, credits) VALUES (?, ?, 'admin', 999999)`)
    .run(email, hash);
  const adminId = Number(info.lastInsertRowid);

  // Adopt any pre-existing kids that don't belong to a user yet.
  db.prepare(`UPDATE kids SET user_id = ? WHERE user_id IS NULL`).run(adminId);
}

export function getDb(): Database.Database {
  const target = resolveDbPath();
  if (_db && _dbPath === target) return _db;
  if (_db) {
    try {
      _db.close();
    } catch {
      // ignore
    }
    _db = null;
  }
  if (target !== ":memory:") {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  _db = new Database(target);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  _dbPath = target;
  return _db;
}

/** Close the cached connection. Useful for tests that swap DATABASE_PATH. */
export function resetDbForTests(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      // ignore
    }
    _db = null;
    _dbPath = null;
  }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export function createUser(email: string, passwordHash: string, role = "user", credits = 1): User {
  const info = getDb()
    .prepare(`INSERT INTO users (email, password_hash, role, credits) VALUES (?, ?, ?, ?)`)
    .run(email.toLowerCase().trim(), passwordHash, role, credits);
  return getUserById(Number(info.lastInsertRowid)) as User;
}

export function getUserByEmail(email: string): User | undefined {
  return getDb()
    .prepare(`SELECT * FROM users WHERE email = ?`)
    .get(email.toLowerCase().trim()) as User | undefined;
}

export function getUserById(id: number): User | undefined {
  return getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(id) as User | undefined;
}

export function listUsers(): User[] {
  return getDb().prepare(`SELECT * FROM users ORDER BY created_at ASC, id ASC`).all() as User[];
}

export function updateUserRole(userId: number, role: string): void {
  getDb().prepare(`UPDATE users SET role = ? WHERE id = ?`).run(role, userId);
}

export function setUserCredits(userId: number, credits: number): void {
  getDb()
    .prepare(`UPDATE users SET credits = ? WHERE id = ?`)
    .run(Math.max(0, Math.floor(credits)), userId);
}

export function deleteUser(userId: number): void {
  getDb().prepare(`DELETE FROM users WHERE id = ?`).run(userId);
}

// ---------------------------------------------------------------------------
// Kids
// ---------------------------------------------------------------------------

export interface CreateKidInput {
  name: string;
  chesscomUsername: string | null;
  lichessUsername: string | null;
  userId: number;
  age?: string | null;
  uscfRating?: string | null;
  fideRating?: string | null;
  onlineRating?: string | null;
  focusNotes?: string | null;
}

export function createKid(input: CreateKidInput): Kid {
  const info = getDb()
    .prepare(
      `INSERT INTO kids
         (user_id, name, age, uscf_rating, fide_rating, online_rating,
          chesscom_username, lichess_username, focus_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.userId,
      input.name,
      input.age || null,
      input.uscfRating || null,
      input.fideRating || null,
      input.onlineRating || null,
      input.chesscomUsername || null,
      input.lichessUsername || null,
      input.focusNotes || null
    );
  return getKid(Number(info.lastInsertRowid)) as Kid;
}

export function updateKid(
  id: number,
  fields: Partial<{
    name: string;
    age: string | null;
    uscf_rating: string | null;
    fide_rating: string | null;
    online_rating: string | null;
    chesscom_username: string | null;
    lichess_username: string | null;
    focus_notes: string | null;
  }>
): void {
  const columns = Object.keys(fields);
  if (columns.length === 0) return;
  const assignments = columns.map((c) => `${c} = ?`).join(", ");
  const values = columns.map((c) => (fields as Record<string, unknown>)[c]);
  getDb()
    .prepare(`UPDATE kids SET ${assignments} WHERE id = ?`)
    .run(...values, id);
}

export function deleteKid(id: number): void {
  getDb().prepare(`DELETE FROM kids WHERE id = ?`).run(id);
}

export function getKid(id: number): Kid | undefined {
  return getDb().prepare(`SELECT * FROM kids WHERE id = ?`).get(id) as Kid | undefined;
}

export function listKids(userId?: number): Kid[] {
  if (userId == null) {
    return getDb().prepare(`SELECT * FROM kids ORDER BY created_at DESC`).all() as Kid[];
  }
  return getDb()
    .prepare(`SELECT * FROM kids WHERE user_id = ? ORDER BY created_at DESC`)
    .all(userId) as Kid[];
}

export function getKidsWithMeta(userId?: number): KidWithMeta[] {
  const where = userId == null ? "" : "WHERE k.user_id = ?";
  const params = userId == null ? [] : [userId];
  return getDb()
    .prepare(
      `SELECT k.*,
              (SELECT COUNT(*) FROM reports r WHERE r.kid_id = k.id) AS reports_count,
              (SELECT MAX(r.created_at) FROM reports r WHERE r.kid_id = k.id) AS latest_report_at,
              (SELECT r.recurring_habit FROM reports r
                 WHERE r.kid_id = k.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS tracked_habit
       FROM kids k
       ${where}
       ORDER BY k.created_at DESC`
    )
    .all(...params) as KidWithMeta[];
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function createReport(
  kidId: number,
  summaryText: string,
  recurringHabit: string,
  drill: string,
  pointsLost: number,
  jsonPayload: string
): Report {
  const info = getDb()
    .prepare(
      `INSERT INTO reports (kid_id, summary_text, recurring_habit, drill, points_lost, json_payload)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(kidId, summaryText, recurringHabit, drill, pointsLost, jsonPayload);
  return getReport(Number(info.lastInsertRowid)) as Report;
}

export function getReport(id: number): Report | undefined {
  return getDb().prepare(`SELECT * FROM reports WHERE id = ?`).get(id) as Report | undefined;
}

export function getReportsForKid(kidId: number): Report[] {
  return getDb()
    .prepare(`SELECT * FROM reports WHERE kid_id = ? ORDER BY created_at DESC, id DESC`)
    .all(kidId) as Report[];
}

export function getLatestReportForKid(kidId: number): Report | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM reports WHERE kid_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`
    )
    .get(kidId) as Report | undefined;
}

export function countReportsForKid(kidId: number): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM reports WHERE kid_id = ?`)
    .get(kidId) as { n: number };
  return row.n;
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export function createGame(
  reportId: number,
  source: string,
  externalId: string | null,
  pgn: string
): GameRow {
  const info = getDb()
    .prepare(
      `INSERT INTO games (report_id, source, external_id, pgn)
       VALUES (?, ?, ?, ?)`
    )
    .run(reportId, source, externalId || null, pgn);
  return getDb().prepare(`SELECT * FROM games WHERE id = ?`).get(Number(info.lastInsertRowid)) as GameRow;
}

export function getGame(id: number): GameWithReport | undefined {
  return getDb()
    .prepare(
      `SELECT g.*, r.kid_id AS kid_id, r.recurring_habit AS recurring_habit
       FROM games g
       JOIN reports r ON r.id = g.report_id
       WHERE g.id = ?`
    )
    .get(id) as GameWithReport | undefined;
}

// ---------------------------------------------------------------------------
// Drill follow-ups ("memory" loop)
// ---------------------------------------------------------------------------

export function createDrillFollowup(
  reportId: number,
  kidId: number,
  laterReportId: number,
  held: boolean
): DrillFollowup {
  const info = getDb()
    .prepare(
      `INSERT INTO drill_followups (report_id, kid_id, later_report_id, held)
       VALUES (?, ?, ?, ?)`
    )
    .run(reportId, kidId, laterReportId, held ? 1 : 0);
  return getDb()
    .prepare(`SELECT * FROM drill_followups WHERE id = ?`)
    .get(Number(info.lastInsertRowid)) as DrillFollowup;
}

export function getFollowupsForKid(kidId: number): DrillFollowup[] {
  const rows = getDb()
    .prepare(`SELECT * FROM drill_followups WHERE kid_id = ? ORDER BY checked_at DESC, id DESC`)
    .all(kidId) as (Omit<DrillFollowup, "held"> & { held: number })[];
  return rows.map((r) => ({ ...r, held: r.held === 1 }));
}

export function getProgressForKid(kidId: number): ProgressRow[] {
  const reports = getReportsForKid(kidId);
  const followups = getFollowupsForKid(kidId);
  return reports.map((report) => ({
    report,
    followups: followups.filter((f) => f.later_report_id === report.id || f.report_id === report.id),
  }));
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export function setKidSubscription(
  kidId: number,
  customerId: string | null,
  status: string
): void {
  getDb()
    .prepare(
      `UPDATE kids SET stripe_customer_id = COALESCE(?, stripe_customer_id), subscription_status = ? WHERE id = ?`
    )
    .run(customerId, status, kidId);
}

export function getKidByStripeCustomer(customerId: string): Kid | undefined {
  return getDb()
    .prepare(`SELECT * FROM kids WHERE stripe_customer_id = ?`)
    .get(customerId) as Kid | undefined;
}
