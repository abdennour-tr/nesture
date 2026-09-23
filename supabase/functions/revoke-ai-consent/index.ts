// ==============================================================================
// NestureAI — Revoke AI Access & Delete Data
// ==============================================================================
// Added 2026-09-22 to fix a privacy-review finding: the "Revoke AI Access &
// Delete Data" button in ConsentSettingsModal.jsx previously did nothing but
// show a fake success toast after a 1.5s delay.
//
// This function actually deletes, for every child of the calling parent:
//   - uploaded documents (DB rows + the original Storage object, if still present)
//   - the extracted text stored alongside each document
//   - the Atlas profile, domain scores and questionnaire responses
//   - the Ask-AI chat history
//   - raw hand/pose tracking (the per-frame camera-derived landmark data
//     behind the AI reflex/OT analysis — added 2026-09-23, see
//     20260923_revoke_consent_deletes_tracking.sql)
// and writes an audit row to consent_revocations for every child affected.
// The `sessions` table (final scores/accuracy/words completed per round) is
// intentionally left untouched (see the consent copy shown to parents:
// "Game progress (scores) will remain anonymized") — that's aggregate game
// progress, not AI-derived biometric data.
// ==============================================================================
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
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing Supabase configuration (SUPABASE_URL / SERVICE_ROLE_KEY).");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Two clients: one scoped to the caller (to verify who they are) and one
    // with the service role (to run the SECURITY DEFINER RPC and touch
    // Storage, which RLS-scoped clients cannot do).
    const supabaseAsUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAsUser.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[revoke-ai-consent] Starting for parent ${user.id}`);

    // Run as the authenticated user so revoke_ai_consent()'s own
    // "p_parent_id <> auth.uid()" check is meaningful, not bypassable.
    const { data: rows, error: rpcError } = await supabaseAsUser.rpc("revoke_ai_consent", {
      p_parent_id: user.id,
    });

    if (rpcError) {
      console.error("[revoke-ai-consent] RPC failed:", rpcError.message);
      return new Response(
        JSON.stringify({ success: false, error: "Unable to revoke consent: " + rpcError.message }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const filePaths = (rows || [])
      .map((r: { file_path: string | null }) => r.file_path)
      .filter((p: string | null): p is string => !!p);
    const childIds = new Set((rows || []).map((r: { child_id: string }) => r.child_id));

    let storageStatus = "NOT_APPLICABLE";
    if (filePaths.length > 0) {
      const { error: storageError } = await supabaseAdmin.storage.from("patient-documents").remove(filePaths);
      storageStatus = storageError ? "PARTIAL_CLEANUP" : "SUCCESS";
      if (storageError) {
        console.error("[revoke-ai-consent] Storage cleanup had errors:", storageError.message);
      }
    } else {
      storageStatus = "NOT_FOUND";
    }

    console.log(
      `[revoke-ai-consent] Done. children=${childIds.size} documents=${filePaths.length} storage=${storageStatus}`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        children_affected: childIds.size,
        documents_deleted: filePaths.length,
        storage_cleanup: storageStatus,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[revoke-ai-consent] Critical error:", error.message);
    return new Response(JSON.stringify({ success: false, error: error.message || String(error) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
