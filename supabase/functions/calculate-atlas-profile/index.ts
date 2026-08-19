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
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const body = await req.json().catch(() => ({}));
    console.log('Body received:', JSON.stringify(body));
    const { childId } = body;

    if (!childId) {
      return new Response(
        JSON.stringify({ error: "Missing childId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Fetch child and questionnaire responses
    let child: any;
    let dbResponses: any;
    try {
      console.log(`[db] Fetching child for childId: ${childId}`);
      const { data, error } = await supabaseAdmin
        .from('children')
        .select('*')
        .eq('id', childId)
        .single();
      if (error || !data) {
        throw new Error(error?.message || "Child data is null");
      }
      child = data;
    } catch (err: any) {
      console.error("[db] Fetch child error:", err);
      throw new Error(`Database fetch child failed: ${err.message}`);
    }

    try {
      console.log(`[db] Fetching questionnaire responses for childId: ${childId}`);
      const { data, error } = await supabaseAdmin
        .from('atlas_questionnaire_responses')
        .select('*')
        .eq('child_id', childId)
        .single();
      if (error || !data) {
        throw new Error(error?.message || "Questionnaire responses data is null");
      }
      dbResponses = data;
    } catch (err: any) {
      console.error("[db] Fetch responses error:", err);
      throw new Error(`Database fetch questionnaire responses failed: ${err.message}`);
    }

    // Flatten JSONB columns to flat keys for backward compatibility with calculations
    const responses: any = { ...dbResponses };
    for (let i = 2; i <= 9; i++) {
      const domainObj = dbResponses[`d${i}_responses`] || {};
      Object.entries(domainObj).forEach(([k, v]) => {
        responses[`d${i}_${k}`] = v;
      });
    }

    const childName = child.first_name || "Child";

    // 2. Deterministic Scoring Logic
    const LIKERT_MAP: Record<string, number> = {
      'Rarely': 0,
      'Sometimes': 1,
      'Often': 2,
      'Almost always': 3
    };

    const getScoreValue = (val: string | null, isStrengthKeyed: boolean) => {
      if (!val || val === 'Not sure' || !(val in LIKERT_MAP)) return null;
      const rawScore = LIKERT_MAP[val];
      return isStrengthKeyed ? rawScore : (3 - rawScore);
    };

    const calculateDomain = (fields: string[], isStrengthKeyedArray: boolean[]) => {
      let totalPoints = 0;
      let answeredCount = 0;
      const totalQuestions = fields.length;

      fields.forEach((f, idx) => {
        const val = responses[f];
        const pts = getScoreValue(val, isStrengthKeyedArray[idx]);
        if (pts !== null) {
          totalPoints += pts;
          answeredCount++;
        }
      });

      // Check if at least 60% of items were answered
      const threshold = totalQuestions * 0.6;
      if (answeredCount < threshold) {
        return { score: null, band: null };
      }

      const score = Math.round((totalPoints / (3 * answeredCount)) * 100);
      let band = 'developing';
      if (score <= 39) band = 'support_area';
      else if (score >= 70) band = 'strength';

      return { score, band };
    };

    let d2, d3, d4, d5, d6, d7, d8, d9, compositeScore;
    try {
      console.log("[scoring] Running domain calculations");
      // d2: Social & Communication (10 fields, all strength-keyed)
      d2 = calculateDomain(
        [
          'd2_understands', 'd2_communicates', 'd2_initiates', 'd2_reliable_way',
          'd2_follows_instructions', 'd2_enjoys_familiar', 'd2_joins_group',
          'd2_shares_interest', 'd2_shares_attention', 'd2_gets_along'
        ],
        Array(10).fill(true)
      );

      // d3: Academics & Learning (5 fields: 4 strength-keyed, 1 support-keyed)
      d3 = calculateDomain(
        ['d3_curious', 'd3_steady_pace', 'd3_remembers', 'd3_engages', 'd3_frustrated'],
        [true, true, true, true, false]
      );

      // d4: Behaviour & Regulation (9 fields: 3 strength, 6 support)
      d4 = calculateDomain(
        [
          'd4_calms_down', 'd4_copes_routine', 'd4_emotional_swings',
          'd4_frustrated_easily', 'd4_anxious', 'd4_stays_focused',
          'd4_follows_multistep', 'd4_acts_before_thinking', 'd4_distracted'
        ],
        [true, true, false, false, false, true, true, false, false]
      );

      // d5: Sensory (5 fields: 1 strength, 4 support)
      d5 = calculateDomain(
        ['d5_copes_sights', 'd5_overwhelmed_busy', 'd5_clothing_tags', 'd5_sensitive_lights', 'd5_reactions_textures'],
        [true, false, false, false, false]
      );

      // d6: Functional Wellness (5 fields: 4 strength, 1 support)
      d6 = calculateDomain(
        ['d6_falls_asleep', 'd6_sleeps_night', 'd6_sleep_routine', 'd6_wakes_often', 'd6_eats_range'],
        [true, true, true, false, true]
      );

      // d7: Primitive Motor Reflexes (5 fields: all support)
      d7 = calculateDomain(
        ['d7_sit_still', 'd7_pencil_grip', 'd7_easily_startled', 'd7_late_crawl', 'd7_poor_balance'],
        Array(5).fill(false)
      );

      // d8: Brain Development (4 fields: 3 strength, 1 support)
      d8 = calculateDomain(
        ['d8_movement_milestones', 'd8_speech_milestones', 'd8_developmental_stages', 'd8_lost_skills'],
        [true, true, true, false]
      );

      // d9: Daily Living Skills (5 fields: 4 strength, 1 support)
      d9 = calculateDomain(
        ['d9_personal_care', 'd9_everyday_tasks', 'd9_daily_routines', 'd9_changes_situations', 'd9_needs_support'],
        [true, true, true, true, false]
      );

      // Composite score
      const scoresList = [d2.score, d3.score, d4.score, d5.score, d6.score, d7.score, d8.score, d9.score].filter((s): s is number => s !== null);
      compositeScore = scoresList.length > 0 
        ? Math.round(scoresList.reduce((sum, val) => sum + val, 0) / scoresList.length) 
        : null;
    } catch (err: any) {
      console.error("[scoring] Error in domain calculation:", err);
      throw new Error(`Deterministic scoring computation failed: ${err.message}`);
    }

    // 3. Save scores to atlas_domain_scores
    try {
      console.log(`[db] Saving scores to atlas_domain_scores for childId: ${childId}`);
      const { error: scoresSaveErr } = await supabaseAdmin
        .from('atlas_domain_scores')
        .upsert({
          child_id: childId,
          d2_score: d2.score,
          d2_band: d2.band,
          d3_score: d3.score,
          d3_band: d3.band,
          d4_score: d4.score,
          d4_band: d4.band,
          d5_score: d5.score,
          d5_band: d5.band,
          d6_score: d6.score,
          d6_band: d6.band,
          d7_score: d7.score,
          d7_band: d7.band,
          d8_score: d8.score,
          d8_band: d8.band,
          d9_score: d9.score,
          d9_band: d9.band,
          composite_score: compositeScore,
          updated_at: new Date().toISOString()
        }, { onConflict: 'child_id' });

      if (scoresSaveErr) throw scoresSaveErr;
    } catch (err: any) {
      console.error("[db] Save scores error:", err);
      throw new Error(`Failed to upsert atlas_domain_scores: ${err.message}`);
    }

    // 4. Generate narrative support plan (single LLM call to Anthropic Claude)
    let d12SupportPlan: string | null = null;

    if (anthropicApiKey) {
      try {
        console.log("[anthropic] Dispatching request to Anthropic Claude 3.5 Sonnet");
        const payloadJSON = {
          child_name: childName,
          domain_scores: {
            "Social & Communication": { score: d2.score, band: d2.band },
            "Academics & Learning": { score: d3.score, band: d3.band },
            "Behaviour & Regulation": { score: d4.score, band: d4.band },
            "Sensory Profile": { score: d5.score, band: d5.band },
            "Functional Wellness": { score: d6.score, band: d6.band },
            "Primitive Motor Reflexes": { score: d7.score, band: d7.band },
            "Brain Development": { score: d8.score, band: d8.band },
            "Daily Living Skills": { score: d9.score, band: d9.band },
            "Composite Profile Score": compositeScore
          },
          developmental_profile: {
            communication_mode: responses.d1_communication_mode,
            strengths_checklist: responses.d1_strengths_checklist || [],
            who_is: responses.d1_who_is,
            enjoys: responses.d1_enjoys,
            would_help: responses.d1_what_helps
          },
          environment_and_family: {
            family_differences: responses.d10_family_differences,
            family_notes: responses.d10_genetic_notes,
            daytime_location: responses.d11_location,
            calm_environment: responses.d11_calm_space,
            calm_factors: responses.d11_what_helps || []
          }
        };

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": anthropicApiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1000,
            system: "You are a supportive educational assistant helping families understand their child's profile. Write a warm, strengths-first support plan based ONLY on the data provided. Rules: use 'learner' not 'patient'; say 'support area' not 'deficit' or 'disorder'; never suggest a diagnosis; if data is missing, acknowledge it rather than invent; keep it under 300 words.",
            messages: [
              {
                role: "user",
                content: JSON.stringify(payloadJSON)
              }
            ]
          })
        });

        if (response.ok) {
          const resJSON = await response.json();
          d12SupportPlan = resJSON.content[0].text;
          console.log("[anthropic] Support plan generated successfully");
        } else {
          const errText = await response.text();
          console.error("Anthropic Claude API returned an error:", errText);
        }
      } catch (claudeErr) {
        console.error("Exception during Anthropic API call:", claudeErr);
      }
    } else {
      console.warn("ANTHROPIC_API_KEY environment variable is not configured. Skipping narrative generation.");
    }

    // Save support plan narrative to scores table
    try {
      console.log(`[db] Updating support plan in atlas_domain_scores for childId: ${childId}`);
      const { error: narrativeErr } = await supabaseAdmin
        .from('atlas_domain_scores')
        .update({ d12_support_plan: d12SupportPlan })
        .eq('child_id', childId);
      if (narrativeErr) throw narrativeErr;
    } catch (err: any) {
      console.error("[db] Save support plan error:", err);
      throw new Error(`Failed to update support plan narrative: ${err.message}`);
    }

    // 5. Populate and synchronize strengths & challenges lists for atlas_profiles
    const strengthItems: any[] = [];
    const challengeItems: any[] = [];

    const strengthThreshold = 2; // Often (2) or Almost always (3)
    const addSc = (val: string | null, isStrengthKeyed: boolean, strengthText: string, challengeText: string, domain: string) => {
      const score = getScoreValue(val, isStrengthKeyed);
      if (score !== null) {
        if (score >= strengthThreshold) {
          strengthItems.push({ label: strengthText, domain });
        } else {
          challengeItems.push({ label: challengeText, domain });
        }
      }
    };

    // Add Step 1 manual checkboxes as strengths
    (responses.d1_strengths_checklist || []).forEach((str: string) => {
      strengthItems.push({ label: `Enjoys/Exhibits strength: ${str}`, domain: 'Social' });
    });

    // Social & Communication
    addSc(responses.d2_understands, true, `${childName} understands spoken language well`, `Needs support understanding spoken directions`, 'Social');
    addSc(responses.d2_communicates, true, `${childName} expresses wants and needs clearly`, `Struggles to express wants and needs`, 'Communication');
    addSc(responses.d2_initiates, true, `${childName} initiates interactions and chats independently`, `Rarely starts conversations on their own`, 'Social');
    addSc(responses.d2_reliable_way, true, `${childName} has a reliable way to communicate`, `Does not have a consistent, reliable communication method`, 'Communication');
    addSc(responses.d2_follows_instructions, true, `${childName} follows simple instructions easily`, `Finds it difficult to follow simple instructions`, 'Learning');
    addSc(responses.d2_enjoys_familiar, true, `${childName} enjoys being around familiar people`, `Avoids or gets uncomfortable around familiar people`, 'Social');
    addSc(responses.d2_joins_group, true, `${childName} joins in group and shared activities with ease`, `Avoids or struggles in group activities`, 'Social');
    addSc(responses.d2_shares_interest, true, `${childName} seeks connections and friendships with peers`, `Shows little interest in connecting with peers`, 'Social');
    addSc(responses.d2_shares_attention, true, `${childName} shares attention (follows points, shows objects)`, `Struggles with joint attention`, 'Communication');
    addSc(responses.d2_gets_along, true, `${childName} gets along well with peers without conflict`, `Experiences frequent peer conflicts`, 'Social');

    // Academics & Learning
    addSc(responses.d3_curious, true, `${childName} is curious and eager to learn`, `Requires extra motivation to engage in learning`, 'Learning');
    addSc(responses.d3_steady_pace, true, `${childName} learns new skills at a steady pace`, `Needs extra time to pick up new academic skills`, 'Academic');
    addSc(responses.d3_remembers, true, `${childName} remembers and recalls information well`, `Has difficulty remembering instructions`, 'Brain');
    addSc(responses.d3_engages, true, `${childName} easily engages with learning materials (games, books)`, `Struggles to focus on educational games or books`, 'Learning');
    addSc(responses.d3_frustrated, false, `${childName} stays calm during learning activities`, `Avoids or gets frustrated with learning tasks`, 'Academic');

    // Behaviour & Regulation
    addSc(responses.d4_calms_down, true, `${childName} calms down within a reasonable time after getting upset`, `Struggles to self-regulate when upset`, 'Behavior');
    addSc(responses.d4_copes_routine, true, `${childName} copes well with changes to routine`, `Gets distressed by unexpected routine changes`, 'Behavior');
    addSc(responses.d4_emotional_swings, false, `${childName} has stable emotions throughout the day`, `Experiences significant emotional swings during the day`, 'Behavior');
    addSc(responses.d4_frustrated_easily, false, `${childName} has a good frustration tolerance`, `Gets frustrated or angry very easily`, 'Behavior');
    addSc(responses.d4_anxious, false, `${childName} is generally calm and relaxed`, `Seems frequently anxious or worried`, 'Behavior');
    addSc(responses.d4_stays_focused, true, `${childName} stays focused on seated tasks for a reasonable time`, `Struggles to stay focused on tasks`, 'Learning');
    addSc(responses.d4_follows_multistep, true, `${childName} follows multi-step directions successfully`, `Difficulty following multi-step instructions`, 'Learning');
    addSc(responses.d4_acts_before_thinking, false, `${childName} exhibits good impulse control`, `Often acts impulsively or struggles to wait`, 'Behavior');
    addSc(responses.d4_distracted, false, `${childName} maintains focus without being easily distracted`, `Is easily distracted by external stimuli`, 'Learning');

    // Sensory
    addSc(responses.d5_copes_sights, true, `${childName} copes well with everyday sights, sounds, and textures`, `Sensitive to everyday sensory inputs`, 'Sensory');
    addSc(responses.d5_overwhelmed_busy, false, `${childName} stays calm in loud or busy environments`, `Gets sensory overload in loud or busy environments`, 'Sensory');
    addSc(responses.d5_clothing_tags, false, `${childName} is comfortable with clothing tags, seams, and textures`, `Is highly sensitive to clothing tags, seams, or textures`, 'Sensory');
    addSc(responses.d5_sensitive_lights, false, `${childName} copes well with bright lights and sudden sounds`, `Sensitive to bright lights or specific loud noises`, 'Sensory');
    addSc(responses.d5_reactions_textures, false, `${childName} is comfortable with various food textures and smells`, `Has strong adverse reactions to food textures or smells`, 'Sensory');

    // Functional Wellness
    addSc(responses.d6_falls_asleep, true, `${childName} falls asleep easily at bedtime`, `Struggles to fall asleep at night`, 'Genetic');
    addSc(responses.d6_sleeps_night, true, `${childName} sleeps through the night consistently`, `Wakes frequently during the night`, 'Genetic');
    addSc(responses.d6_sleep_routine, true, `${childName} has a structured and regular sleep routine`, `Sleep schedule is irregular`, 'Genetic');
    addSc(responses.d6_wakes_often, false, `${childName} experiences peaceful and restful sleep`, `Sleep is restless or interrupted`, 'Genetic');
    addSc(responses.d6_eats_range, true, `${childName} eats a healthy, reasonable range of foods`, `Is an extremely selective or picky eater`, 'Genetic');

    // Motor Reflexes
    addSc(responses.d7_sit_still, false, `${childName} sits still easily and has good posture`, `Finds it hard to sit still (fidgets, slumps, or wriggles)`, 'Motor');
    addSc(responses.d7_pencil_grip, false, `${childName} has a comfortable, mature pencil grip`, `Has an awkward pencil grip or tires easily when writing`, 'Motor');
    addSc(responses.d7_easily_startled, false, `${childName} responds calmly to sudden sounds or movements`, `Is easily startled by sudden sensory changes`, 'Sensory');
    addSc(responses.d7_late_crawl, false, `${childName} crawled around the expected age`, `Was late to crawl, skipped crawling, or had atypical crawling patterns`, 'Motor');
    addSc(responses.d7_poor_balance, false, `${childName} has good balance and movement control`, `Has poor balance or experiences motion sickness`, 'Motor');

    // Brain Development
    addSc(responses.d8_movement_milestones, true, `${childName} met early motor milestones on time`, `Was delayed in meeting early movement milestones`, 'Brain');
    addSc(responses.d8_speech_milestones, true, `${childName} met early speech milestones on time`, `Was delayed in meeting early speech milestones`, 'Brain');
    addSc(responses.d8_developmental_stages, true, `${childName} is steadily reaching new developmental stages`, `Developmental progress is plateauing`, 'Brain');
    addSc(responses.d8_lost_skills, false, `${childName} has maintained all acquired developmental skills`, `Has experienced a regression or period of lost skills`, 'Brain');

    // Daily Living
    addSc(responses.d9_personal_care, true, `${childName} manages age-appropriate personal care (dressing, eating)`, `Needs significant assistance with basic personal care tasks`, 'DailyLiving');
    addSc(responses.d9_everyday_tasks, true, `${childName} helps with simple household chores`, `Difficulty helping with simple daily tasks`, 'DailyLiving');
    addSc(responses.d9_daily_routines, true, `${childName} follows daily home routines with ease`, `Struggles to follow daily schedules and routines`, 'DailyLiving');
    addSc(responses.d9_changes_situations, true, `${childName} handles everyday changes and new situations well`, `Has difficulty adapting to new environments or changes`, 'DailyLiving');
    addSc(responses.d9_needs_support, false, `${childName} is highly independent in daily activities`, `Requires a high level of support to navigate daily tasks`, 'DailyLiving');

    // Update atlas_profiles with scores inside JSON fields
    const completeness = 100;
    try {
      console.log(`[db] Upserting atlas_profiles for childId: ${childId}`);
      const { error: profileUpsertErr } = await supabaseAdmin
        .from('atlas_profiles')
        .upsert({
          child_id: childId,
          completeness_percentage: completeness,
          strengths: strengthItems,
          challenges: challengeItems,
          communication_profile: {
            preferred_mode: responses.d1_communication_mode || 'Speaking',
            understanding: responses.d2_understands || 'Not sure',
            expression: responses.d2_communicates || 'Not sure',
            initiation: responses.d2_initiates || 'Not sure',
            reliability: responses.d2_reliable_way || 'Not sure',
            instructions: responses.d2_follows_instructions || 'Not sure',
            score: d2.score,
            band: d2.band
          },
          sensory_profile: {
            sensory_coping: responses.d5_copes_sights || 'Not sure',
            busy_environments: responses.d5_overwhelmed_busy || 'Not sure',
            clothing_textures: responses.d5_clothing_tags || 'Not sure',
            light_sound_sensitivity: responses.d5_sensitive_lights || 'Not sure',
            food_textures: responses.d5_reactions_textures || 'Not sure',
            score: d5.score,
            band: d5.band
          },
          functional_wellness: (() => {
            const fw: any[] = [];
            if (responses.d6_falls_asleep && responses.d6_falls_asleep !== 'Not sure') {
              const isPos = responses.d6_falls_asleep === 'Yes' || responses.d6_falls_asleep === 'Easily' || responses.d6_falls_asleep === 'Always';
              fw.push({ name: isPos ? 'Falls Asleep Easily' : 'Struggles Falling Asleep', status: responses.d6_falls_asleep, is_positive: isPos });
            }
            if (responses.d6_sleeps_night && responses.d6_sleeps_night !== 'Not sure') {
              const isPos = responses.d6_sleeps_night === 'Yes' || responses.d6_sleeps_night === 'Consistently' || responses.d6_sleeps_night === 'Always';
              fw.push({ name: isPos ? 'Sleeps Through Night' : 'Wakes Frequently at Night', status: responses.d6_sleeps_night, is_positive: isPos });
            }
            if (responses.d6_sleep_routine && responses.d6_sleep_routine !== 'Not sure') {
              const isPos = responses.d6_sleep_routine === 'Yes' || responses.d6_sleep_routine === 'Structured' || responses.d6_sleep_routine === 'Regular';
              fw.push({ name: isPos ? 'Regular Sleep Routine' : 'Irregular Sleep Schedule', status: responses.d6_sleep_routine, is_positive: isPos });
            }
            if (responses.d6_eats_range && responses.d6_eats_range !== 'Not sure') {
              const isPos = responses.d6_eats_range === 'Yes' || responses.d6_eats_range === 'Variety' || responses.d6_eats_range === 'Wide';
              fw.push({ name: isPos ? 'Eats Variety of Foods' : 'Selective / Picky Eater', status: responses.d6_eats_range, is_positive: isPos });
            }
            if (d6.score !== null) {
              fw.push({ name: 'score', value: d6.score });
              fw.push({ name: 'band', value: d6.band });
            }
            return fw;
          })(),
          motor_reflexes: (() => {
            const mr: any[] = [];
            if (responses.d7_sit_still && responses.d7_sit_still !== 'Not sure') {
              mr.push({ name: 'Postural Control', status: responses.d7_sit_still });
            }
            if (responses.d7_pencil_grip && responses.d7_pencil_grip !== 'Not sure') {
              mr.push({ name: 'Hand Writing Grip', status: responses.d7_pencil_grip });
            }
            if (responses.d7_easily_startled && responses.d7_easily_startled !== 'Not sure') {
              mr.push({ name: 'Startle Response', status: responses.d7_easily_startled });
            }
            if (responses.d7_poor_balance && responses.d7_poor_balance !== 'Not sure') {
              mr.push({ name: 'Balance Control', status: responses.d7_poor_balance });
            }
            if (d7.score !== null) {
              mr.push({ name: 'score', value: d7.score });
              mr.push({ name: 'band', value: d7.band });
            }
            return mr;
          })(),
          home_plan: {
            support_plan: d12SupportPlan,
            daily_routine: [
              { time: 'Morning', activity: responses.d11_location || 'School/Home' }
            ],
            calm_factors: responses.d11_what_helps || []
          },
          last_updated_at: new Date().toISOString()
        }, { onConflict: 'child_id' });

      if (profileUpsertErr) throw profileUpsertErr;
    } catch (err: any) {
      console.error("[db] Save profiles error:", err);
      throw new Error(`Failed to upsert atlas_profiles: ${err.message}`);
    }

    // Update child completeness
    try {
      console.log(`[db] Updating children completeness_percentage for childId: ${childId}`);
      const { error: childUpdateErr } = await supabaseAdmin
        .from('children')
        .update({ completeness_percentage: completeness })
        .eq('id', childId);
      if (childUpdateErr) throw childUpdateErr;
    } catch (err: any) {
      console.error("[db] Update children error:", err);
      throw new Error(`Failed to update children table completeness: ${err.message}`);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        d12_support_plan: d12SupportPlan,
        composite_score: compositeScore 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("Unhandled exception in profile calculation Edge Function:", err);
    return new Response(
      JSON.stringify({ error: err.message, stack: err.stack }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
