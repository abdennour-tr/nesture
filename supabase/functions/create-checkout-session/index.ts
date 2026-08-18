import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// New plan definitions matching the PricingPage
const PLAN_DETAILS: Record<string, { 
  label: string; 
  maxChildren: number; 
  trialDays: number;
  envPriceKey: string;
}> = {
  "7day_pass": { 
    label: "7-Day Pass", 
    maxChildren: 1, 
    trialDays: 0,
    envPriceKey: "STRIPE_PRICE_7DAY_PASS",
  },
  "premium": { 
    label: "Premium", 
    maxChildren: 1, 
    trialDays: 14,
    envPriceKey: "STRIPE_PRICE_PREMIUM",
  },
  "family": { 
    label: "Family", 
    maxChildren: Infinity, 
    trialDays: 14,
    envPriceKey: "STRIPE_PRICE_FAMILY",
  },
  "annual_family": { 
    label: "Annual Family", 
    maxChildren: Infinity, 
    trialDays: 14,
    envPriceKey: "STRIPE_PRICE_ANNUAL_FAMILY",
  },
};

// Backward compatibility: also support old tier names
const LEGACY_TIER_MAP: Record<string, string> = {
  starter: "premium",
  growth: "family",
  enterprise: "annual_family",
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
    let tierRaw = body.tier;
    const billingPeriod = body.billingPeriod || "monthly";

    // Validate required parameters
    if (!parentId) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter: parentId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!tierRaw || typeof tierRaw !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing or invalid required parameter: tier ('7day_pass' | 'premium' | 'family' | 'annual_family')" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize tier name (support both old and new names)
    let tier = tierRaw.toLowerCase().trim();
    if (LEGACY_TIER_MAP[tier]) {
      tier = LEGACY_TIER_MAP[tier];
    }

    if (!PLAN_DETAILS[tier]) {
      return new Response(
        JSON.stringify({
          error: `Invalid tier '${tierRaw}'. Must be one of: '7day_pass', 'premium', 'family', 'annual_family'`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const planInfo = PLAN_DETAILS[tier];

    // 1. Count active learners for this parent_id
    let learnerCount = 0;
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

    console.log(`Parent ID: ${parentId}, Tier requested: ${tier}, Billing: ${billingPeriod}, Active learners: ${learnerCount}`);

    // 2. Validate child profile limit for the plan
    if (learnerCount > planInfo.maxChildren) {
      return new Response(
        JSON.stringify({
          error: "plan_limit_exceeded",
          message: `The '${planInfo.label}' plan supports up to ${planInfo.maxChildren === Infinity ? 'unlimited' : planInfo.maxChildren} child profile(s), but you have ${learnerCount}. Consider upgrading to the Family plan.`,
          learnerCount: learnerCount,
          tier: tier,
          maxAllowed: planInfo.maxChildren === Infinity ? "unlimited" : planInfo.maxChildren,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Resolve Price ID for the tier + billing period
    // Try specific billing period key first, then generic key
    const billingSpecificKey = `${planInfo.envPriceKey}_${billingPeriod.toUpperCase()}`;
    const priceId = Deno.env.get(billingSpecificKey) || Deno.env.get(planInfo.envPriceKey) || body.priceId;

    if (!priceId) {
      console.error(`Missing Stripe price for tier '${tier}', billing '${billingPeriod}'. Tried: ${billingSpecificKey}, ${planInfo.envPriceKey}`);
      return new Response(
        JSON.stringify({
          error: "missing_price_config",
          message: `Stripe Price ID for '${planInfo.label}' (${billingPeriod}) is not configured. Please set ${billingSpecificKey} or ${planInfo.envPriceKey} in Supabase secrets.`,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine return URLs
    const origin = req.headers.get("origin") || req.headers.get("referer");
    const clientUrl = Deno.env.get("CLIENT_URL") || Deno.env.get("SITE_URL") || (origin ? new URL(origin).origin : "http://localhost:3000");

    // 4. Create Stripe Checkout Session
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      metadata: {
        parentId: String(parentId),
        tier: tier,
        billingPeriod: billingPeriod,
        learnerCount: String(learnerCount),
      },
      success_url: `${clientUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl}/pricing`,
    };

    // Add trial period for eligible plans
    if (planInfo.trialDays > 0) {
      sessionParams.subscription_data = {
        trial_period_days: planInfo.trialDays,
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    console.log(`Checkout session created. Session ID: ${session.id}, URL: ${session.url}`);

    // 5. Return checkout URL
    return new Response(
      JSON.stringify({
        url: session.url,
        sessionId: session.id,
        tier: tier,
        billingPeriod: billingPeriod,
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
