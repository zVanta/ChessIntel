import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getKidByStripeCustomer, setKidSubscription } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET is not set." }, { status: 500 });
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const kidId = Number(session.client_reference_id || session.metadata?.kidId);
      const customerId = typeof session.customer === "string" ? session.customer : null;
      if (Number.isInteger(kidId) && kidId > 0) {
        setKidSubscription(kidId, customerId, "active");
      }
      // Enforce the no-auto-renew business model: cancel the subscription at
      // the end of its first paid period.
      if (typeof session.subscription === "string") {
        await getStripe().subscriptions.update(session.subscription, {
          cancel_at_period_end: true,
        });
      }
      break;
    }
    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
      if (customerId) {
        const kid = getKidByStripeCustomer(customerId);
        if (kid) setKidSubscription(kid.id, customerId, "active");
      }
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = typeof subscription.customer === "string" ? subscription.customer : null;
      if (customerId) {
        const kid = getKidByStripeCustomer(customerId);
        if (kid) setKidSubscription(kid.id, customerId, "canceled");
      }
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
