import { countReportsForKid, getKid } from "./db";

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
  return reportIsFree(kidId) || hasActiveSubscription(kidId);
}
