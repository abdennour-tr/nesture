import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Helper: Fallback API Keys ──────────────────────────────────────────────
// Load Groq keys from environment variables (comma-separated GROQ_API_KEYS or single GROQ_API_KEY)
const ALL_GROQ_KEYS = [
  ...(Deno.env.get("GROQ_API_KEYS") || "").split(",").map(k => k.trim()),
  Deno.env.get("GROQ_API_KEY") || ""
].filter(Boolean);

let currentKeyIndex = 0;

// ─── Helper: Call Groq ──────────────────────────────────────────────
async function callGroq(systemPrompt: string, userContent: string, operationType: string): Promise<string> {
  if (ALL_GROQ_KEYS.length === 0) {
    throw new Error("Aucune clé API Groq n'est configurée.");
  }

  // Create an array of keys to try starting from the current index
  const keysToTry = [
    ...ALL_GROQ_KEYS.slice(currentKeyIndex),
    ...ALL_GROQ_KEYS.slice(0, currentKeyIndex)
  ];

  let lastError = null;

  for (let i = 0; i < keysToTry.length; i++) {
    const currentKey = keysToTry[i];
    
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${currentKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        if (response.status === 429 || errText.includes("rate limit") || errText.includes("tokens") || errText.includes("organization_restricted")) {
          console.warn(`[Groq] Key ending in ...${currentKey.slice(-4)} rate limited or restricted (Status ${response.status}). Switching to next key.`);
          
          // Advance the global key index to distribute load
          currentKeyIndex = (currentKeyIndex + 1) % ALL_GROQ_KEYS.length;
          lastError = new Error(`Groq API error: ${response.status} — ${errText}`);
          continue; // Try the next key in the list
        }
        
        throw new Error(`Groq API error: ${response.status} — ${errText}`);
      }

      const result = await response.json();
      return result.choices[0].message.content;
    } catch (error) {
      if (error.message && (error.message.includes("rate limit") || error.message.includes("429") || error.message.includes("organization_restricted"))) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  if (lastError && lastError.message.includes("organization")) {
    throw new Error(`Toutes les clés API (${ALL_GROQ_KEYS.length} clés configurées) ont été rejetées par Groq. Raison probable : Le quota journalier de l'Organisation (Tokens Per Day) est épuisé et partagé entre toutes ces clés. Détail : ${lastError.message}`);
  }
  throw lastError || new Error("All Groq API keys exhausted or rate limited.");
}

// ─── Helper: Safe JSON parse ─────────────────────────────────────────────────
function safeParse(raw: string, fallback: unknown = {}) {
  try {
    let cleanRaw = raw.trim();
    const startIndex = cleanRaw.indexOf("{");
    const endIndex = cleanRaw.lastIndexOf("}");
    if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
      cleanRaw = cleanRaw.substring(startIndex, endIndex + 1);
    }
    return JSON.parse(cleanRaw);
  } catch (e) {
    console.error("JSON parse failed:", raw.slice(0, 300), e);
    return fallback;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════════════════════
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let documentIdToRollback = null;
  let supabaseForRollback = null;
  let opTypeForRollback = "upload";
  // Hoisted: file_path is declared inside the try block, so the catch below could
  // not see it and every rollback threw a swallowed ReferenceError instead of
  // cleaning up storage.
  let filePathForRollback: string | null = null;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SERVICE_ROLE_KEY") ?? "", // Service role to bypass RLS
    );

    const { child_id, file_path, document_id, operation_type } = await req.json();
    documentIdToRollback = document_id;
    supabaseForRollback = supabase;
    const opType = operation_type || 'upload';
    opTypeForRollback = opType;
    filePathForRollback = file_path ?? null;
    const ocrApiKey = Deno.env.get("OCR_API_KEY");
    const serviceKey = Deno.env.get("SERVICE_ROLE_KEY");

    // Diagnostic: log what we received
    console.log("📥 Received payload:", { child_id, file_path, document_id, opType });
    console.log("🔑 Secrets loaded:", {
      ocr:  ocrApiKey  ? "✅" : "⚠️ Not set (will use mock text)",
      svc:  serviceKey ? `✅ (${serviceKey.slice(0,8)}...)` : "❌ MISSING",
      url:  Deno.env.get("SUPABASE_URL") ? "✅" : "❌ MISSING",
    });

    if (!serviceKey) {
      throw new Error("SERVICE_ROLE_KEY secret is missing. Add it in Dashboard → Edge Functions → Secrets.");
    }
    if ((!child_id && opType !== "validate") || !file_path) {
      throw new Error(`Missing required fields. Got: child_id=${child_id}, file_path=${file_path}`);
    }

    console.log(`\n🚀 NestureAI Atlas Pipeline — Starting for child: ${child_id}`);
    console.log(`📄 File path: ${file_path}`);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 0 — Update document status to "processing"
    // ─────────────────────────────────────────────────────────────────────────
    if (document_id) {
      await supabase.from("documents").update({ status: "processing" }).eq("id", document_id);
    }

    // Helper for cleanup on failure
    const cleanupAndRollback = async () => {
      console.warn(`[Rollback] 🧹 Cleaning up invalid document: ${document_id}`);
      if (document_id) {
        await supabase.from("documents").delete().eq("id", document_id);
      }
      if (file_path) {
        await supabase.storage.from("patient-documents").remove([file_path]);
      }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1 — Download the document from Supabase Storage
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Step 1] ⬇️  Downloading document from storage...");
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("patient-documents")
      .download(file_path);

    // The raw file is deleted once it has been processed (see Step 6), so on a
    // refresh it is expected to be gone. The text extracted at upload time is
    // kept instead, and is all the pipeline below actually needs. Only treat a
    // missing file as fatal when we have no stored text to fall back on.
    let storedText: string | null = null;
    if (downloadError) {
      if (document_id) {
        const { data: docRow } = await supabase
          .from("documents")
          .select("extracted_text")
          .eq("id", document_id)
          .maybeSingle();
        const candidate = docRow?.extracted_text;
        if (typeof candidate === "string" && candidate.trim().length >= 15) {
          storedText = candidate;
        }
      }
      if (!storedText) {
        throw new Error(`Storage download failed: ${downloadError.message}`);
      }
      console.log(`[Step 1] ♻️  Raw file already deleted — reusing stored text (${storedText.length} chars)`);
    } else {
      console.log(`[Step 1] ✅ File downloaded (${(fileData.size / 1024).toFixed(1)} KB)`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2 — OCR: Extract text from the document
    // ─────────────────────────────────────────────────────────────────────────
    let extractedText = "";

    // Determine actual file extension and MIME type
    const fileExt = file_path.split('.').pop()?.toLowerCase() || 'pdf';
    let fileMime = 'application/pdf';
    if (['jpg', 'jpeg'].includes(fileExt)) fileMime = 'image/jpeg';
    else if (fileExt === 'png') fileMime = 'image/png';
    else if (fileExt === 'webp') fileMime = 'image/webp';
    else if (fileExt === 'doc') fileMime = 'application/msword';
    else if (fileExt === 'docx') fileMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    if (storedText) {
      console.log("\n[Step 2] ♻️  Reusing previously extracted text — no re-upload to the OCR provider.");
      extractedText = storedText;
    } else if (ocrApiKey) {
      console.log(`\n[Step 2] 🔬 Running OCR on document (${fileExt}, ${fileMime})...`);
      const formData = new FormData();
      formData.append("file", new Blob([await fileData.arrayBuffer()], { type: fileMime }), `document.${fileExt}`);
      formData.append("apikey", ocrApiKey);
      formData.append("language", "eng");
      formData.append("isOverlayRequired", "false");
      formData.append("isCreateSearchablePdf", "false");
      formData.append("isTable", "true");
      formData.append("OCREngine", "2");

      const ocrRes = await fetch("https://api.ocr.space/parse/image", {
        method: "POST",
        body: formData,
      });
      const ocrJson = await ocrRes.json();

      if (!ocrJson.IsErroredOnProcessing && ocrJson.ParsedResults?.[0]?.ParsedText?.trim().length > 20) {
        extractedText = ocrJson.ParsedResults[0].ParsedText;
        console.log(`[Step 2] ✅ OCR extracted ${extractedText.length} characters.`);
      } else {
        const errorDetails = ocrJson.ErrorMessage?.[0] || ocrJson.ErrorDetails || "";
        console.warn(`[Step 2] ⚠️ OCR returned insufficient text. Details: ${errorDetails}`);
        extractedText = ocrJson.ParsedResults?.[0]?.ParsedText || "";
        if (extractedText.trim().length < 5) {
          if (['jpg', 'jpeg', 'png', 'webp'].includes(fileExt)) {
            extractedText = "IMAGE_READ_ERROR: Could not extract readable clinical text from image.";
          } else {
            extractedText = "No readable text could be extracted from this document.";
          }
        }
      }
    } else if (Deno.env.get("ALLOW_MOCK_OCR") === "true") {
      // Demo/seed only. Without this flag an unset OCR key must fail loudly rather
      // than hand a parent a profile built from invented clinical findings.
      console.warn("[Step 2] ⚠️  ALLOW_MOCK_OCR is on. Using mock clinical text — NOT for production.");
      extractedText = `Clinical Evaluation Report.
Patient: Age 8. Diagnosis: Autism Spectrum Disorder (Level 2), Sensory Processing Disorder.
Communication: Primarily non-verbal. Uses AAC device for basic requests (PECS Level 3).
Motor: Significant motor planning difficulties. Retained Moro reflex (4/4 severity). ATNR retained (3/4).
Sensory: Hypersensitive to auditory stimuli (covers ears frequently). Hyposensitive to proprioceptive input.
Strengths: Strong visual-spatial reasoning. Excellent memory for patterns. Responds well to routine.
Challenges: Emotional regulation. Transitions between activities. Fine motor grip strength.
Recommendations: Daily proprioceptive activities, weighted blanket during work sessions, 10-min movement breaks.`;
    } else {
      throw new Error(
        "OCR_API_KEY is not configured. Refusing to generate a profile without real document text.",
      );
    }

    // Reject if no readable text could be extracted (empty file, image of face/animal)
    const cleanText = extractedText.trim();
    if (cleanText.startsWith("IMAGE_READ_ERROR") || cleanText === "No readable text could be extracted from this document." || cleanText.length < 15) {
      console.warn(`[Agent 1] ❌ Reverted: No readable clinical text extracted.`);
      await cleanupAndRollback();

      const userMsg = cleanText.startsWith("IMAGE_READ_ERROR")
        ? "Unable to read clinical text from this image. Please upload a clear photo/scan of a report, or a PDF/Word document."
        : "This file contains no readable clinical information. Please check the file and try again.";

      return new Response(
        JSON.stringify({ 
          success: false, 
          error: userMsg
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Persist the extracted text before anything else touches it. This is what
    // makes Step 6 safe to run: once the text is stored, the raw file is no
    // longer needed for re-analysis and can be deleted as the consent promises.
    if (document_id && !storedText) {
      const { error: textErr } = await supabase
        .from("documents")
        .update({ extracted_text: cleanText })
        .eq("id", document_id);
      if (textErr) {
        // Without stored text we must keep the raw file, so surface this loudly.
        console.error("[Step 2] ❌ Could not persist extracted_text:", textErr.message);
        throw new Error(`Failed to persist extracted text: ${textErr.message}`);
      }
      console.log(`[Step 2] 💾 Stored extracted text (${cleanText.length} chars)`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AGENT 1 — Document Eligibility Engine (Trust & Safety)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Agent 1] 🤖 Document Eligibility Engine running...");
    const agent1Raw = await callGroq(
      `You are the Principal AI Validation Architect, Clinical AI Reliability Engineer, and Decision Engine Auditor.
      Your job is to act as an Evidence and Signal Extractor for pediatric clinical documents.
      
      We follow the "Assume Valid Until Evidence Says Otherwise" philosophy. You start with the assumption that the document is UNKNOWN, and you must extract positive clinical signals and look for strong negative evidence (e.g. invoice, blank page, flyer, passport, shopping list, completely out-of-domain documents).
      
      CRITICAL EXTRACTOR INSTRUCTIONS:
      1. Extract all positive evidence of pediatric/clinical relevance. Acceptable clinical documents include: Occupational Therapy (OT) Reports, Speech-Language Pathology (SLP) Reports, Sensory Profiles, Developmental/Specialist Assessments, school assessments, and IEPs.
      2. Identify if there is strong negative evidence showing the document is non-clinical (e.g. invoices, tax records, IDs, general safety tips flyers, sermons, shopping list, etc.).
      3. For "positive_evidence", compile a list of objects containing the direct quote ("quote"), page number ("page"), and section name ("section"). Do NOT include decision prefixes in these objects.
      4. For "negative_evidence", compile a list of objects containing the direct quote/reasons, page number, and section name.
      5. Set the following boolean flags: "is_invoice", "is_flyer", "is_id_document", "is_blank", "is_unrelated".
      6. Score the following six criteria on a scale of 0-100:
         - "assessment": Formal report structure, headers, client details, sections (max weight 20).
         - "recommendation": Concrete therapy goals, recommendations, home plan, strategies (max weight 15).
         - "developmental_evidence": History of milestones, developmental delays, background context (max weight 20).
         - "therapy_evidence": Clinical language, speech/motor/sensory clinical terms, therapy context (max weight 20).
         - "child_context": Child name, age, birthdate, parent name, pediatric relevance (max weight 15).
         - "observations": Clinical observations of behavior, motor coordination, sensory seek/avoid, social interactions (max weight 10).
      7. Calculate a subjective "ocr_score" (0-100) based on text quality.
      8. Identify "primary_diagnosis" or set to "Not specified".
      
      Return ONLY a valid JSON object. No explanations outside the JSON. No markdown backticks.`,
      `Analyze this text to extract clinical evidence:
      "${extractedText.slice(0, 4000)}"
      
      Return this exact JSON format:
      {
        "confidence_metrics": {
          "assessment": 0,
          "recommendation": 0,
          "developmental_evidence": 0,
          "therapy_evidence": 0,
          "child_context": 0,
          "observations": 0
        },
        "ocr_score": 0,
        "document_type": "string",
        "primary_diagnosis": "string or 'Not specified'",
        "clinical_signals": ["string"],
        "assessment_signals": ["string"],
        "child_context_signals": ["string"],
        "positive_evidence": [
          { "page": 1, "section": "string", "quote": "string", "justification": "string" }
        ],
        "negative_evidence": [
          { "page": 1, "section": "string", "quote": "string", "justification": "string" }
        ],
        "is_invoice": false,
        "is_flyer": false,
        "is_id_document": false,
        "is_blank": false,
        "is_unrelated": false,
        "confidence": "HIGH | MEDIUM | LOW"
      }`,
      opType,
    );

    const rawMetrics = safeParse(agent1Raw, {
      confidence_metrics: {
        assessment: 0,
        recommendation: 0,
        developmental_evidence: 0,
        therapy_evidence: 0,
        child_context: 0,
        observations: 0
      },
      ocr_score: 0,
      document_type: "Unknown",
      primary_diagnosis: "Not specified",
      clinical_signals: [],
      assessment_signals: [],
      child_context_signals: [],
      positive_evidence: [],
      negative_evidence: [],
      is_invoice: false,
      is_flyer: false,
      is_id_document: false,
      is_blank: false,
      is_unrelated: false,
      confidence: "LOW"
    });

    // ─── Clinical Decision Aggregator (Weighted Scoring Engine) ───
    const metrics = rawMetrics.confidence_metrics || {};
    const ast = Number(metrics.assessment || 0);
    const rec = Number(metrics.recommendation || 0);
    const dev = Number(metrics.developmental_evidence || 0);
    const the = Number(metrics.therapy_evidence || 0);
    const child = Number(metrics.child_context || 0);
    const obs = Number(metrics.observations || 0);

    const overallScore = Math.round(
      ast * 0.20 +
      rec * 0.15 +
      dev * 0.20 +
      the * 0.20 +
      child * 0.15 +
      obs * 0.10
    );

    // Count positive and rejection signals
    let positive_signals = 0;
    if (ast > 30) positive_signals++;
    if (rec > 30) positive_signals++;
    if (dev > 30) positive_signals++;
    if (the > 30) positive_signals++;
    if (child > 30) positive_signals++;
    if (obs > 30) positive_signals++;

    const posEvCount = Array.isArray(rawMetrics.positive_evidence) ? rawMetrics.positive_evidence.length : 0;
    positive_signals += posEvCount;

    let rejection_signals = 0;
    if (rawMetrics.is_invoice === true) rejection_signals += 3;
    if (rawMetrics.is_flyer === true) rejection_signals += 3;
    if (rawMetrics.is_id_document === true) rejection_signals += 3;
    if (rawMetrics.is_blank === true) rejection_signals += 3;
    if (rawMetrics.is_unrelated === true) rejection_signals += 3;

    const negEvCount = Array.isArray(rawMetrics.negative_evidence) ? rawMetrics.negative_evidence.length : 0;
    rejection_signals += negEvCount;

    // Enforce Decision Thresholds
    let decision: "APPROVED" | "REVIEW" | "REJECTED" = "REJECTED";
    let category = "REJECT";
    if (overallScore >= 70) {
      decision = "APPROVED";
      category = overallScore >= 85 ? "HIGH_CLINICAL" : "SUPPORTED_CLINICAL";
    } else if (overallScore >= 45) {
      decision = "REVIEW";
      category = "REVIEW";
    } else {
      decision = "REJECTED";
      category = "REJECT";
    }

    // ─── Decision Reconciler ───
    if (decision === "REJECTED" && positive_signals > rejection_signals) {
      console.log(`[Reconciler] Upgrading REJECTED to REVIEW because positive_signals (${positive_signals}) > rejection_signals (${rejection_signals})`);
      decision = "REVIEW";
      category = "REVIEW";
    }

    // ─── Explain Decision (Consistent Reason Engine) ───
    let explain_decision = "";
    if (decision === "APPROVED") {
      const posReasons = Array.isArray(rawMetrics.positive_evidence) && rawMetrics.positive_evidence.length > 0
        ? rawMetrics.positive_evidence.map((ev: any) => ev.justification || ev.quote).filter(Boolean)
        : ["Clinical assessment structure detected", "Relevant child developmental context identified"];
      explain_decision = "Document accepted for analysis.\n" + posReasons.map(r => `* ${r}`).join("\n");
    } else if (decision === "REVIEW") {
      const reviewReasons = [];
      if (overallScore < 45 && positive_signals > rejection_signals) {
        reviewReasons.push("Document has low scoring but clinical context or positive signals were detected.");
      }
      if (Array.isArray(rawMetrics.positive_evidence) && rawMetrics.positive_evidence.length > 0) {
        rawMetrics.positive_evidence.forEach((ev: any) => {
          if (ev.justification) reviewReasons.push(ev.justification);
        });
      }
      if (reviewReasons.length === 0) {
        reviewReasons.push("Ambiguous structure or clinical scoring requires manual verification.");
      }
      explain_decision = "Document requires verification.\n" + [...new Set(reviewReasons)].map(r => `* ${r}`).join("\n");
    } else {
      const negReasons = [];
      if (rawMetrics.is_invoice) negReasons.push("Document classified as an invoice or financial document.");
      if (rawMetrics.is_flyer) negReasons.push("Document classified as a public/event flyer or educational tip sheet.");
      if (rawMetrics.is_id_document) negReasons.push("Document classified as an identification or personal document.");
      if (rawMetrics.is_blank) negReasons.push("Document contains insufficient text or is blank.");
      if (rawMetrics.is_unrelated) negReasons.push("Document content is completely unrelated to pediatric or clinical therapy.");
      
      if (Array.isArray(rawMetrics.negative_evidence) && rawMetrics.negative_evidence.length > 0) {
        rawMetrics.negative_evidence.forEach((ev: any) => {
          if (ev.justification) negReasons.push(ev.justification);
        });
      }
      if (negReasons.length === 0) {
        negReasons.push("Document does not meet clinical assessment criteria.");
      }
      explain_decision = "Document is not eligible for clinical analysis.\n" + [...new Set(negReasons)].map(r => `* ${r}`).join("\n");
    }

    // Construct unified agent1 metrics payload
    const agent1 = {
      decision,
      category,
      eligibility_score: overallScore,
      ocr_score: Number(rawMetrics.ocr_score || 0),
      document_type: rawMetrics.document_type || "Unknown",
      is_non_clinical: decision === "REJECTED",
      confidence_metrics: metrics,
      clinical_signals: rawMetrics.clinical_signals || [],
      assessment_signals: rawMetrics.assessment_signals || [],
      child_context_signals: rawMetrics.child_context_signals || [],
      positive_evidence: rawMetrics.positive_evidence || [],
      negative_evidence: rawMetrics.negative_evidence || [],
      confidence: rawMetrics.confidence || "LOW",
      explain_decision,
      rejection_explanation: decision === "REJECTED" ? explain_decision : "",
      primary_diagnosis: rawMetrics.primary_diagnosis || "Not specified"
    };

    // ─── Decision Consistency Validator ───
    function verify(dec: string, msg: string, scoreVal: number, posSig: number, negSig: number): boolean {
      if (scoreVal >= 70 && dec !== "APPROVED") return false;
      if (scoreVal >= 45 && scoreVal < 70 && dec !== "REVIEW") return false;
      if (scoreVal < 45 && dec === "APPROVED") return false;
      if (posSig > negSig && dec === "REJECTED") return false;
      
      if (dec === "APPROVED" && !msg.startsWith("Document accepted for analysis.")) return false;
      if (dec === "REVIEW" && !msg.startsWith("Document requires verification.")) return false;
      if (dec === "REJECTED" && !msg.startsWith("Document is not eligible for clinical analysis.")) return false;
      
      if (dec === "REJECTED" && msg.includes("Approved because")) return false;
      if (dec === "REJECTED" && msg.toLowerCase().includes("child relevance detected")) return false;
      
      return true;
    }

    if (!verify(agent1.decision, agent1.explain_decision, agent1.eligibility_score, positive_signals, rejection_signals)) {
      console.error("[Validator Block] Contradiction detected in verification:", { 
        decision: agent1.decision, 
        explain_decision: agent1.explain_decision, 
        score: agent1.eligibility_score,
        positive_signals,
        rejection_signals
      });
      throw new Error(`Critical consistency verification failed. Decision: ${agent1.decision}, Score: ${agent1.eligibility_score}`);
    }

    // ─── Audit Logger ───
    const DEMO_AKHIL_ID = '00000000-0000-0000-0000-000000000010';
    const targetChildId = (child_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(child_id)) ? child_id : DEMO_AKHIL_ID;

    try {
      const auditReasons = agent1.decision === "REJECTED"
        ? agent1.negative_evidence.map((e: any) => e.justification || e.quote)
        : agent1.positive_evidence.map((e: any) => e.justification || e.quote);

      const auditEvidence = agent1.decision === "REJECTED"
        ? agent1.negative_evidence
        : agent1.positive_evidence;

      await supabase.from("decision_audit_logs").insert([{
        document_id: document_id || null,
        child_id: targetChildId,
        file_name: file_path ? file_path.split("/").pop() : "unknown_document",
        decision: agent1.decision,
        score: agent1.eligibility_score,
        confidence: agent1.confidence,
        reasons: auditReasons.length > 0 ? auditReasons : ["No detailed signals"],
        evidence: auditEvidence,
        raw_metrics: agent1
      }]);
      console.log(`[Audit] Logged decision: ${agent1.decision} (Score: ${agent1.eligibility_score})`);
    } catch (logErr) {
      console.error("[Audit Error] Failed to log decision to decision_audit_logs:", logErr);
    }

    // Reject processing if decision is REJECTED
    if (agent1.decision === "REJECTED") {
      console.warn(`[Agent 1] ❌ Rejected (Score: ${agent1.eligibility_score}): ${agent1.explain_decision} (Category: ${agent1.category})`);
      await cleanupAndRollback();
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `This document is not eligible for clinical analysis. Reason: ${agent1.explain_decision}`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }
    
    console.log(`[Agent 1] ✅ Eligible document (Score: ${agent1.eligibility_score}). Diagnosis: ${agent1.primary_diagnosis || "Unknown"}`);

    if (opType === "validate") {
      console.log("[Validate] ✅ Validation complete. Stopping early.");
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Document is valid.",
          agent1
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AGENT 2 — Developmental Profiler: Strengths & Challenges
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Agent 2] 🤖 Developmental Profiler running...");
    const agent2Raw = await callGroq(
      `You are a clinical data synthesizer. Extract ALL findings, strengths, challenges, and neutral facts from the text.
      CRITICAL INSTRUCTION: You MUST evaluate the text for EVERY SINGLE ONE of these domains:
      1. Cognitive
      2. Behavioral
      3. Social
      4. Motor
      5. Communication
      6. Sensory
      7. Academic
      8. Genetic
      9. Environment
      10. Brain
      11. DailyLiving
      
      For EVERY domain where you find ANY hint of information (even if it's neutral, like "Lives with parents" for Environment or "EEG normal" for Brain), you MUST create an entry in the "strengths" or "challenges" array. If a fact is neutral, place it inside the "strengths" array. Do NOT skip any domain if information is present.
      IMPORTANT: Return ONLY valid JSON.`,
      `Identify all findings from:
      "${extractedText}"
      
      Return this exact JSON:
      {
        "strengths": [
          { "label": "string", "description": "string", "domain": "Cognitive | Behavioral | Social | Motor | Communication | Sensory | Academic | Genetic | Environment | Brain | DailyLiving" }
        ],
        "challenges": [
          { "label": "string", "description": "string", "domain": "Cognitive | Behavioral | Social | Motor | Communication | Sensory | Academic | Genetic | Environment | Brain | DailyLiving" }
        ]
      }`,
      opType,
    );
    const agent2 = safeParse(agent2Raw, { strengths: [], challenges: [] });
    console.log(`[Agent 2] ✅ Found ${agent2.strengths?.length || 0} strengths, ${agent2.challenges?.length || 0} challenges.`);

    // ─────────────────────────────────────────────────────────────────────────
    // AGENT 3 — Sensory Profiler: Sensory processing patterns
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Agent 3] 🤖 Sensory Profiler running...");
    const agent3Raw = await callGroq(
      `You are a sensory processing specialist.
      CRITICAL INSTRUCTION: If a sensory domain (Auditory, Tactile, Proprioceptive, etc.) is mentioned IN ANY WAY in the text, you MUST classify it as 'hypersensitive', 'hyposensitive', or 'typical'. 
      Even if the text speaks in general terms (e.g., "Common indicators: covering ears", "Some individuals..."), you MUST ASSUME it applies to the patient and extract it!
      DO NOT USE 'unknown' IF THE SENSORY DOMAIN IS MENTIONED IN THE TEXT. 
      For example: "noise sensitivity" -> auditory hypersensitive. "Movement seeking" -> proprioceptive hyposensitive. "Dislikes tags" -> tactile hypersensitive.
      Return ONLY valid JSON. Educational purposes only.`,
      `Analyze sensory processing from:
      "${extractedText}"
      
      Return this exact JSON:
      {
        "sensory_profile": {
          "auditory": "hypersensitive | hyposensitive | typical | unknown",
          "visual": "hypersensitive | hyposensitive | typical | unknown",
          "tactile": "hypersensitive | hyposensitive | typical | unknown",
          "proprioceptive": "hypersensitive | hyposensitive | typical | unknown",
          "vestibular": "hypersensitive | hyposensitive | typical | unknown",
          "interoceptive": "hypersensitive | hyposensitive | typical | unknown",
          "sensory_notes": "string"
        },
        "communication_profile": {
          "primary_mode": "verbal | AAC | PECS | nonverbal | gestural | mixed",
          "receptive_level": "1-step | 2-step | complex | unknown",
          "expressive_notes": "string",
          "aac_tools": ["string"]
        }
      }`,
      opType,
    );
    const agent3 = safeParse(agent3Raw, { sensory_profile: {}, communication_profile: {} });
    console.log(`[Agent 3] ✅ Sensory profile mapped. Auditory: ${agent3.sensory_profile?.auditory || "unknown"}`);

    // ─────────────────────────────────────────────────────────────────────────
    // AGENT 4 — Motor & Reflex Analyzer
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Agent 4] 🤖 Motor & Reflex Analyzer running...");
    const agent4Raw = await callGroq(
      `You are a motor development specialist. Analyze motor patterns and primitive reflex retention.
      IMPORTANT: Return ONLY valid JSON. Educational purposes only.
      Score reflexes 0-4: 0=integrated, 1=minimal, 2=emerging, 3=moderate, 4=severe retention.`,
      `Analyze motor patterns from:
      "${extractedText}"
      
      Return this exact JSON:
      {
        "motor_reflexes": [
          { "name": "Moro", "score": 0, "label": "Integrated | Minimal | Emerging | Moderate | Retained (Severe)", "confidence": "INFERRED | POSSIBLE | DEFINITIVE" },
          { "name": "ATNR", "score": 0, "label": "Integrated | Minimal | Emerging | Moderate | Retained (Severe)", "confidence": "INFERRED | POSSIBLE | DEFINITIVE" },
          { "name": "STNR", "score": 0, "label": "Integrated | Minimal | Emerging | Moderate | Retained (Severe)", "confidence": "INFERRED | POSSIBLE | DEFINITIVE" },
          { "name": "TLR", "score": 0, "label": "Integrated | Minimal | Emerging | Moderate | Retained (Severe)", "confidence": "INFERRED | POSSIBLE | DEFINITIVE" },
          { "name": "Spinal Galant", "score": 0, "label": "Integrated | Minimal | Emerging | Moderate | Retained (Severe)", "confidence": "INFERRED | POSSIBLE | DEFINITIVE" },
          { "name": "Palmar Grasp", "score": 0, "label": "Integrated | Minimal | Emerging | Moderate | Retained (Severe)", "confidence": "INFERRED | POSSIBLE | DEFINITIVE" }
        ],
        "motor_notes": "string"
      }`,
      opType,
    );
    const agent4 = safeParse(agent4Raw, { motor_reflexes: [] });
    console.log(`[Agent 4] ✅ Analyzed ${agent4.motor_reflexes?.length || 0} reflexes.`);

    // ─────────────────────────────────────────────────────────────────────────
    // AGENT 5 — Cross-Report Synthesizer: Functional wellness
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Agent 5] 🤖 Cross-Report Synthesizer running...");
    const agent5Raw = await callGroq(
      `You are a multi-disciplinary clinical synthesizer. Connect patterns across domains.
      IMPORTANT: Return ONLY valid JSON. Educational purposes only.`,
      `Based on this clinical profile summary:
      - Strengths: ${JSON.stringify(agent2.strengths?.slice(0, 3))}
      - Challenges: ${JSON.stringify(agent2.challenges?.slice(0, 3))}
      - Sensory: ${JSON.stringify(agent3.sensory_profile)}
      - Reflexes: ${JSON.stringify(agent4.motor_reflexes)}
      - Source text snippet: "${extractedText.slice(0, 500)}"
      
      Return this exact JSON:
      {
        "functional_wellness": [
          { "title": "string", "description": "string", "confidence": "INFERRED | POSSIBLE | DEFINITIVE" }
        ],
        "cross_report_insights": [
          { "insight": "string", "domains_linked": ["string"] }
        ]
      }`,
      opType,
    );
    const agent5 = safeParse(agent5Raw, { functional_wellness: [], cross_report_insights: [] });
    console.log(`[Agent 5] ✅ Generated ${agent5.functional_wellness?.length || 0} functional wellness insights.`);

    // ─────────────────────────────────────────────────────────────────────────
    // AGENT 6 — Strategy Recommender: Home Plan & Game Calibration
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Agent 6] 🤖 Strategy Recommender running...");
    const agent6Raw = await callGroq(
      `You are a therapeutic strategy specialist. Create actionable home plans and game calibration settings.
      IMPORTANT: Return ONLY valid JSON. All recommendations are educational only.`,
      `Create strategies based on:
      - Primary diagnosis: ${agent1.primary_diagnosis}
      - Key challenges: ${JSON.stringify(agent2.challenges?.map((c: { label: string }) => c.label))}
      - Sensory profile: auditory=${agent3.sensory_profile?.auditory}, tactile=${agent3.sensory_profile?.tactile}
      - Retained reflexes: ${JSON.stringify(agent4.motor_reflexes?.filter((r: { score: number }) => r.score >= 2).map((r: { name: string; score: number }) => r.name))}
      
      Return this exact JSON:
      {
        "home_plan": {
          "daily_routine": [
            { "time": "Morning | Midday | Evening", "activity": "string", "duration_min": 10, "rationale": "string" }
          ],
          "environment_tips": ["string"],
          "communication_tips": ["string"]
        },
        "calibration_parameters": {
          "recommended_keyboard_size": "Big keys | Medium keys | Standard keys",
          "recommended_difficulty": "Easy | Medium | Complex - Words",
          "session_duration_min": 10,
          "break_frequency_min": 5,
          "rationale": "string"
        },
        "care_navigator": {
          "priority_referrals": ["string"],
          "next_assessment_domains": ["string"],
          "urgency": "Routine | Soon | Urgent"
        }
      }`,
      opType,
    );
    const agent6 = safeParse(agent6Raw, { home_plan: {}, calibration_parameters: {}, care_navigator: {} });
    console.log(`[Agent 6] ✅ Home plan and calibration generated.`);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3 — Calculate dynamic Completeness based on 12 Domains
    // ─────────────────────────────────────────────────────────────────────────
    let domainsFilled = 0;
    const allFindings = [...(agent2.strengths || []), ...(agent2.challenges || [])];
    
    // Check all 12 domains explicitly:
    if (allFindings.length > 0) domainsFilled++; // 1. Developmental
    if (allFindings.some(f => f.domain === 'Academic')) domainsFilled++; // 2. Academic
    if (allFindings.some(f => f.domain?.startsWith('Behavior') || f.domain?.startsWith('Behaviour'))) domainsFilled++; // 3. Behavioral
    if (agent6.home_plan?.daily_routine?.length > 0) domainsFilled++; // 4. Support Plan
    if (Object.keys(agent3.sensory_profile || {}).length > 0) domainsFilled++; // 5. Sensory
    if (agent5.functional_wellness?.length > 0) domainsFilled++; // 6. Functional Wellness
    if (allFindings.some(f => f.domain === 'Genetic')) domainsFilled++; // 7. Genetic
    if (allFindings.some(f => f.domain === 'Environment')) domainsFilled++; // 8. Environment
    if (agent4.motor_reflexes?.length > 0) domainsFilled++; // 9. Motor Reflexes
    if (Object.keys(agent3.communication_profile || {}).length > 0) domainsFilled++; // 10. Communication
    if (allFindings.some(f => f.domain === 'Brain')) domainsFilled++; // 11. Brain
    if (allFindings.some(f => f.domain === 'DailyLiving')) domainsFilled++; // 12. Daily Living

    let completeness = Math.round((domainsFilled / 12) * 100);
    console.log(`\n[Score] 📊 Atlas completeness: ${completeness}%`);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4 — Save the full profile to atlas_profiles
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[DB] 💾 Fetching existing Atlas profile for merging...");
    const { data: existingProfile } = await supabase
      .from("atlas_profiles")
      .select("*")
      .eq("child_id", child_id)
      .maybeSingle();

    let mergedProfile: any = {
      child_id: child_id,
      completeness_percentage: completeness,
      strengths: agent2.strengths || [],
      challenges: agent2.challenges || [],
      communication_profile: agent3.communication_profile || {},
      sensory_profile: agent3.sensory_profile || {},
      functional_wellness: agent5.functional_wellness || [],
      motor_reflexes: agent4.motor_reflexes || [],
      cross_report_insights: agent5.cross_report_insights || [],
      home_plan: agent6.home_plan || {},
      calibration_parameters: agent6.calibration_parameters || {},
      care_navigator: agent6.care_navigator || {},
      last_updated_at: new Date().toISOString(),
    };

    if (existingProfile) {
      console.log("[DB] Existing profile found. Merging questionnaire & document data...");

      // Flexible array merger: preserves both questionnaire & document items without losing data
      const mergeArraysFlexible = (arr1: any[], arr2: any[]) => {
        const map = new Map();
        const addItem = (item: any) => {
          if (!item) return;
          const key = typeof item === "string"
            ? item
            : (item.label || item.name || item.title || item.insight || item.reflex_name || JSON.stringify(item));
          
          if (map.has(key)) {
            const prev = map.get(key);
            if (typeof prev === "object" && typeof item === "object") {
              map.set(key, { ...prev, ...item });
            }
          } else {
            map.set(key, item);
          }
        };

        (arr1 || []).forEach(addItem);
        (arr2 || []).forEach(addItem);
        return Array.from(map.values());
      };

      mergedProfile.strengths = mergeArraysFlexible(existingProfile.strengths, mergedProfile.strengths);
      mergedProfile.challenges = mergeArraysFlexible(existingProfile.challenges, mergedProfile.challenges);
      mergedProfile.motor_reflexes = mergeArraysFlexible(existingProfile.motor_reflexes, mergedProfile.motor_reflexes);
      mergedProfile.functional_wellness = mergeArraysFlexible(existingProfile.functional_wellness, mergedProfile.functional_wellness);
      mergedProfile.cross_report_insights = mergeArraysFlexible(existingProfile.cross_report_insights, mergedProfile.cross_report_insights);

      // Merge Objects cleanly
      mergedProfile.communication_profile = {
        ...(existingProfile.communication_profile || {}),
        ...(mergedProfile.communication_profile || {}),
      };

      const oldSensory = existingProfile.sensory_profile || {};
      const newSensory = mergedProfile.sensory_profile || {};
      mergedProfile.sensory_profile = {
        ...oldSensory,
        ...newSensory,
        seeking: Array.from(new Set([...(oldSensory.seeking || []), ...(newSensory.seeking || [])])),
        avoiding: Array.from(new Set([...(oldSensory.avoiding || []), ...(newSensory.avoiding || [])])),
      };

      if (Object.keys(mergedProfile.home_plan || {}).length === 0) {
        mergedProfile.home_plan = existingProfile.home_plan;
      }
      if (Object.keys(mergedProfile.calibration_parameters || {}).length === 0) {
        mergedProfile.calibration_parameters = existingProfile.calibration_parameters;
      }
      if (Object.keys(mergedProfile.care_navigator || {}).length === 0) {
        mergedProfile.care_navigator = existingProfile.care_navigator;
      }

      // Keep highest completeness percentage
      mergedProfile.completeness_percentage = Math.max(existingProfile.completeness_percentage || 0, completeness);
    }

    console.log("\n[DB] 💾 Saving merged Atlas profile to Supabase...");
    const { error: upsertError } = await supabase.from("atlas_profiles").upsert(
      mergedProfile,
      { onConflict: "child_id" },
    );

    if (upsertError) throw new Error(`DB upsert failed: ${upsertError.message}`);
    console.log("[DB] ✅ Atlas profile merged & saved successfully.");

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4b — Recalculate Composite Score & Domain Scores
    // ─────────────────────────────────────────────────────────────────────────
    try {
      console.log(`[DB] 📊 Recalculating Composite Score for child: ${child_id}`);
      const { data: domainRow } = await supabase
        .from("atlas_domain_scores")
        .select("*")
        .eq("child_id", child_id)
        .maybeSingle();

      if (domainRow) {
        const scores = [
          domainRow.d2_score,
          domainRow.d3_score,
          domainRow.d4_score,
          domainRow.d5_score,
          domainRow.d6_score,
          domainRow.d7_score,
          domainRow.d8_score,
          domainRow.d9_score,
        ].filter((s): s is number => s !== null && s !== undefined);

        const newCompositeScore = scores.length > 0
          ? Math.round(scores.reduce((sum, v) => sum + v, 0) / scores.length)
          : null;

        await supabase
          .from("atlas_domain_scores")
          .update({
            composite_score: newCompositeScore,
            updated_at: new Date().toISOString(),
          })
          .eq("child_id", child_id);

        console.log(`[DB] ✅ Composite Score updated to ${newCompositeScore}`);
      }
    } catch (scoreErr) {
      console.error("[DB Score Error] Failed to update composite score:", scoreErr);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 5 — Mark document as processed
    // ─────────────────────────────────────────────────────────────────────────
    if (document_id) {
      const updateData: any = { status: "definitive" };
      try {
        updateData.validation_metrics = agent1;
      } catch (e) {
        console.error("Failed to assign validation_metrics:", e);
      }
      const { error: updateError } = await supabase.from("documents").update(updateData).eq("id", document_id);
      if (updateError) {
        console.error("[DB Update Error] Failed to update documents status/metrics:", updateError);
        // Fallback update
        await supabase.from("documents").update({ status: "definitive" }).eq("id", document_id);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 6 — Delete the raw file (RGPD/HIPAA compliance)
    // ─────────────────────────────────────────────────────────────────────────
    // The consent tells parents their document is processed and then deleted, so
    // this runs unconditionally. It is safe because the extracted text was stored
    // above and Step 1 falls back to it, so re-analysis no longer needs the file.
    // KEEP_RAW_DOCUMENTS=true is an escape hatch for debugging only; turning it on
    // makes the consent wording untrue.
    if (Deno.env.get("KEEP_RAW_DOCUMENTS") === "true") {
      console.warn("[Step 6] ⚠️  KEEP_RAW_DOCUMENTS is on — raw file retained. Consent wording assumes deletion.");
    } else {
      const { error: deleteError } = await supabase.storage
        .from("patient-documents")
        .remove([file_path]);

      if (deleteError) {
        console.error("[Step 6] ❌ Could not delete raw file:", deleteError.message);
      } else {
        console.log("[Step 6] 🗑️  Raw file deleted — only the extracted text and profile are retained.");
        if (document_id) {
          await supabase
            .from("documents")
            .update({ raw_file_deleted_at: new Date().toISOString() })
            .eq("id", document_id);
        }
      }
    }

    console.log("\n🎉 Pipeline complete!");

    return new Response(
      JSON.stringify({
        success: true,
        completeness,
        profile_summary: {
          diagnosis: agent1.primary_diagnosis,
          strengths_count: agent2.strengths?.length,
          motor_flags: agent4.motor_reflexes?.filter((r: { score: number }) => r.score >= 2).map((r: { name: string }) => r.name),
          keyboard_recommendation: agent6.calibration_parameters?.recommended_keyboard_size,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("❌ Pipeline error:", error);
    
    // Safety rollback to unblock UI and cleanup ghost documents
    if (documentIdToRollback && supabaseForRollback) {
      try {
        // Only a failed first upload may be cleaned up. On a refresh the document
        // already exists and its raw file is legitimately gone, so deleting the
        // row here would destroy a record the parent still expects to see.
        if (opTypeForRollback === "upload") {
          console.warn(`[Rollback] 🧹 Upload failed, cleaning up invalid document: ${documentIdToRollback}`);
          await supabaseForRollback.from("documents").delete().eq("id", documentIdToRollback);
          if (filePathForRollback) {
            await supabaseForRollback.storage.from("patient-documents").remove([filePathForRollback]);
          }
        } else {
          console.warn(`[Rollback] ↩️  Refresh failed for ${documentIdToRollback}; leaving the record intact.`);
          await supabaseForRollback
            .from("documents")
            .update({ status: "definitive" })
            .eq("id", documentIdToRollback);
        }
      } catch (rollbackErr) {
        console.error("❌ Failed to rollback document status:", rollbackErr);
      }
    }

    return new Response(
      JSON.stringify({ success: false, error: error.message || String(error) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  }
});
