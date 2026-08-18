import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  getKidByStripeCustomer,
  getUserByStripeCustomer,
  setKidSubscription,
  setUserSubscription,
} from "@/lib/db";
import { getFundingCredits, getStripe } from "@/lib/stripe";
import { grantFundingCredits } from "@/lib/credits";

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
      const customerId = typeof session.customer === "string" ? session.customer : null;
      if (session.metadata?.type === "fund") {
        // Account-funding checkout: link the user to their Stripe customer and
        // mark the subscription active. Credits are granted on the invoice.
        const userId = Number(session.metadata.userId);
        if (Number.isInteger(userId) && userId > 0) {
          setUserSubscription(userId, customerId, "active");
        }
      } else {
        // Legacy per-kid checkout (kept for existing customers).
        const kidId = Number(session.client_reference_id || session.metadata?.kidId);
        if (Number.isInteger(kidId) && kidId > 0) {
          setKidSubscription(kidId, customerId, "active");
        }
        if (typeof session.subscription === "string") {
          await getStripe().subscriptions.update(session.subscription, {
            cancel_at_period_end: true,
          });
        }
      }
      break;
    }
    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
      const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : null;

      // 1) Account-funding plan: credit the user once per paid invoice.
      const fundUserId = await resolveFundUserId(subscriptionId, customerId);
      if (fundUserId) {
        grantFundingCredits(fundUserId, invoice.id, getFundingCredits());
      }

      // 2) Legacy per-kid plan.
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
        const user = getUserByStripeCustomer(customerId);
        if (user) setUserSubscription(user.id, customerId, "canceled");
        const kid = getKidByStripeCustomer(customerId);
        if (kid) setKidSubscription(kid.id, customerId, "canceled");
      }
      break;
    }
    case "invoice.payment_failed":
    case "invoice.payment_action_required": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
      if (customerId) {
        const user = getUserByStripeCustomer(customerId);
        if (user) setUserSubscription(user.id, customerId, "past_due");
      }
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}

/**
 * Resolve which user a paid invoice belongs to. Tries the linked customer
 * first, then the subscription metadata (which is always set at checkout), so
 * ordering between `checkout.session.completed` and `invoice.payment_succeeded`
 * never causes a missed or duplicated grant.
 */
async function resolveFundUserId(
  subscriptionId: string | null,
  customerId: string | null
): Promise<number | null> {
  if (customerId) {
    const byCustomer = getUserByStripeCustomer(customerId);
    if (byCustomer) return byCustomer.id;
  }
  if (subscriptionId) {
    try {
      const sub = await getStripe().subscriptions.retrieve(subscriptionId);
      const userId = Number(sub.metadata?.userId);
      if (Number.isInteger(userId) && userId > 0) return userId;
    } catch {
      // ignore — fall through to null
    }
  }
  return null;
}
