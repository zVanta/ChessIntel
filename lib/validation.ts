/**
 * Username validation shared by the API and tests.
 *
 * Lichess and chess.com both restrict usernames to a conservative subset of
 * characters; we accept letters, digits, underscores and hyphens, 2-25 chars.
 * This rejects spaces, punctuation, emails and URLs.
 */
export function isValidUsername(username: string): boolean {
  return /^[a-zA-Z0-9_-]{2,25}$/.test(username);
}

export function validateKidInput(input: {
  name?: unknown;
  chesscomUsername?: unknown;
  lichessUsername?: unknown;
}): { ok: true } | { ok: false; error: string } {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required." };
  if (name.length > 80) return { ok: false, error: "Name must be 80 characters or fewer." };

  const chesscom = typeof input.chesscomUsername === "string" ? input.chesscomUsername.trim() : "";
  const lichess = typeof input.lichessUsername === "string" ? input.lichessUsername.trim() : "";

  if (!chesscom && !lichess) {
    return { ok: false, error: "At least one username (chess.com or Lichess) is required." };
  }
  if (chesscom && !isValidUsername(chesscom)) {
    return { ok: false, error: "chess.com username contains invalid characters." };
  }
  if (lichess && !isValidUsername(lichess)) {
    return { ok: false, error: "Lichess username contains invalid characters." };
  }
  return { ok: true };
}
