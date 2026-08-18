import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing Supabase URL or Service Role Key configuration");
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const body = await req.json().catch(() => ({}));
    console.log('Reset password request for child_id:', body.child_id);

    const { child_id, new_password, parent_id } = body;

    if (!child_id || !new_password || !parent_id) {
      return new Response(
        JSON.stringify({ error: "missing_fields", message: "Missing required fields: child_id, new_password, parent_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (new_password.length < 6) {
      return new Response(
        JSON.stringify({ error: "password_too_short", message: "Password must be at least 6 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify the child belongs to this parent
    const { data: child, error: childErr } = await supabaseAdmin
      .from('children')
      .select('auth_user_id')
      .eq('id', child_id)
      .eq('parent_id', parent_id)
      .single();

    if (childErr || !child) {
      console.error('Child not found or not owned by parent:', childErr);
      return new Response(
        JSON.stringify({ error: "not_authorized", message: "Not authorized to reset this account's password" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!child.auth_user_id) {
      return new Response(
        JSON.stringify({ error: "no_auth_account", message: "This child does not have a login account to reset" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Reset the password via admin API
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
      child.auth_user_id,
      { password: new_password }
    );

    if (updateErr) {
      console.error('Password update failed:', updateErr);
      return new Response(
        JSON.stringify({ error: "update_failed", message: updateErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Password reset successful for child ${child_id}`);

    return new Response(
      JSON.stringify({ success: true, message: "Password updated successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Unhandled exception:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
