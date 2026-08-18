import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

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

    // Map tier prices from environment variables
    const priceStarter = Deno.env.get("STRIPE_PRICE_ID_STARTER") || Deno.env.get("STRIPE_PRICE_STARTER");
    const priceGrowth = Deno.env.get("STRIPE_PRICE_ID_GROWTH") || Deno.env.get("STRIPE_PRICE_GROWTH");
    const priceEnterprise = Deno.env.get("STRIPE_PRICE_ID_ENTERPRISE") || Deno.env.get("STRIPE_PRICE_ENTERPRISE");

    const priceMap: Record<string, string | undefined> = {
      starter: priceStarter,
      growth: priceGrowth,
      enterprise: priceEnterprise,
    };

    // Handler for customer.subscription.updated & customer.subscription.created
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
        console.warn(`No parentId found for subscription ${subscription.id}. Unable to update quantity/tier.`);
        return new Response(
          JSON.stringify({ received: true, warning: "No parentId found for subscription" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 1. Count actual active learners linked to this parent_id
      let currentLearnerCount = 0;
      const { count: learnersCount, error: learnersErr } = await supabaseAdmin
        .from("learners")
        .select("*", { count: "exact", head: true })
        .eq("parent_id", parentId);

      if (learnersErr) {
        console.warn("Could not query 'learners' table, trying fallback to 'children' table:", learnersErr.message);
        const { count: childrenCount, error: childrenErr } = await supabaseAdmin
          .from("children")
          .select("*", { count: "exact", head: true })
          .eq("parent_id", parentId);

        if (childrenErr) {
          console.error("Error querying learner count for parent:", childrenErr);
        } else {
          currentLearnerCount = childrenCount ?? 0;
        }
      } else {
        currentLearnerCount = learnersCount ?? 0;
      }

      console.log(`Parent ID: ${parentId}, Active learners count: ${currentLearnerCount}`);

      // 2. Determine target tier based on current active learner count
      // - starter: <= 20
      // - growth: 21 to 50
      // - enterprise: > 50
      let targetTier = "starter";
      if (currentLearnerCount > 50) {
        targetTier = "enterprise";
      } else if (currentLearnerCount > 20) {
        targetTier = "growth";
      }

      const targetPriceId = priceMap[targetTier];
      const subItem = subscription.items?.data?.[0];

      if (subItem) {
        const currentPriceId = subItem.price?.id;
        const currentQuantity = subItem.quantity;

        const isPriceChangeNeeded = Boolean(targetPriceId && currentPriceId !== targetPriceId);
        const targetQuantity = currentLearnerCount > 0 ? currentLearnerCount : 1;
        const isQuantityChangeNeeded = currentQuantity !== targetQuantity;

        if (isPriceChangeNeeded || isQuantityChangeNeeded) {
          console.log(
            `Updating subscription item ${subItem.id}: currentPrice=${currentPriceId}, targetPrice=${targetPriceId}, currentQty=${currentQuantity}, targetQty=${targetQuantity}, targetTier=${targetTier}`
          );

          // Update subscription item on Stripe with proration
          const updateParams: Stripe.SubscriptionItemUpdateParams = {
            proration_behavior: "always_invoice",
          };

          if (isPriceChangeNeeded && targetPriceId) {
            updateParams.price = targetPriceId;
          }

          if (isQuantityChangeNeeded || isPriceChangeNeeded) {
            updateParams.quantity = targetQuantity;
          }

          await stripe.subscriptionItems.update(subItem.id, updateParams);

          // Update metadata on subscription in Stripe
          await stripe.subscriptions.update(subscription.id, {
            metadata: {
              ...subscription.metadata,
              parentId: String(parentId),
              tier: targetTier,
              learnerCount: String(currentLearnerCount),
            },
          });

          console.log(`Successfully updated subscription ${subscription.id} on Stripe (tier: ${targetTier}, qty: ${targetQuantity})`);
        } else {
          console.log(`Subscription ${subscription.id} is already up to date (tier: ${targetTier}, qty: ${currentQuantity})`);
        }
      }

      // 3. Update Supabase 'subscriptions' table with new tier and learner_count
      const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;

      const { error: dbError } = await supabaseAdmin.from("subscriptions").upsert(
        {
          parent_id: parentId,
          stripe_subscription_id: subscription.id,
          stripe_customer_id: customerId,
          tier: targetTier,
          learner_count: currentLearnerCount,
          status: subscription.status,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "stripe_subscription_id" }
      );

      if (dbError) {
        console.error("Error updating 'subscriptions' table in Supabase:", dbError);
      } else {
        console.log(`Successfully updated 'subscriptions' table in Supabase for parent ${parentId}`);
      }
    }

    // Handler for checkout.session.completed
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log(`Checkout session completed: ${session.id}`);

      const parentId = session.metadata?.parentId || session.metadata?.parent_id;
      const tier = session.metadata?.tier || "starter";
      const learnerCount = session.metadata?.learnerCount ? parseInt(session.metadata.learnerCount, 10) : 1;
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;

      if (parentId && subscriptionId) {
        const { error: dbError } = await supabaseAdmin.from("subscriptions").upsert(
          {
            parent_id: parentId,
            stripe_subscription_id: subscriptionId,
            stripe_customer_id: customerId,
            tier: tier,
            learner_count: learnerCount,
            status: "active",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "stripe_subscription_id" }
        );

        if (dbError) {
          console.error("Error saving subscription on checkout completed:", dbError);
        } else {
          console.log(`Saved subscription ${subscriptionId} for parent ${parentId} on checkout.session.completed`);
        }
      }
    }

    // Handler for customer.subscription.deleted
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
