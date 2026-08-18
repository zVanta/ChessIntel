import { getDb, getUserById, recordFundingEvent, setUserCredits } from "./db";

export function getUserCredits(userId: number): number {
  return getUserById(userId)?.credits ?? 0;
}

export function grantCredits(userId: number, amount: number): number {
  const next = getUserCredits(userId) + amount;
  setUserCredits(userId, Math.max(0, next));
  return getUserCredits(userId);
}

/** Atomically spend one credit; returns false when the user has none left. */
export function consumeCredit(userId: number): boolean {
  const res = getDb()
    .prepare(`UPDATE users SET credits = credits - 1 WHERE id = ? AND credits > 0`)
    .run(userId);
  return res.changes > 0;
}

export function refundCredit(userId: number): void {
  grantCredits(userId, 1);
}

/**
 * Fund an account from a Stripe payment. Idempotent per invoice: the same
 * invoice is never credited twice, even if Stripe redelivers the webhook.
 */
export function grantFundingCredits(userId: number, invoiceId: string, amount: number): void {
  if (recordFundingEvent(invoiceId, userId, amount)) {
    grantCredits(userId, amount);
  }
}
