// ==============================================================================
// NestureAI — Record parental attestation
// ==============================================================================
// Added 2026-09-22 to fix a privacy-review finding: sign-up only had a
// generic "I agree to all of the above" checkbox, and the public.consent
// table (which already had ip_address / agreement_version columns) was
// never actually written to at sign-up time.
//
// This is a lightweight SELF-CERTIFICATION, not an identity check: no ID
// document and no payment method is verified. It records a distinct,
// explicit legal attestation ("I certify... I am the parent/legal
// guardian...") together with a server-captured timestamp, IP address and
// user agent as evidence, in case the claim is ever challenged.
//
// Requires a valid Authorization header — the caller can only ever record
// an attestation for themselves (auth.getUser(token)), never for another
// account. Called from two places in the frontend:
//   - SignUpPage.jsx, right after sign-up, when email confirmation is
//     disabled and a session already exists.
//   - AuthCallbackPage.jsx, right after a new user confirms their email and
//     gets their first real session (the normal, mandatory-verification path).
// ==============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ATTESTATION_TEXT =
  "I certify, to the best of my knowledge and under penalty of applicable law, that I am the parent or legal guardian of the child/children I am registering on NestureAI, and that I am at least 18 years old.";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing Supabase configuration.");
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const agreementVersion = body.agreementVersion || "v1.1-attestation";

    const { data: existing } = await supabase
      .from("consent")
      .select("id, attestation_confirmed")
      .eq("parent_id", user.id)
      .maybeSingle();

    const forwardedFor = req.headers.get("x-forwarded-for") || "";
    const ip = forwardedFor.split(",")[0].trim() || req.headers.get("cf-connecting-ip") || null;
    const userAgent = req.headers.get("user-agent") || null;

    if (existing) {
      if (existing.attestation_confirmed) {
        return new Response(JSON.stringify({ success: true, already_recorded: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // A consent row exists (e.g. created before this feature shipped) but
      // has no attestation on file yet — fill it in rather than erroring.
      const { error: updateErr } = await supabase
        .from("consent")
        .update({
          attestation_confirmed: true,
          attestation_text: ATTESTATION_TEXT,
          ip_address: ip,
          user_agent: userAgent,
        })
        .eq("id", existing.id);
      if (updateErr) throw updateErr;
    } else {
      const { error: insertErr } = await supabase.from("consent").insert([{
        parent_id: user.id,
        agreement_version: agreementVersion,
        attestation_confirmed: true,
        attestation_text: ATTESTATION_TEXT,
        ip_address: ip,
        user_agent: userAgent,
      }]);
      if (insertErr) throw insertErr;
    }

    console.log(`[record-consent-attestation] Recorded for user ${user.id} from IP ${ip}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[record-consent-attestation] Error:", error.message);
    return new Response(JSON.stringify({ success: false, error: error.message || String(error) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
