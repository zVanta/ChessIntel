import { NextResponse } from "next/server";
import { getKid } from "@/lib/db";
import { getStripe, getStripePriceId } from "@/lib/stripe";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const input = (body ?? {}) as Record<string, unknown>;

  const kidId = Number(input.kidId);
  if (!Number.isInteger(kidId) || kidId <= 0) {
    return NextResponse.json({ error: "kidId is required." }, { status: 400 });
  }
  const kid = getKid(kidId);
  if (!kid) {
    return NextResponse.json({ error: "Kid not found." }, { status: 404 });
  }

  const stripe = getStripe();
  const priceId = getStripePriceId();
  const origin = new URL(req.url).origin;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    // The current Stripe API handles incomplete first payments (e.g. SCA)
    // automatically; the webhook marks the kid active on success.
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: String(kid.id),
    metadata: { kidId: String(kid.id), kidName: kid.name },
    subscription_data: {
      // Business model: $15/month with NO auto-renew. The webhook sets
      // cancel_at_period_end=true once the subscription exists, so it will not
      // renew after the first paid period.
      metadata: { kidId: String(kid.id) },
    },
    success_url: `${origin}/dashboard?checkout=success&kid=${kid.id}`,
    cancel_url: `${origin}/dashboard?checkout=canceled`,
  });

  return NextResponse.json({ url: session.url });
}
