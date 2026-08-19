import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

// Valid plan types for the new subscription system
const VALID_PLAN_TYPES = ["7day_pass", "premium", "family", "annual_family"];

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing Supabase URL or Service Role Key configuration");
      return new Response(
        JSON.stringify({ error: "Missing Supabase configuration" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      console.error("Missing STRIPE_SECRET_KEY environment variable");
      return new Response(
        JSON.stringify({ error: "Missing Stripe configuration" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const signature = req.headers.get("stripe-signature");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    const bodyText = await req.text();

    let event: Stripe.Event;

    if (webhookSecret && signature) {
      try {
        event = await stripe.webhooks.constructEventAsync(bodyText, signature, webhookSecret);
      } catch (err: any) {
        console.error(`Webhook signature verification failed: ${err.message}`);
        return new Response(
          JSON.stringify({ error: `Webhook signature verification failed: ${err.message}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      console.warn("Skipping Stripe signature verification (STRIPE_WEBHOOK_SECRET or signature missing)");
      event = JSON.parse(bodyText);
    }

    console.log(`Processing Stripe webhook event: ${event.type}`);

    // ── Helper: Extract period_end from subscription ──────────────────────
    const extractPeriodEnd = (subscription: Stripe.Subscription): string | null => {
      if (subscription.current_period_end) {
        return new Date(subscription.current_period_end * 1000).toISOString();
      }
      return null;
    };

    // ── Helper: Extract trial_end from subscription ──────────────────────
    const extractTrialEnd = (subscription: Stripe.Subscription): string | null => {
      if (subscription.trial_end) {
        return new Date(subscription.trial_end * 1000).toISOString();
      }
      return null;
    };

    // ── Helper: Determine billing period from price interval ─────────────
    const getBillingPeriod = (subscription: Stripe.Subscription): string => {
      const item = subscription.items?.data?.[0];
      if (item?.price?.recurring?.interval === "year") return "yearly";
      if (item?.price?.recurring?.interval === "week") return "weekly";
      return "monthly";
    };

    // ── Helper: Determine tier from price ID ─────────────────────────────
    const getTierFromPrice = (subscription: Stripe.Subscription): string | null => {
      const priceId = subscription.items?.data?.[0]?.price?.id;
      if (!priceId) return null;

      const envKeys = Deno.env.toObject();
      for (const [key, value] of Object.entries(envKeys)) {
        if (value === priceId) {
          if (key.includes("7DAY_PASS")) return "7day_pass";
          if (key.includes("PREMIUM")) return "premium";
          if (key.includes("ANNUAL_FAMILY") || key.includes("ENTERPRISE")) return "annual_family";
          if (key.includes("FAMILY") || key.includes("GROWTH")) return "family";
        }
      }
      return null;
    };

    // ── Handler: checkout.session.completed ──────────────────────────────
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log(`Checkout session completed: ${session.id}`);

      const parentId = session.metadata?.parentId || session.metadata?.parent_id;
      const tier = session.metadata?.tier || "premium";
      const billingPeriod = session.metadata?.billingPeriod || "monthly";
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;

      if (parentId && subscriptionId) {
        // Retrieve subscription from Stripe to get period end
        let currentPeriodEnd = null;
        let trialEnd = null;
        try {
          const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
          currentPeriodEnd = extractPeriodEnd(stripeSub);
          trialEnd = extractTrialEnd(stripeSub);
        } catch (e: any) {
          console.warn("Could not retrieve subscription details from Stripe:", e.message);
        }

        const { error: dbError } = await supabaseAdmin.from("subscriptions").upsert(
          {
            parent_id: parentId,
            stripe_subscription_id: subscriptionId,
            stripe_customer_id: customerId,
            tier: tier,
            billing_period: billingPeriod,
            status: trialEnd ? "trialing" : "active",
            current_period_end: currentPeriodEnd,
            cancel_at_period_end: stripeSub ? stripeSub.cancel_at_period_end : false,
            trial_end: trialEnd,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "stripe_subscription_id" }
        );

        if (dbError) {
          console.error("Error saving subscription on checkout completed:", dbError);
        } else {
          console.log(`Saved subscription ${subscriptionId} for parent ${parentId} (${tier}/${billingPeriod})`);
        }
      }
    }

    // ── Handler: customer.subscription.created / updated ─────────────────
    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
      const subscription = event.data.object as Stripe.Subscription;
      console.log(`Subscription event [${event.type}] for subscription ID: ${subscription.id}`);

      // Retrieve parentId from subscription metadata or database
      let parentId = subscription.metadata?.parentId || subscription.metadata?.parent_id;

      if (!parentId) {
        console.log(`parentId not found in subscription metadata. Querying subscriptions table for ${subscription.id}...`);
        const { data: existingSub } = await supabaseAdmin
          .from("subscriptions")
          .select("parent_id")
          .eq("stripe_subscription_id", subscription.id)
          .maybeSingle();

        if (existingSub?.parent_id) {
          parentId = existingSub.parent_id;
        }
      }

      if (!parentId) {
        console.warn(`No parentId found for subscription ${subscription.id}.`);
        return new Response(
          JSON.stringify({ received: true, warning: "No parentId found for subscription" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
      const tier = getTierFromPrice(subscription) || subscription.metadata?.tier || "premium";
      const billingPeriod = getBillingPeriod(subscription);
      const currentPeriodEnd = extractPeriodEnd(subscription);
      const trialEnd = extractTrialEnd(subscription);

      // Count actual active learners linked to this parent_id
      let currentLearnerCount = 0;
      const { count: learnersCount, error: learnersErr } = await supabaseAdmin
        .from("learners")
        .select("*", { count: "exact", head: true })
        .eq("parent_id", parentId);

      if (learnersErr) {
        const { count: childrenCount, error: childrenErr } = await supabaseAdmin
          .from("children")
          .select("*", { count: "exact", head: true })
          .eq("parent_id", parentId);

        if (!childrenErr) {
          currentLearnerCount = childrenCount ?? 0;
        }
      } else {
        currentLearnerCount = learnersCount ?? 0;
      }

      // Update Supabase subscriptions table
      const { error: dbError } = await supabaseAdmin.from("subscriptions").upsert(
        {
          parent_id: parentId,
          stripe_subscription_id: subscription.id,
          stripe_customer_id: customerId,
          tier: tier,
          billing_period: billingPeriod,
          learner_count: currentLearnerCount,
          status: subscription.status,
          current_period_end: currentPeriodEnd,
          cancel_at_period_end: subscription.cancel_at_period_end,
          trial_end: trialEnd,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "stripe_subscription_id" }
      );

      if (dbError) {
        console.error("Error updating 'subscriptions' table in Supabase:", dbError);
      } else {
        console.log(`Updated subscription for parent ${parentId}: tier=${tier}, status=${subscription.status}`);
      }
    }

    // ── Handler: customer.subscription.deleted ───────────────────────────
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      console.log(`Subscription deleted: ${subscription.id}`);

      const { error: dbError } = await supabaseAdmin
        .from("subscriptions")
        .update({ status: "canceled", updated_at: new Date().toISOString() })
        .eq("stripe_subscription_id", subscription.id);

      if (dbError) {
        console.error("Error marking subscription as canceled:", dbError);
      }
    }

    // ── Handler: invoice.payment_failed ──────────────────────────────────
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;

      if (subscriptionId) {
        console.log(`Payment failed for subscription: ${subscriptionId}`);

        const { error: dbError } = await supabaseAdmin
          .from("subscriptions")
          .update({ status: "past_due", updated_at: new Date().toISOString() })
          .eq("stripe_subscription_id", subscriptionId);

        if (dbError) {
          console.error("Error marking subscription as past_due:", dbError);
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Unhandled error in stripe-webhook Edge Function:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
