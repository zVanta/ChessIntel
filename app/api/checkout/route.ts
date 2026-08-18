import { NextResponse } from "next/server";
import { getStripe, getStripePriceId, getFundingCredits } from "@/lib/stripe";
import { getSessionUser } from "@/lib/auth";

/**
 * Starts a checkout to fund the signed-in user's account. Each paid month of
 * the $20/mo plan adds `FUNDING_CREDITS` (default 20) report credits to their
 * account — the webhook does the actual crediting.
 */
export async function POST() {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const stripe = getStripe();
  const priceId = getStripePriceId();
  const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").origin;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: `user:${user.id}`,
    metadata: { type: "fund", userId: String(user.id) },
    subscription_data: {
      metadata: { type: "fund", userId: String(user.id) },
    },
    success_url: `${origin}/profile?funding=success`,
    cancel_url: `${origin}/profile?funding=canceled`,
  });

  return NextResponse.json({ url: session.url, creditsPerMonth: getFundingCredits() });
}
