import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Tier limits definition
const TIER_LIMITS: Record<string, { max: number; label: string }> = {
  starter: { max: 20, label: "Starter (max 20 learners)" },
  growth: { max: 50, label: "Growth (max 50 learners)" },
  enterprise: { max: Infinity, label: "Enterprise (unlimited)" },
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
      console.error("Missing Supabase configuration");
      return new Response(
        JSON.stringify({ error: "Missing Supabase URL or Service Role Key configuration" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      console.error("Missing STRIPE_SECRET_KEY environment variable");
      return new Response(
        JSON.stringify({ error: "Missing STRIPE_SECRET_KEY configuration" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Stripe client
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Initialize Supabase Admin Client
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Parse request body
    const body = await req.json().catch(() => ({}));
    console.log("Create checkout session payload:", body);

    const parentId = body.parentId || body.parent_id;
    const tierRaw = body.tier;

    // Validate required parameters
    if (!parentId) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter: parentId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!tierRaw || typeof tierRaw !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing or invalid required parameter: tier ('starter' | 'growth' | 'enterprise')" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tier = tierRaw.toLowerCase().trim();
    if (!TIER_LIMITS[tier]) {
      return new Response(
        JSON.stringify({
          error: `Invalid tier '${tierRaw}'. Must be one of: 'starter', 'growth', 'enterprise'`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Count active learners for this parent_id
    // Querying 'learners' table directly as specified: SELECT count(*) FROM learners WHERE parent_id = $1
    let learnerCount = 0;

    const { count: learnersCount, error: learnersErr } = await supabaseAdmin
      .from("learners")
      .select("*", { count: "exact", head: true })
      .eq("parent_id", parentId);

    if (learnersErr) {
      console.warn("Could not query 'learners' table, trying fallback to 'children' table:", learnersErr.message);
      // Fallback query to 'children' table if 'learners' table/view is not present
      const { count: childrenCount, error: childrenErr } = await supabaseAdmin
        .from("children")
        .select("*", { count: "exact", head: true })
        .eq("parent_id", parentId);

      if (childrenErr) {
        console.error("Error querying learner count:", childrenErr);
        return new Response(
          JSON.stringify({ error: "Failed to fetch active learners count for parentId", details: childrenErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      learnerCount = childrenCount ?? 0;
    } else {
      learnerCount = learnersCount ?? 0;
    }

    console.log(`Parent ID: ${parentId}, Tier requested: ${tier}, Active learners count: ${learnerCount}`);

    // 2. Validate tier limits against learner count
    const tierLimit = TIER_LIMITS[tier];
    if (learnerCount > tierLimit.max) {
      console.warn(`Tier limit exceeded: Tier '${tier}' allows max ${tierLimit.max}, but parent has ${learnerCount} active learners.`);
      return new Response(
        JSON.stringify({
          error: "tier_exceeded",
          message: `The requested tier '${tier}' allows up to ${tierLimit.max} active learners, but parent has ${learnerCount} active learners.`,
          learnerCount: learnerCount,
          tier: tier,
          maxAllowed: tierLimit.max,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Resolve Price ID for the tier
    const envPriceKey = `STRIPE_PRICE_ID_${tier.toUpperCase()}`;
    const priceId = Deno.env.get(envPriceKey) || Deno.env.get(`STRIPE_PRICE_${tier.toUpperCase()}`) || body.priceId;

    if (!priceId) {
      console.error(`Missing Stripe price configuration for tier '${tier}'. Environment variable ${envPriceKey} is not set.`);
      return new Response(
        JSON.stringify({
          error: "missing_price_config",
          message: `Stripe Price ID for tier '${tier}' is not configured. Please set ${envPriceKey} in environment variables.`,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine return URLs
    const origin = req.headers.get("origin") || req.headers.get("referer");
    const clientUrl = Deno.env.get("CLIENT_URL") || Deno.env.get("SITE_URL") || (origin ? new URL(origin).origin : "http://localhost:3000");

    // Quantity must be at least 1 for Stripe checkout line items
    const lineItemQuantity = learnerCount > 0 ? learnerCount : 1;

    // 4. Create Stripe Checkout Session in "subscription" mode
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [
        {
          price: priceId,
          quantity: lineItemQuantity,
        },
      ],
      metadata: {
        parentId: String(parentId),
        tier: tier,
        learnerCount: String(learnerCount),
      },
      success_url: `${clientUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl}/checkout/cancel`,
    });

    console.log(`Checkout session created successfully. Session ID: ${session.id}, URL: ${session.url}`);

    // 5. Return checkout URL
    return new Response(
      JSON.stringify({
        url: session.url,
        sessionId: session.id,
        tier: tier,
        learnerCount: learnerCount,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("Unhandled error in create-checkout-session Edge Function:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
