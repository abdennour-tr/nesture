// ==============================================================================
// NestureAI — Ask AI chat (server-side Groq proxy)
// ==============================================================================
// Added 2026-09-22 to fix a privacy-review finding: src/pages/ChatPage.jsx
// previously called Groq directly from the browser using
// REACT_APP_GROQ_API_KEY, which ships the key inside the client bundle.
//
// This function does aeverything ChatPage.jsx used to do client-side:
//   - checks the caller actually owns (or is linked to) the child
//   - builds the same grounded system prompt from the child's Atlas
//     profile + validated documents
//   - de-identifies the child's name before it reaches Groq (same
//     find/replace pattern already used for Anthropic in
//     calculate-atlas-profile/index.ts), and restores it afterwards
//   - calls Groq using a server-side secret (GROQ_API_KEY / GROQ_API_KEYS)
//   - persists both the user message and the AI reply to ask_ai_messages
// The Groq key never reaches the browser.
// ==============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALL_GROQ_KEYS = [
  ...(Deno.env.get("GROQ_API_KEYS") || "").split(",").map((k) => k.trim()),
  Deno.env.get("GROQ_API_KEY") || "",
].filter(Boolean);

const escapeRegExp = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CHILD_TOKEN = "[CHILD]";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (ALL_GROQ_KEYS.length === 0) {
      throw new Error("No Groq API key configured (GROQ_API_KEY secret is missing).");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing Supabase configuration.");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerProfile } = await supabaseAdmin
      .from("users")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle();
    if (!callerProfile) {
      return new Response(JSON.stringify({ success: false, error: "Unknown user profile" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { childId, message } = body;
    if (!childId || !message || typeof message !== "string") {
      return new Response(JSON.stringify({ success: false, error: "childId and message are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Ownership check: server-side, does not rely on the client's word ──
    const { data: child } = await supabaseAdmin
      .from("children")
      .select("id, first_name, name, parent_id, ot_id")
      .eq("id", childId)
      .maybeSingle();
    if (!child) {
      return new Response(JSON.stringify({ success: false, error: "Child not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let allowed = child.parent_id === user.id || child.ot_id === user.id;
    if (!allowed && callerProfile.role === "practitioner") {
      const { data: link } = await supabaseAdmin
        .from("practitioner_children")
        .select("practitioner_id")
        .eq("practitioner_id", user.id)
        .eq("child_id", childId)
        .maybeSingle();
      allowed = !!link;
    }
    if (!allowed) {
      return new Response(JSON.stringify({ success: false, error: "Not authorized for this child" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── De-identification: replace the child's real name before it ever
    // reaches Groq, restore it once the response is back in our hands. ──
    const realChildName = child.first_name || child.name || "your child";
    const identifiers = [child.first_name, child.name]
      .filter((n: string | null) => typeof n === "string" && n.trim().length > 1)
      .map((n: string) => n.trim());
    const scrub = (text: string) =>
      identifiers.reduce(
        (acc, id) => acc.replace(new RegExp(`\\b${escapeRegExp(id)}\\b`, "gi"), CHILD_TOKEN),
        text,
      );
    const restore = (text: string) => text.split(CHILD_TOKEN).join(realChildName);

    const { data: profile } = await supabaseAdmin
      .from("atlas_profiles")
      .select("*")
      .eq("child_id", childId)
      .maybeSingle();

    const { data: docsData } = await supabaseAdmin
      .from("documents")
      .select("id, file_name, status")
      .eq("child_id", childId)
      .eq("status", "definitive");
    const documents = docsData || [];

    // Save the user's message first, same as the old client-side flow.
    const { data: insertedUserMsg, error: userMsgErr } = await supabaseAdmin
      .from("ask_ai_messages")
      .insert([{ user_id: user.id, user_role: callerProfile.role, child_id: childId, sender: "user", text: message }])
      .select()
      .single();
    if (userMsgErr) throw userMsgErr;

    const friendlyFallback =
      "I do not have enough validated information. Please upload the child's clinical evaluation reports (such as Occupational Therapy, Speech-Language Pathology, or IEP reports) in the Atlas Profile tab so that I can construct a complete developmental profile and answer your specific questions.";

    const hasValidatedDocs = documents.length > 0;
    if (!profile && !hasValidatedDocs) {
      const { data: aiMsg } = await supabaseAdmin
        .from("ask_ai_messages")
        .insert([{ user_id: user.id, user_role: callerProfile.role, child_id: childId, sender: "ai", text: friendlyFallback }])
        .select()
        .single();
      return new Response(
        JSON.stringify({ success: true, userMessageId: insertedUserMsg.id, aiMessageId: aiMsg?.id, aiText: friendlyFallback }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const profileContext = scrub(`
- Strengths: ${Array.isArray(profile?.strengths) ? profile.strengths.map((s: any) => s.label).join(", ") : "Not assessed"}
- Challenges: ${Array.isArray(profile?.challenges) ? profile.challenges.map((c: any) => c.label).join(", ") : "Not assessed"}
- Functional Wellness: ${Array.isArray(profile?.functional_wellness) ? profile.functional_wellness.map((fw: any) => fw.title).join(", ") : "Not assessed"}
- Level: ${profile?.recommended_level || "Medium"}
- Completeness: ${profile?.completeness_percentage || 0}%
`);
    const docsContext = documents.map((d) => `Document ID: ${d.id}, Filename: ${scrub(d.file_name || "")}, Status: ${d.status}`).join("\n");

    const systemPrompt = `You are the Nesture AI assistant, a strictly grounded clinical child assistant.
You are answering questions about a child referred to only as ${CHILD_TOKEN}. Never ask for or use their real name.

Strict Context Isolation (Do not reference any other child or session):
- Child ID (Mandatory): ${childId}
- Validated Documents on File (Mandatory):
${docsContext}

Current Atlas Profile Context:
${profileContext}

Guidelines for your response:
1. You MUST ONLY respond using the provided Child Profile and Validated Documents context above.
2. If the context is empty, or if the information required to answer the question is not explicitly contained in the provided context, you MUST reply exactly: "${friendlyFallback}"
3. Do NOT make assumptions, extrapolate, or hallucinate. Do NOT invent recommendations or patterns.
4. Keep your answers professional, supportive, and concise (2-3 short paragraphs max).
5. Refer to the child only as ${CHILD_TOKEN}. Absolutely forbid referencing other kids, historical caches, user email, IP, or names not in the context.`;

    const { data: history } = await supabaseAdmin
      .from("ask_ai_messages")
      .select("sender, text")
      .eq("user_id", user.id)
      .eq("user_role", callerProfile.role)
      .eq("child_id", childId)
      .order("created_at", { ascending: true });

    const validHistory = (history || []).filter(
      (m) => !(m.sender === "ai" && (m.text.startsWith("Hi! I'm the Nesture") || m.text.startsWith("Connection Error:"))),
    );
    const recentHistory = validHistory.slice(-11, -1); // exclude the message we just inserted

    const apiMessages = [{ role: "system", content: systemPrompt }];
    recentHistory.forEach((m) => {
      apiMessages.push({ role: m.sender === "ai" ? "assistant" : "user", content: scrub(m.text) });
    });
    apiMessages.push({ role: "user", content: scrub(message) });

    let aiText = "";
    let lastError: Error | null = null;
    for (const key of ALL_GROQ_KEYS) {
      try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "openai/gpt-oss-20b",
            messages: apiMessages,
            temperature: 0.0,
            max_tokens: 500,
          }),
        });
        if (!response.ok) {
          const errText = await response.text();
          lastError = new Error(`Groq API error: ${response.status} — ${errText}`);
          if (response.status === 429) continue;
          throw lastError;
        }
        const data = await response.json();
        aiText = restore(data.choices[0].message.content);
        lastError = null;
        break;
      } catch (e) {
        lastError = e as Error;
      }
    }
    if (lastError) throw lastError;

    const { data: insertedAiMsg, error: aiMsgErr } = await supabaseAdmin
      .from("ask_ai_messages")
      .insert([{ user_id: user.id, user_role: callerProfile.role, child_id: childId, sender: "ai", text: aiText }])
      .select()
      .single();
    if (aiMsgErr) throw aiMsgErr;

    return new Response(
      JSON.stringify({ success: true, userMessageId: insertedUserMsg.id, aiMessageId: insertedAiMsg.id, aiText }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[ask-ai-chat] Error:", error.message);
    return new Response(JSON.stringify({ success: false, error: error.message || String(error) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
