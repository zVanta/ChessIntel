import { NextResponse } from "next/server";
import { getUserById } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { getSessionUser } from "@/lib/auth";

/**
 * Opens the Stripe Billing Portal so a user can manage payment method, view
 * invoices, and cancel their subscription — without us building that UI.
 */
export async function POST() {
  const sessionUser = getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const user = getUserById(sessionUser.id);
  if (!user?.stripe_customer_id) {
    return NextResponse.json({ error: "No billing account yet." }, { status: 400 });
  }

  const origin = new URL(
    process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
  ).origin;

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${origin}/profile`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not open billing portal.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
