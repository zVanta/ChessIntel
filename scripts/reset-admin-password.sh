#!/usr/bin/env bash
# Reset (or create) the admin account's password. If the target email is taken
# by a different (non-admin) account, the admin's existing email is kept and the
# password is just reset.
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

const admin = db.prepare("SELECT id FROM users WHERE role = ? ORDER BY id LIMIT 1").get("admin");
if (!admin) {
  // No admin yet. If the email already exists as a regular user, promote it.
  const owner = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (owner) {
    db.prepare("UPDATE users SET role = ?, password_hash = ? WHERE id = ?")
      .run("admin", salt + ":" + hash, owner.id);
    console.log("Promoted existing user to admin: " + email);
  } else {
    db.prepare("INSERT INTO users (email, password_hash, role, credits) VALUES (?, ?, ?, ?)")
      .run(email, salt + ":" + hash, "admin", 999999);
    console.log("Admin created: " + email);
  }
} else {
  const clash = db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(email, admin.id);
  if (clash) {
    const current = db.prepare("SELECT email FROM users WHERE id = ?").get(admin.id);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(salt + ":" + hash, admin.id);
    console.log(
      "Admin password reset. Email kept as " + current.email +
      " (the requested email belongs to another account)."
    );
  } else {
    db.prepare("UPDATE users SET email = ?, password_hash = ? WHERE id = ?")
      .run(email, salt + ":" + hash, admin.id);
    console.log("Admin password reset and email updated to: " + email);
  }
}
' "$EMAIL" "$PASSWORD"
