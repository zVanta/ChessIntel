import Stripe from "stripe";

let client: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!client) client = new Stripe(key);
  return client;
}

export function getStripePriceId(): string {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) throw new Error("STRIPE_PRICE_ID is not set");
  return priceId;
}

/** Credits granted to an account each time its $20/mo plan is paid. */
export function getFundingCredits(): number {
  const raw = Number(process.env.FUNDING_CREDITS ?? 20);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 20;
}
