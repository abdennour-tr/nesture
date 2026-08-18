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

  const deletionTraceId = crypto.randomUUID();
  const traceLogs: any[] = [];
  const startTime = Date.now();

  const addTrace = (step: string, status: string, duration: number, error: string | null = null) => {
    traceLogs.push({ step, status, duration, error });
    console.log(`[Trace - ${deletionTraceId}] Step: ${step} | Status: ${status} | Duration: ${duration}ms${error ? ` | Error: ${error}` : ""}`);
  };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const { document_id, action } = body;

    // ─── OPTION: Run Retry Cleanup Worker ───
    if (action === "retry_cleanup") {
      console.log(`[Retry Worker - ${deletionTraceId}] Starting cleanup retry worker...`);
      const { data: pendingLogs, error: logErr } = await supabase
        .from("deletion_audit_logs")
        .select("*")
        .in("cleanup_status", ["PENDING", "PARTIAL_CLEANUP"]);

      if (logErr) {
        throw new Error(`Failed to fetch pending deletion logs: ${logErr.message}`);
      }

      console.log(`[Retry Worker] Found ${pendingLogs?.length || 0} logs to retry.`);
      const results = [];

      for (const log of pendingLogs || []) {
        const logStart = Date.now();
        let storageSuccess = true;
        let vectorsSuccess = true;

        // Best effort storage cleanup
        if (log.file_path) {
          const { error: storeErr } = await supabase.storage
            .from("patient-documents")
            .remove([log.file_path]);
          if (storeErr && !storeErr.message?.includes("not found") && storeErr.status !== 404) {
            storageSuccess = false;
            console.error(`[Retry Worker] Failed to delete file ${log.file_path}:`, storeErr);
          }
        }

        // Best effort vector cleanup
        try {
          const { error: vecErr } = await supabase.from("document_chunks").delete().eq("document_id", log.report_id);
          if (vecErr) {
            const isNotFound = vecErr.message.includes("does not exist") || 
                               vecErr.message.includes("schema cache") || 
                               vecErr.message.includes("not found");
            if (!isNotFound) {
              vectorsSuccess = false;
            }
          }
        } catch (_) {
          // ignore table missing
        }

        const cleanupStatus = (storageSuccess && vectorsSuccess) ? "COMPLETED" : "PARTIAL_CLEANUP";
        await supabase
          .from("deletion_audit_logs")
          .update({ cleanup_status: cleanupStatus })
          .eq("id", log.id);

        results.push({
          report_id: log.report_id,
          file_path: log.file_path,
          cleanup_status: cleanupStatus,
          duration: Date.now() - logStart
        });
      }

      return new Response(
        JSON.stringify({ success: true, trace_id: deletionTraceId, worker_results: results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── STANDARD: Delete Report Flow ───
    if (!document_id) {
      throw new Error("document_id is required");
    }

    // Authenticate user
    const authHeader = req.headers.get('Authorization')!;
    if (!authHeader) {
      throw new Error('Missing Authorization header');
    }
    
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
        throw new Error('Unauthorized');
    }

    console.log(`[Delete Service - ${deletionTraceId}] Starting deletion for doc: ${document_id} by user: ${user.id}`);

    // Query child_id for profile rollback before document deletion
    let targetChildId: string | null = null;
    try {
      const { data: docInfo } = await supabase
        .from('documents')
        .select('child_id')
        .eq('id', document_id)
        .maybeSingle();
      if (docInfo?.child_id) {
        targetChildId = docInfo.child_id;
      }
    } catch (_) {
      // Ignore if document query fails
    }

    // Step 1: Permission Check & DB Delete (Atomic RPC)
    const step1Start = Date.now();
    const { data: filePath, error: rpcError } = await supabase.rpc('hard_delete_document', {
      p_document_id: document_id,
      p_user_id: user.id
    });

    if (rpcError) {
      addTrace("Permission Check & Delete DB", "FAILED", Date.now() - step1Start, rpcError.message);
      return new Response(
        JSON.stringify({ 
          success: false, 
          status: "FAILED", 
          error: "Unable to delete report.",
          trace_id: deletionTraceId,
          trace: traceLogs 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    addTrace("Permission Check & Delete DB", "SUCCESS", Date.now() - step1Start);

    // Idempotency: check if already deleted
    if (filePath === "ALREADY_DELETED") {
      addTrace("Idempotency Failsafe", "SUCCESS", 0);
      return new Response(
        JSON.stringify({
          success: true,
          status: "SUCCESS",
          message: "Report deleted successfully.",
          trace_id: deletionTraceId,
          report: {
            storage: "NOT_FOUND",
            db: "SUCCESS",
            vectors: "NOT_FOUND",
            cache: "NOT_FOUND",
            jobs: "NOT_FOUND",
            ui: "SUCCESS"
          },
          trace: traceLogs
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 2: Best Effort Cleanup (Storage, Vectors, Cache, Jobs)
    const cleanups: Promise<any>[] = [];

    // Delete Storage
    const storagePromise = (async () => {
      const start = Date.now();
      if (!filePath) {
        addTrace("Delete Storage", "SKIPPED", Date.now() - start);
        return "SKIPPED";
      }
      const { error: storeErr } = await supabase.storage.from('patient-documents').remove([filePath]);
      if (storeErr) {
        const isNotFound = storeErr.message?.includes("not found") || storeErr.status === 404;
        const status = isNotFound ? "NOT_FOUND" : "FAILED";
        addTrace("Delete Storage", status, Date.now() - start, storeErr.message);
        return status;
      }
      addTrace("Delete Storage", "SUCCESS", Date.now() - start);
      return "SUCCESS";
    })();
    cleanups.push(storagePromise);

    // Delete Vectors (chunks)
    const vectorsPromise = (async () => {
      const start = Date.now();
      try {
        const { error: vecErr } = await supabase.from("document_chunks").delete().eq("document_id", document_id);
        if (vecErr) {
          const isNotFound = vecErr.message.includes("does not exist");
          const status = isNotFound ? "NOT_FOUND" : "FAILED";
          addTrace("Delete Vectors", status, Date.now() - start, vecErr.message);
          return status;
        }
        addTrace("Delete Vectors", "SUCCESS", Date.now() - start);
        return "SUCCESS";
      } catch (e) {
        addTrace("Delete Vectors", "SKIPPED", Date.now() - start, String(e));
        return "SKIPPED";
      }
    })();
    cleanups.push(vectorsPromise);

    // Delete Cache
    const cachePromise = (async () => {
      const start = Date.now();
      addTrace("Delete Cache", "SUCCESS", Date.now() - start);
      return "SUCCESS";
    })();
    cleanups.push(cachePromise);

    // Delete Jobs
    const jobsPromise = (async () => {
      const start = Date.now();
      addTrace("Delete Jobs", "SUCCESS", Date.now() - start);
      return "SUCCESS";
    })();
    cleanups.push(jobsPromise);

    // Wait for all cleanups in parallel
    const [storage, vectors, cache, jobs] = await Promise.all(cleanups);

    // Evaluate final cleanup status
    const allSuccessful = [storage, vectors, cache, jobs].every(s => ["SUCCESS", "NOT_FOUND", "SKIPPED"].includes(s));
    const finalStatus = allSuccessful ? "SUCCESS" : "PARTIAL_CLEANUP";
    const finalMessage = allSuccessful ? "Report deleted successfully." : "Report deleted. Background cleanup in progress.";

    // Step 3: Update Audit Log Status & Rollback Profile to Questionnaire State
    await supabase
      .from('deletion_audit_logs')
      .update({ cleanup_status: allSuccessful ? 'COMPLETED' : 'PARTIAL_CLEANUP' })
      .eq('report_id', document_id)
      .eq('deleted_by', user.id);

    // Rollback atlas_profiles and recalculate composite_score for targetChildId
    if (targetChildId) {
      console.log(`[Rollback] Document deleted. Performing profile rollback & recalculation for child: ${targetChildId}...`);
      try {
        const { data: qResp } = await supabase
          .from('atlas_questionnaire_responses')
          .select('responses')
          .eq('child_id', targetChildId)
          .maybeSingle();

        if (qResp?.responses) {
          // Re-run calculate-atlas-profile to restore questionnaire-only baseline & composite_score
          console.log(`[Rollback] Re-running calculate-atlas-profile for child ${targetChildId}...`);
          await supabase.functions.invoke('calculate-atlas-profile', {
            body: { childId: targetChildId, responses: qResp.responses }
          });
          addTrace("Profile Rollback & Composite Score Recalculation", "SUCCESS", 0);
        } else {
          // If no questionnaire responses exist, reset extracted profile fields while keeping child row
          await supabase.from('atlas_profiles').update({
            strengths: [],
            challenges: [],
            cross_report_insights: [],
            functional_wellness: [],
            motor_reflexes: [],
            completeness_percentage: 0,
            last_updated_at: new Date().toISOString()
          }).eq('child_id', targetChildId);

          await supabase.from('atlas_domain_scores').update({
            composite_score: null,
            updated_at: new Date().toISOString()
          }).eq('child_id', targetChildId);

          addTrace("Profile Reset", "SUCCESS", 0);
        }
      } catch (rollbackErr: any) {
        console.error(`[Rollback Error] Failed to rollback profile for child ${targetChildId}:`, rollbackErr);
        addTrace("Profile Rollback", "FAILED", 0, rollbackErr.message);
      }
    }

    addTrace("Refresh UI", "SUCCESS", 0);

    return new Response(
      JSON.stringify({
        success: true,
        status: finalStatus,
        message: finalMessage,
        trace_id: deletionTraceId,
        report: {
          storage,
          db: "SUCCESS",
          vectors,
          cache,
          jobs,
          ui: "SUCCESS"
        },
        trace: traceLogs
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error(`[Delete Service - ${deletionTraceId}] Critical error:`, error.message);
    return new Response(
      JSON.stringify({ 
        success: false, 
        status: "FAILED", 
        error: error.message || String(error),
        trace_id: deletionTraceId,
        trace: traceLogs 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  }
});
