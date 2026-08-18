import { countReportsForKid, getKid } from "./db";

/**
 * Whether the paywall is active.
 *
 * `BILLING_ENABLED=false` forces everything free; `true` forces the paywall.
 * When unset, billing turns on automatically only when Stripe is configured.
 */
export function billingEnabled(): boolean {
  const override = process.env.BILLING_ENABLED;
  if (override === "false") return false;
  if (override === "true") return true;
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

/** A kid's first report is always free (no card). */
export function reportIsFree(kidId: number): boolean {
  return countReportsForKid(kidId) === 0;
}

export function hasActiveSubscription(kidId: number): boolean {
  const kid = getKid(kidId);
  return kid?.subscription_status === "active";
}

/** True when the kid may generate a report right now. */
export function canGenerateReport(kidId: number): boolean {
  if (!billingEnabled()) return true;
  return reportIsFree(kidId) || hasActiveSubscription(kidId);
}
