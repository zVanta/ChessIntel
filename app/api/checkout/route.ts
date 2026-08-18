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

  let stripe: ReturnType<typeof getStripe>;
  let priceId: string;
  try {
    stripe = getStripe();
    priceId = getStripePriceId();
  } catch {
    return NextResponse.json(
      { error: "Billing is not configured yet. Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID." },
      { status: 503 }
    );
  }

  const origin = new URL(
    process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
  ).origin;

  try {
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout failed.";
    return NextResponse.json({ error: `Checkout could not be created: ${message}` }, { status: 502 });
  }
}
