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
      console.error("Missing Supabase configuration. URL:", supabaseUrl, "Key exists:", !!serviceRoleKey);
      throw new Error("Missing Supabase URL or Service Role Key configuration");
    }

    // Initialize Supabase Admin Client
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Parse request body
    const body = await req.json().catch(() => ({}));
    console.log('Received body:', body);

    const { username, password, parentId, childName } = body;

    if (!username || !password || !parentId) {
      console.warn("Validation failed. Missing required fields in body:", body);
      return new Response(
        JSON.stringify({ error: "Missing required fields: username, password, parentId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const email = `${username.toLowerCase()}@learner.nestureai.com`;
    console.log(`Attempting to create learner account for user: ${username}, email: ${email}`);

    // Create user account with confirmation skipped
    const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,  // skip confirmation entirely
      user_metadata: { 
        role: 'learner', 
        display_name: username,
        parent_id: parentId,
        child_name: childName || username
      }
    });

    if (createError) {
      console.error('Admin createUser error:', createError);
      const errMsg = (createError.message || "").toLowerCase();
      if (
        errMsg.includes("already registered") ||
        errMsg.includes("already exists") ||
        createError.status === 422 ||
        createError.code === "email_exists"
      ) {
        return new Response(JSON.stringify({ 
          error: 'username_taken',
          message: 'This username is already taken. Please choose a different one.'
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(
        JSON.stringify({ 
          error: createError.message, 
          code: createError.status,
          details: createError 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Learner account successfully created. ID: ${userData.user.id}`);

    return new Response(
      JSON.stringify({ 
        user_id: userData.user.id, 
        email: userData.user.email 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Unhandled exception in Edge Function:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
