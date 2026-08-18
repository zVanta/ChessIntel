#!/usr/bin/env bash
# Reset (or create) the admin account's email + password in the SQLite DB.
#
# Usage:
#   bash scripts/reset-admin-password.sh <email> <new-password>
#
# Example:
#   bash scripts/reset-admin-password.sh admin@checkmatecoach.app 'a-strong-password'
set -euo pipefail

EMAIL="${1:-admin@checkmatecoach.app}"
PASSWORD="${2:?Usage: reset-admin-password.sh <email> <new-password>}"

docker compose exec web node -e '
const crypto = require("crypto");
const Database = require("better-sqlite3");
const db = new Database("/data/chess.db");
const [email, pw] = process.argv.slice(1);
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
const existing = db.prepare("SELECT id FROM users WHERE role = ?").get("admin");
if (existing) {
  db.prepare("UPDATE users SET email = ?, password_hash = ? WHERE id = ?")
    .run(email, salt + ":" + hash, existing.id);
  console.log("Admin password updated.");
} else {
  db.prepare("INSERT INTO users (email, password_hash, role, credits) VALUES (?, ?, ?, ?)")
    .run(email, salt + ":" + hash, "admin", 999999);
  console.log("Admin created.");
}
' "$EMAIL" "$PASSWORD"
