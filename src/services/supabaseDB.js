/**
 * supabaseDB.js — Supabase drop-in replacement for localDB.js
 *
 * All functions have the same signatures as localDB.js so api.js
 * requires only an import change. Data is persisted in Supabase
 * instead of the browser's IndexedDB.
 */

import { createClient } from '@supabase/supabase-js';
import { supabase, supabaseUrl, supabaseAnonKey } from './supabaseClient';
import { 
  sanitizeInput, 
  validateName, 
  validateNickname, 
  validateEmail, 
  validateAgeRange, 
  validatePassword 
} from '../utils/security';

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }
function generateId() { return crypto.randomUUID(); }

function notFound(name) {
  return Object.assign(new Error(`${name} not found`), { status: 404 });
}

// ── Init (no-op — Supabase manages its own schema) ───────────────────────────
export async function initDB() {
  // No initialisation needed for Supabase
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

export async function getDemoAccounts() {
  return [
    { role: 'learner', name: 'Akhil M.',      email: 'akhil@example.com',    password: 'password123' },
    { role: 'parent',  name: 'Jennifer Chen', email: 'jennifer@example.com', password: 'password123' },
    { role: 'ot',      name: 'Sarah Williams',email: 'sarah@example.com',    password: 'password123' },
  ];
}

/** No longer needed after migration — returns null safely */
export async function getUserByEmail() { return null; }

// ── Learners / Children ───────────────────────────────────────────────────────

export async function getLearners() {
  const { data, error } = await supabase.from('children').select('*').order('first_name');
  if (error) throw error;
  return data.map(normaliseChild);
}

export async function getLearner(learnerId) {
  const { data, error } = await supabase
    .from('children').select('*').eq('id', learnerId).maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Learner');
  return normaliseChild(data);
}

export async function getLearnersByParent(parentId) {
  const { data, error } = await supabase
    .from('children').select('*').eq('parent_id', parentId).order('first_name');
  if (error) throw error;
  
  // Deduplicate by first_name to handle older legacy entries
  const unique = [];
  const seen = new Set();
  for (const c of (data || [])) {
    if (!seen.has(c.first_name)) {
      seen.add(c.first_name);
      unique.push(c);
    }
  }

  // Fetch emails from users table
  const authUserIds = unique.map(c => c.auth_user_id).filter(Boolean);
  if (authUserIds.length > 0) {
    const { data: usersData } = await supabase
      .from('users')
      .select('*')
      .in('id', authUserIds);
    if (usersData) {
      unique.forEach(c => {
        const u = usersData.find(u => u.id === c.auth_user_id);
        if (u && u.email) {
          c.email = u.email;
        } else {
          // Fallback if email is not in users table
          const fallbackName = (c.first_name || 'learner').toLowerCase().replace(/[^a-z0-9]/g, '');
          c.email = `${fallbackName}@learner.nestureai.com`;
        }
      });
    }
  } else {
    // If no auth_user_id exists, just provide fallback
    unique.forEach(c => {
      const fallbackName = (c.first_name || 'learner').toLowerCase().replace(/[^a-z0-9]/g, '');
      c.email = `${fallbackName}@learner.nestureai.com`;
    });
  }

  return unique.map(normaliseChild);
}

export async function getLearnersByOT(otId) {
  // ONLY show children with an active entry in practitioner_children
  // (ot_id column is legacy and no longer used for access control)
  const { data: junctionData, error: jError } = await supabase
    .from('practitioner_children')
    .select('child_id')
    .eq('practitioner_id', otId);

  if (jError) throw jError;

  const childIds = (junctionData || []).map(r => r.child_id);
  if (childIds.length === 0) return [];

  const { data, error } = await supabase
    .from('children')
    .select('*')
    .in('id', childIds)
    .order('first_name');

  if (error) throw error;
  return (data || []).map(normaliseChild);
}

/**
 * Get child record from Supabase using the learner's auth UUID.
 * Used by GamePage to find the correct child_id for session saving.
 */
export async function getChildByAuthUserId(authUserId) {
  const { data, error } = await supabase
    .from('children').select('*').eq('auth_user_id', authUserId).maybeSingle();
  if (error) throw error;
  return data ? normaliseChild(data) : null;
}

/**
 * Get child record from Supabase using the learner's email (for login)
 */
export async function getChildByEmail(email) {
  const { data, error } = await supabase
    .from('children').select('*').eq('email', email).maybeSingle();
  if (error) throw error;
  return data ? normaliseChild(data) : null;
}

/**
 * Ensure a public.users row exists for a given auth user ID.
 * Creates it if missing (for learner accounts created via addChild).
 */
export async function ensureUserRow(authUserId, childData = null) {
  // Vérifier si la ligne existe déjà
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('id', authUserId)
    .maybeSingle();
  
  if (existing) return existing;
  
  // Sinon, la créer
  const role = 'learner';
  const first_name = childData?.first_name || '';
  const last_name = childData?.last_name || '';
  
  const { data, error } = await supabase
    .from('users')
    .insert([{
      id: authUserId,
      role,
      first_name,
      last_name,
      is_demo: false,
      beta_participant: false,
    }])
    .select()
    .single();
  
  if (error) {
    console.warn('[ensureUserRow] Error creating user row:', error.message);
    // Si la ligne existe déjà (concurrent), on l'ignore
    if (error.code !== '23505') throw error;
    const { data: retry } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUserId)
      .maybeSingle();
    return retry;
  }
  return data;
}

export async function addChild(childData) {
  let authUserId = null;

  // Enforce validation and sanitization for child details
  const cleanFirstName = sanitizeInput(childData.first_name, 50);
  validateName(cleanFirstName, 'First name');

  let cleanLastName = '';
  if (childData.last_name) {
    cleanLastName = sanitizeInput(childData.last_name, 50);
    if (cleanLastName !== '') {
      validateName(cleanLastName, 'Last name');
    }
  }

  let cleanAge = null;
  if (childData.age !== undefined && childData.age !== null && childData.age !== '') {
    cleanAge = validateAgeRange(childData.age);
  }

  const cleanDiagnosis = childData.diagnosis ? sanitizeInput(childData.diagnosis, 100) : '';

  // If email and password are provided, create the child Auth account behind the scenes
  if (childData.email && childData.password) {
    const cleanEmail = validateEmail(childData.email);
    const cleanPassword = validatePassword(childData.password, true);
    
    // Extract nickname from email to validate it
    const nicknamePart = cleanEmail.split('@')[0];
    validateNickname(nicknamePart);

    console.log('[addChild] Invoking create-learner-account Edge Function for:', cleanEmail);
    
    const functionUrl = `${supabaseUrl}/functions/v1/create-learner-account`;
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;

    const rawResponse = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        username: nicknamePart,
        password: cleanPassword + '_learner_suffix',
        parentId: childData.parent_id,
        childName: `${cleanFirstName} ${cleanLastName}`.trim()
      })
    });

    const responseData = await rawResponse.json();

    if (!rawResponse.ok) {
      if (
        responseData?.error === 'username_taken' ||
        responseData?.message?.toLowerCase().includes('already taken') ||
        responseData?.message?.toLowerCase().includes('already registered') ||
        responseData?.message?.toLowerCase().includes('already exists')
      ) {
        throw new Error('username_taken');
      }
      throw new Error(responseData?.message || responseData?.error || 'Failed to create learner account');
    }

    const funcData = responseData;
    
    if (funcData?.user_id) {
      authUserId = funcData.user_id;
      
      // The DB trigger `handle_new_user` (SECURITY DEFINER) will automatically
      // create the public.users row for this learner.
      // Give the trigger a moment to fire.
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Remove email and password before saving to children table
  const { email, password, ...dbChildData } = childData;

  const finalChildData = {
    ...dbChildData,
    first_name: cleanFirstName,
    last_name: cleanLastName,
    age: cleanAge,
    diagnosis: cleanDiagnosis,
    auth_user_id: authUserId
  };

  const { data, error } = await supabase
    .from('children')
    .insert([finalChildData])
    .select()
    .single();
    
  if (error) throw error;
  return normaliseChild(data);
}

export async function getProfessionals() {
  // Try to query the 'users' table directly for OTs
  const { data, error } = await supabase
    .from('users')
    .select('id, first_name, last_name, role')
    .eq('role', 'practitioner');
  
  if (error) throw error;
  
  return data.map(u => ({
    id: u.id,
    name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Professional',
    role: u.role
  }));
}

/**
 * Get specialists for the NestureConnect directory.
 * Returns practitioners with profile fields (specialty, location, bio, avatar, featured).
 * Featured practitioners are returned first.
 */
export async function getSpecialists() {
  const { data, error } = await supabase
    .from('users')
    .select('*, children:practitioner_children(count), must_reset_password, invitation_expires_at, invitation_accepted_at, first_name, last_name, specialty, location, avatar_url, bio, is_featured, connection_code, practice_name, email, is_active')
    .eq('role', 'practitioner')
    .not('specialty', 'is', null)
    .order('is_featured', { ascending: false })
    .order('first_name', { ascending: true });

  if (error) throw error;

  return (data || [])
    .filter(u => u.is_active !== false)
    .map(u => ({
      id: u.id,
      name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Specialist',
      first_name: u.first_name,
      last_name: u.last_name,
      specialty: u.specialty || 'Specialist',
      location: u.location || '',
      avatar_url: u.avatar_url || null,
      bio: u.bio || '',
      is_featured: u.is_featured || false,
      connection_code: u.connection_code || null,
      email: u.email || '',
      is_active: true,
    }));
}

export async function linkChildToOT(childId, otId) {
  const { data, error } = await supabase
    .from('children')
    .update({ ot_id: otId })
    .eq('id', childId)
    .select()
    .single();
    
  if (error) throw error;
  return normaliseChild(data);
}

/** Normalise Supabase child row to match the shape localDB used */
function normaliseChild(c) {
  return {
    ...c,
    name: c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim(),
    age:  c.age ? String(c.age) : '',
  };
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function startSession(learnerId, difficulty, gameName = 'LetterQuest') {
  const { data, error } = await supabase
    .from('sessions')
    .insert([{
      learner_id:  learnerId,
      start_time:  nowIso(),
      difficulty,
      scenario:    '',
      game_name:   gameName,
      lpi_score:   0,
      accuracy_score: 0,
      total_attempts: 0,
      perfect_grabs:  0,
      failed_grabs:   0,
      skipped:        0,
      // Supabase schema required fields
      session_date:    nowIso(),
      difficulty_mode: difficulty === 'easy' ? 'Easy' : difficulty === 'hard' ? 'Complex - Words' : 'Medium',
      keyboard_size:   'Medium keys',
    }])
    .select()
    .single();
  if (error) throw error;
  return { session_id: data.id };
}

/* ── Learner Progress Index for summary-only sessions ──────────────────────
   Games that post a summary (every game except Letter Quest) never reach the
   aiEngine, so this branch used to write a hard-coded `lpi_score: 85` — the
   same number on every row, in every game, for every child. This rebuilds a
   real one from what the games actually send.

   Same four components and weights as aiEngine's _calculateLpi, with the
   reflex share (which needs raw gestures) replaced by a motor-control share
   the games can supply. Components that a given game does not report are
   dropped and the weights renormalised over the rest, so the score stays on a
   0-100 scale instead of being silently dragged down by a missing metric.

   Detail lands in two shapes historically: newer games send a `metrics`
   object, older ones a JSON string in `notes`. Both are read. Values may be
   0-1 or 0-100 depending on the game, so each one is normalised. */
function _toUnit(raw) {
  const v = typeof raw === 'string' ? parseFloat(raw) : raw;
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.min(1, v > 1 ? v / 100 : v);
}

function _calculateClientLpi(clientPayload, accuracyFraction) {
  let detail = clientPayload?.metrics && typeof clientPayload.metrics === 'object'
    ? clientPayload.metrics
    : {};

  if (!Object.keys(detail).length && typeof clientPayload?.notes === 'string') {
    try { detail = JSON.parse(clientPayload.notes) || {}; } catch { detail = {}; }
  }

  const first = (...values) => {
    for (const v of values) {
      const u = _toUnit(v);
      if (u !== null) return u;
    }
    return null;
  };

  /* Response time, when no game-computed speed score exists: 10 s is the point
     where the component reaches zero, matching aiEngine's scale. */
  const rtMs = [detail.reactionMs, detail.reactionTimeMs, detail.pinchOnsetMs]
    .map((v) => (typeof v === 'string' ? parseFloat(v) : v))
    .find((v) => Number.isFinite(v) && v > 0);
  const rtUnit = Number.isFinite(rtMs) ? Math.max(0, 1 - rtMs / 10000) : null;

  const components = [
    // Accuracy — always present: it is the session's own accuracy_score.
    { weight: 0.40, value: _toUnit(accuracyFraction) },
    // Speed — a game-computed speed score, else derived from response time.
    { weight: 0.25, value: first(detail.speedScore) ?? rtUnit },
    // Movement quality.
    { weight: 0.20, value: first(detail.smoothness, detail.trajectorySmoothness) },
    // Motor control: grip, pinch stability, hold steadiness, path efficiency
    // or consistency — whichever the game measures.
    { weight: 0.15, value: first(
        detail.stability, detail.gripScore, detail.pinchStability,
        detail.consistency, detail.pathEfficiency, detail.grip,
      ) },
  ].filter((c) => c.value !== null);

  if (!components.length) return null;

  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const score = components.reduce((sum, c) => sum + c.value * c.weight, 0) / totalWeight;
  return Math.max(0, Math.min(100, Math.round(score * 100)));
}

export async function endSession(sessionId, gestures, reflexEngineOutput = null, clientPayload = null) {
  const { analyseSession } = await import('./aiEngine.js');

  const { data: session, error: fetchErr } = await supabase
    .from('sessions').select('*').eq('id', sessionId).maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!session) throw notFound('Session');

  const endTime  = new Date();
  const startTime = new Date(session.start_time || session.session_date);
  const duration = Math.round((endTime - startTime) / 1000);

  if (!gestures || gestures.length === 0) {
    const total = (clientPayload && clientPayload.total_attempts !== undefined) 
      ? Number(clientPayload.total_attempts) 
      : (reflexEngineOutput && reflexEngineOutput.totalAttempts !== undefined ? Number(reflexEngineOutput.totalAttempts) : (session.total_attempts ? Number(session.total_attempts) : 100));
    
    const perfect = (clientPayload && clientPayload.perfect_grabs !== undefined)
      ? Number(clientPayload.perfect_grabs)
      : (reflexEngineOutput && reflexEngineOutput.perfectGrabs !== undefined ? Number(reflexEngineOutput.perfectGrabs) : (session.perfect_grabs ? Number(session.perfect_grabs) : 0));
    
    const accuracy = (clientPayload && clientPayload.accuracy_score !== undefined)
      ? Number(clientPayload.accuracy_score)
      : (reflexEngineOutput && reflexEngineOutput.accuracy !== undefined ? Number(reflexEngineOutput.accuracy) : (total > 0 ? perfect / total : 0));

    const actualAccuracyScore = parseFloat(accuracy.toFixed(4));
    const actualAccuracyInt = Math.round(actualAccuracyScore * 100);

    const updatePayload = {
      end_time: endTime.toISOString(),
      duration_seconds: (clientPayload && clientPayload.duration_seconds !== undefined) 
                        ? Number(clientPayload.duration_seconds) 
                        : (reflexEngineOutput && reflexEngineOutput.duration !== undefined ? Number(reflexEngineOutput.duration) : Math.max(1, duration)),
      scenario: 'Completed Session',
      accuracy_score: actualAccuracyScore,
      accuracy: actualAccuracyInt,
      total_attempts: total,
      perfect_grabs: perfect,
    };

    /* Null rather than a placeholder when the game reported nothing usable:
       an empty LPI is information, a fake 85 is not. */
    const clientLpi = _calculateClientLpi(clientPayload, actualAccuracyScore);
    if (clientLpi !== null) updatePayload.lpi_score = clientLpi;
    if (clientPayload && clientPayload.notes !== undefined) {
      updatePayload.notes = clientPayload.notes;
    } else if (clientPayload && clientPayload.metrics && typeof clientPayload.metrics === 'object') {
      /* Newer games (Trace Find Type, Magic Finger Copy) send their detail as a
         `metrics` object rather than a `notes` string. There is no metrics
         column, so it was being dropped on the floor: the session report and
         the LPI backfill both read `notes`. Persist it in the same shape the
         other games use. */
      updatePayload.notes = JSON.stringify(clientPayload.metrics);
    }

    await supabase.from('sessions').update(updatePayload).eq('id', sessionId);
    return {
      session_id: sessionId,
      narrative: 'Session completed successfully.',
      lpi_score: clientLpi,
      scenario: 'Completed Session',
      reflex_scores: [], recommendations: [], metrics: {},
    };
  }

  const total    = gestures.length;
  const perfect  = gestures.filter(g => g.classification === 'Perfect').length;
  const failed   = gestures.filter(g => g.classification === 'Failed').length;
  const skipped  = gestures.filter(g => g.classification === 'Skipped').length;
  const invalid  = gestures.filter(g => g.classification === 'Invalid').length;
  const accuracy = perfect / total;
  const avgRt    = gestures.reduce((s, g) => s + (g.response_time_ms || 0), 0) / total;
  const avgSmooth= gestures.reduce((s, g) => s + (g.trajectory_smoothness || 0), 0) / total;
  const avgFatigue=gestures.reduce((s, g)=> s + (g.fatigue_indicator || 0), 0) / total;
  const midline  = gestures.filter(g => g.midline_crossing).length;
  const avgHhc   = gestures.reduce((s, g) => s + (g.head_hand_coupling || 0.5), 0) / total;

  const sessionForEngine = {
    ...session,
    total_attempts: String(total), perfect_grabs: String(perfect),
    failed_grabs: String(failed), skipped: String(skipped), invalid: String(invalid),
    accuracy_score: String(accuracy.toFixed(4)),
    avg_response_time_ms: String(avgRt.toFixed(1)),
    trajectory_smoothness: String(avgSmooth.toFixed(4)),
    fatigue_index: String(avgFatigue.toFixed(4)),
    midline_crossings: String(midline),
    head_hand_coupling: String(avgHhc.toFixed(4)),
  };

  // Passer la sortie temps réel pour fusion 60/40 dans aiEngine v2.0
  const analysis = analyseSession(sessionForEngine, gestures, reflexEngineOutput);

  // Update session in Supabase
  await supabase.from('sessions').update({
    end_time: endTime.toISOString(),
    duration_seconds: duration,
    total_attempts: total, perfect_grabs: perfect, failed_grabs: failed,
    skipped, accuracy_score: parseFloat(accuracy.toFixed(4)),
    avg_response_time_ms: Math.round(avgRt),
    trajectory_smoothness: parseFloat(avgSmooth.toFixed(4)),
    fatigue_index: parseFloat(avgFatigue.toFixed(4)),
    midline_crossings: midline,
    lpi_score: analysis.lpi_score,
    scenario: analysis.scenario,
    accuracy: Math.round(accuracy * 100), // Supabase schema integer column
  }).eq('id', sessionId);

  // Insert reflex scores (enrichis avec métadonnées éducatives v2.0)
  const reflexRecords = analysis.reflex_scores.map(rs => ({
    session_id:       sessionId,
    learner_id:       session.learner_id,
    reflex_name:      rs.reflex,
    confidence_level: rs.confidence,
    score:            rs.score,
    indicators_found: rs.indicators_found.length,
    created_at:       endTime.toISOString(),
    // v2.0 columns — developmental pattern detection (non-diagnostic)
    label:            rs.label       || 'aucun',
    explanation:      rs.education?.explanation || null,
    activities:       rs.education?.activities  || [],
    podcast_ref:      rs.education?.podcast     || null,
  }));
  if (reflexRecords.length > 0) {
    await supabase.from('reflex_scores').insert(reflexRecords);

    // Update Atlas Profile with real-time motor reflex data
    const atlasReflexes = analysis.reflex_scores.map(rs => {
      // Map AI Engine score (10-100) to Atlas severity (0-4)
      // 100 -> 0 (Integrated), 10 -> 4 (Severe)
      let severity = Math.round((100 - rs.score) / 25);
      // Clamp between 0 and 4
      severity = Math.max(0, Math.min(4, severity));
      
      let label = 'Integrated';
      if (severity >= 3) label = 'Severe Retention';
      else if (severity === 2) label = 'Moderate Retention';
      else if (severity === 1) label = 'Mild Retention';

      return {
        name: rs.reflex,
        score: severity,
        label: label
      };
    });

    await supabase.from('atlas_profiles').update({
      motor_reflexes: atlasReflexes,
      last_updated_at: new Date().toISOString()
    }).eq('child_id', session.learner_id);
  }

  return {
    session_id: sessionId,
    narrative:  analysis.narrative,
    lpi_score:  analysis.lpi_score,
    scenario:   analysis.scenario,
    reflex_scores:   analysis.reflex_scores,
    recommendations: analysis.recommendations,
    metrics:         analysis.metrics,
  };
}

export async function getSessions(learnerId, limit = 20, page = 1, filters = {}) {
  // 1. Auto-archive older sessions (retention: 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoIso = thirtyDaysAgo.toISOString();
  
  try {
    await supabase
      .from('sessions')
      .update({ is_archived: true })
      .lt('start_time', thirtyDaysAgoIso)
      .eq('is_archived', false);
  } catch (err) {
    console.warn('Auto-archiving older sessions failed:', err);
  }

  // 2. Query builder
  let query = supabase
    .from('sessions')
    .select('*', { count: 'exact' })
    .not('end_time', 'is', null)
    .order('start_time', { ascending: false });

  if (learnerId) {
    query = query.eq('learner_id', learnerId);
  }

  // Filter: Game (jeu)
  if (filters.game_name && filters.game_name !== 'all') {
    const gn = filters.game_name.toLowerCase();
    if (gn.includes('finger') || gn.includes('match')) {
      query = query.or('game_name.ilike.%finger%,game_name.ilike.%match%');
    } else {
      query = query.eq('game_name', filters.game_name);
    }
  }

  // Filter: Date Range
  if (filters.start_date) {
    query = query.gte('start_time', filters.start_date);
  }
  if (filters.end_date) {
    const end = new Date(filters.end_date);
    end.setHours(23, 59, 59, 999);
    query = query.lte('start_time', end.toISOString());
  }

  // Filter: Difficulty
  if (filters.difficulty && filters.difficulty !== 'all') {
    query = query.eq('difficulty', filters.difficulty);
  }

  // Filter: Min Accuracy
  if (filters.min_accuracy && filters.min_accuracy !== 'all') {
    const minAccDec = parseFloat(filters.min_accuracy) / 100;
    query = query.gte('accuracy_score', minAccDec);
  }

  // Filter: Archiving Policy (Active vs Archived)
  const archivedFilter = filters.archived || 'active';
  if (archivedFilter === 'active') {
    query = query.eq('is_archived', false);
  } else if (archivedFilter === 'archived') {
    query = query.eq('is_archived', true);
  }

  // 3. Handle Pagination
  const offset = (page - 1) * limit;
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  const sessions = (data || []).map(normaliseSession);
  
  return {
    sessions,
    totalCount: count || 0,
    page,
    limit,
    totalPages: Math.ceil((count || 0) / limit),
  };
}

export async function getSession(sessionId) {
  const { data, error } = await supabase
    .from('sessions').select('*').eq('id', sessionId).maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Session');
  return normaliseSession(data);
}

export async function getSessionAnalysis(sessionId) {
  const { analyseSession } = await import('./aiEngine.js');
  const session = await getSession(sessionId);
  const analysis = analyseSession(session, []);
  return { session_id: sessionId, ...analysis };
}

export async function deleteSession(sessionId) {
  // Cascade on delete handles reflex_scores automatically
  const { error } = await supabase.from('sessions').delete().eq('id', sessionId);
  if (error) throw error;
  return { status: 'ok' };
}


export async function getSessionById(sessionId) {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Session not found');
  return normaliseSession(data);
}

/** Normalise Supabase session row to match localDB shape */
function normaliseSession(s) {
  return {
    ...s,
    accuracy_score: s.accuracy_score != null ? String(s.accuracy_score) : String((s.accuracy || 0) / 100),
    avg_response_time_ms: String(s.avg_response_time_ms || s.average_response_time_ms || 0),
    trajectory_smoothness: String(s.trajectory_smoothness || 0),
    fatigue_index: String(s.fatigue_index || 0),
    lpi_score: String(s.lpi_score || 0),
    start_time: s.start_time || s.session_date,
    game_name: s.game_name || 'LetterQuest',
    is_archived: !!s.is_archived,
  };
}

// ── Reflexes ──────────────────────────────────────────────────────────────────

const REFLEX_NAMES_LIST = [
  'Moro', 'ATNR', 'STNR', 'TLR', 'Spinal Galant', 'Palmar Grasp',
  // Nouveaux réflexes v2.0
  'VOR', 'Babkin', 'Hand-to-Mouth', 'Eye Coordination', 'Visual Tracking',
];

export async function getReflexSummary(learnerId) {
  const { data, error } = await supabase
    .from('reflex_scores')
    .select('*')
    .eq('learner_id', learnerId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const all = data || [];
  const result = [];
  for (const rname of REFLEX_NAMES_LIST) {
    const rscores = all.filter(s => s.reflex_name === rname);
    if (!rscores.length) continue;
    const latest = rscores[rscores.length - 1];
    let trend = 'stable';
    if (rscores.length >= 2) {
      const prev = parseFloat(rscores[rscores.length - 2].score || 50);
      const curr = parseFloat(latest.score || 50);
      trend = curr > prev + 2 ? 'improving' : (curr < prev - 2 ? 'declining' : 'stable');
    }
    result.push({ ...latest, score: String(latest.score), trend });
  }
  return result;
}

export async function getLatestReflexes(learnerId) {
  const { data, error } = await supabase
    .from('reflex_scores').select('*').eq('learner_id', learnerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const latest = {};
  for (const s of (data || [])) {
    if (!latest[s.reflex_name]) latest[s.reflex_name] = { ...s, score: String(s.score) };
  }
  return Object.values(latest);
}

// ── Exercises ─────────────────────────────────────────────────────────────────

export async function getExercises(reflexFilter = null, specialistId = null) {
  let query = supabase.from('exercises').select('*').order('name', { ascending: true });
  if (reflexFilter) {
    query = query.eq('target_reflex', reflexFilter);
  }
  
  // Isolate by specialist if provided.
  if (specialistId) {
    query = query.eq('specialist_id', specialistId);
  }
  
  const { data, error } = await query;
  if (error) {
    console.error('getExercises error:', error);
    throw error;
  }
  return (data || []).filter(ex => !ex.id.startsWith('ex-'));
}

export async function getExercise(exerciseId) {
  const { data, error } = await supabase
    .from('exercises').select('*').eq('id', exerciseId).maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Exercise');
  return data;
}

export async function uploadExerciseVideo(file) {
  if (!file) throw new Error('No file provided');
  const ext = file.name.split('.').pop() || 'mp4';
  const fileName = `exercises/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from('avatars').upload(fileName, file, {
    cacheControl: '3600',
    upsert: true,
  });

  if (error) {
    console.error('Supabase upload error:', error);
    throw new Error('Failed to upload video');
  }

  const { data } = supabase.storage.from('avatars').getPublicUrl(fileName);
  return data.publicUrl;
}

export async function addExercise(exerciseData) {
  const { name, target_reflex, description, duration_minutes, video_url, difficulty_level, specialist_id } = exerciseData;
  const { data, error } = await supabase
    .from('exercises')
    .insert([{
      id: crypto.randomUUID(),
      name,
      target_reflex,
      description,
      duration_minutes: duration_minutes ? String(duration_minutes) : null,
      video_url: video_url || null,
      difficulty_level: difficulty_level || 'medium',
      specialist_id: specialist_id || null
    }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateExercise(exerciseId, exerciseData) {
  const { name, target_reflex, description, duration_minutes, video_url, difficulty_level } = exerciseData;
  const { data, error } = await supabase
    .from('exercises')
    .update({
      name,
      target_reflex,
      description,
      duration_minutes: duration_minutes ? String(duration_minutes) : null,
      video_url: video_url || null,
      difficulty_level: difficulty_level || 'medium'
    })
    .eq('id', exerciseId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteExercise(exerciseId) {
  // 1. Delete associated prescriptions to prevent FK constraint failures
  const { error: pError } = await supabase
    .from('prescriptions')
    .delete()
    .eq('exercise_id', exerciseId);
  if (pError) throw pError;

  // 2. Delete the exercise itself
  const { error } = await supabase
    .from('exercises')
    .delete()
    .eq('id', exerciseId);
  if (error) throw error;
  return { success: true };
}

// ── Prescriptions ─────────────────────────────────────────────────────────────

export async function prescribeExercise(learnerId, exerciseId, sessionId = null, notes = '', specialistId = null, status = 'active') {
  const { data, error } = await supabase
    .from('prescriptions')
    .insert([{ 
      learner_id: learnerId, 
      exercise_id: exerciseId, 
      session_id: sessionId || null, 
      notes,
      specialist_id: specialistId || null,
      status: status || 'active'
    }])
    .select().single();
  if (error) throw error;
  return { status: 'ok', prescription_id: data.id };
}

export async function updatePrescriptionStatus(prescriptionId, status) {
  const { data, error } = await supabase
    .from('prescriptions')
    .update({ status })
    .eq('id', prescriptionId)
    .select().single();
  if (error) throw error;
  return { status: 'ok', data };
}


export async function getPrescriptions(learnerId) {
  const { data, error } = await supabase
    .from('prescriptions')
    .select('*, exercise:exercises(*), specialist:users(first_name, last_name, is_active)')
    .eq('learner_id', learnerId)
    .order('prescribed_at', { ascending: false });
  if (error) throw error;
  return (data || [])
    .filter(p => p.exercise && !p.exercise.id.startsWith('ex-') && (!p.specialist || p.specialist.is_active !== false))
    .map(p => ({
      ...p,
      exercise: p.exercise || {},
      specialist: p.specialist || null
    }));
}

export async function getPrescriptionsByExercise(exerciseId) {
  const { data, error } = await supabase
    .from('prescriptions')
    .select('*, learner:children(*), specialist:users(first_name, last_name)')
    .eq('exercise_id', exerciseId);
  if (error) throw error;
  return (data || []).map(p => ({
    ...p,
    learner: p.learner ? normaliseChild(p.learner) : {},
    specialist: p.specialist || null
  }));
}

export async function getAllPrescriptions() {
  const { data, error } = await supabase
    .from('prescriptions')
    .select('*, exercise:exercises(*), learner:children(*), specialist:users(first_name, last_name)')
    .order('prescribed_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(p => ({
    ...p,
    exercise: p.exercise || {},
    learner: p.learner ? normaliseChild(p.learner) : {},
    specialist: p.specialist || null
  }));
}

export async function deletePrescription(prescriptionId) {
  const { error } = await supabase.from('prescriptions').delete().eq('id', prescriptionId);
  if (error) throw error;
  return { status: 'ok' };
}

// ── Report data ───────────────────────────────────────────────────────────────

export async function getReportData(sessionId) {
  const { analyseSession } = await import('./aiEngine.js');
  const session = await getSession(sessionId);
  const { data: reflexScoresData } = await supabase
    .from('reflex_scores').select('*').eq('session_id', sessionId);
  const { data: exercises } = await supabase.from('exercises').select('*');
  const learner = session.learner_id
    ? await getLearner(session.learner_id).catch(() => null)
    : null;
  const analysis = analyseSession(session, []);
  const reflexScores = (reflexScoresData || []).map(r => ({ ...r, score: String(r.score) }));
  return {
    session,
    learner,
    reflexScores: reflexScores.length ? reflexScores : analysis.reflex_scores,
    exercises: exercises || [],
    analysis,
  };
}

// ── Connections ───────────────────────────────────────────────────────────────

export async function generateConnectionCode(childId) {
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const { data, error } = await supabase
    .from('children')
    .update({ connection_code: code })
    .eq('id', childId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function searchChildByCode(code) {
  const { data, error } = await supabase
    .from('children')
    .select('id, first_name, last_name, parent_id')
    .eq('connection_code', code)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function sendConnectionRequest(practitionerId, parentId, childId) {
  // Check if already connected
  const { data: existing } = await supabase
    .from('practitioner_children')
    .select('practitioner_id')
    .eq('practitioner_id', practitionerId)
    .eq('child_id', childId)
    .maybeSingle();
  if (existing) throw Object.assign(new Error('Already connected'), { status: 409 });

  // Check for existing pending request
  const { data: pending } = await supabase
    .from('connection_requests')
    .select('id')
    .eq('practitioner_id', practitionerId)
    .eq('child_id', childId)
    .eq('status', 'pending')
    .maybeSingle();
  if (pending) throw Object.assign(new Error('Request already pending'), { status: 409 });

  const { data, error } = await supabase
    .from('connection_requests')
    .insert([{ practitioner_id: practitionerId, parent_id: parentId, child_id: childId }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getPendingRequests(userId) {
  const { data, error } = await supabase
    .from('connection_requests')
    .select(`
      *,
      practitioner:users!practitioner_id(id, first_name, last_name),
      parent:users!parent_id(id, first_name, last_name),
      child:children(id, first_name, last_name)
    `)
    .or(`parent_id.eq.${userId},practitioner_id.eq.${userId}`)
    .eq('status', 'pending');
  if (error) throw error;
  return data || [];
}

export async function approveConnectionRequest(requestId) {
  const { data, error } = await supabase.rpc('approve_connection_request', { request_id: requestId });
  if (error) throw error;
  return { status: 'approved' };
}

export async function rejectConnectionRequest(requestId) {
  const { error } = await supabase
    .from('connection_requests')
    .update({ status: 'rejected' })
    .eq('id', requestId);
  if (error) throw error;
  return { status: 'rejected' };
}

export async function revokePractitionerAccess(practitionerId, childId) {
  // 1. Remove from practitioner_children junction table
  const { error: e1 } = await supabase
    .from('practitioner_children')
    .delete()
    .match({ practitioner_id: practitionerId, child_id: childId });
  if (e1) throw e1;

  // 2. Also clear ot_id on children table if it points to this practitioner
  //    (so getLearnersByOT legacy path is also cleaned up)
  await supabase
    .from('children')
    .update({ ot_id: null })
    .eq('id', childId)
    .eq('ot_id', practitionerId);

  // 3. Reject any still-pending requests between them
  await supabase
    .from('connection_requests')
    .update({ status: 'rejected' })
    .eq('practitioner_id', practitionerId)
    .eq('child_id', childId)
    .eq('status', 'pending');

  return { status: 'revoked' };
}

export async function saveSessionFeedback(sessionId, rating) {
  const { data, error } = await supabase
    .from('sessions')
    .update({ feedback_rating: rating })
    .eq('id', sessionId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getAtlasProfile(childId) {
  const { data, error } = await supabase
    .from('atlas_profiles')
    .select('*')
    .eq('child_id', childId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ── NestureLearn Content ─────────────────────────────────────────────────────

/** Fetch learn_content, optionally filtered by Atlas tags */
export async function getLearnContent(tags = []) {
  let query = supabase
    .from('learn_content')
    .select('*')
    .order('featured', { ascending: false })
    .order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) throw error;

  if (tags.length > 0) {
    return (data || []).filter(item => 
      item.featured === true || 
      (Array.isArray(item.tags) && item.tags.some(t => tags.includes(t)))
    );
  }
  return data || [];
}

// ── Bidirectional Connection Helpers ─────────────────────────────────────────

/** All active practitioner connections for a child */
export async function getChildActiveConnections(childId) {
  const { data, error } = await supabase
    .from('practitioner_children')
    .select('practitioner_id, granted_at, practitioner:users!practitioner_id(id, first_name, last_name, connection_code, practice_name, avatar_url, is_active)')
    .eq('child_id', childId);
  if (error) throw error;
  return (data || []).filter(c => c.practitioner && c.practitioner.is_active !== false);
}

/** Check if practitioner is already connected to a child */
export async function isConnected(practitionerId, childId) {
  const { data } = await supabase
    .from('practitioner_children')
    .select('practitioner_id')
    .eq('practitioner_id', practitionerId)
    .eq('child_id', childId)
    .maybeSingle();
  return !!data;
}

/** Get or auto-generate a practitioner's own connection code */
export async function getPractitionerCode(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('connection_code, first_name, last_name')
    .eq('id', userId)
    .single();
  if (error) throw error;
  if (data.connection_code) return data;
  const code = 'OT-' + Math.random().toString(36).substring(2, 7).toUpperCase();
  await supabase.from('users').update({ connection_code: code }).eq('id', userId);
  return { ...data, connection_code: code };
}

/** Search a practitioner by their connection_code */
export async function searchPractitionerByCode(code) {
  const { data, error } = await supabase
    .from('users')
    .select('id, first_name, last_name, connection_code')
    .eq('connection_code', code.toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Parent initiates connection request to a practitioner */
export async function parentRequestConnection(parentId, practitionerId, childId) {
  const already = await isConnected(practitionerId, childId);
  if (already) {
    const err = new Error('You are already connected to this specialist.');
    err.status = 409;
    throw err;
  }

  // Check for existing pending or accepted request for this parent and practitioner
  const { data: existing } = await supabase
    .from('connection_requests')
    .select('id, status')
    .eq('practitioner_id', practitionerId)
    .eq('parent_id', parentId)
    .in('status', ['pending', 'accepted'])
    .maybeSingle();

  if (existing) {
    const msg = existing.status === 'accepted'
      ? 'You are already connected to this specialist.'
      : 'A connection request is already pending for this specialist.';
    const err = new Error(msg);
    err.status = 409;
    throw err;
  }

  const { data, error } = await supabase
    .from('connection_requests')
    .insert([{ practitioner_id: practitionerId, parent_id: parentId, child_id: childId, status: 'pending' }])
    .select().single();

  if (error) {
    if (error.code === '23505' || error.message?.includes('unique') || error.message?.includes('duplicate')) {
      const err = new Error('A connection request is already pending for this specialist.');
      err.status = 409;
      throw err;
    }
    throw error;
  }

  return data;
}

// ── Settings: Update & Delete ────────────────────────────────────────────────

/** Update parent's own profile in public.users */
export async function updateUser(userId, updates) {
  const allowed = {};
  if (updates.first_name !== undefined) {
    const sanitized = sanitizeInput(updates.first_name, 50);
    validateName(sanitized, 'First name');
    allowed.first_name = sanitized;
  }
  if (updates.last_name !== undefined) {
    const sanitized = sanitizeInput(updates.last_name, 50);
    if (sanitized !== '') {
      validateName(sanitized, 'Last name');
    }
    allowed.last_name = sanitized;
  }
  if (updates.practice_name !== undefined) allowed.practice_name = sanitizeInput(updates.practice_name, 100);
  if (updates.specialty !== undefined) allowed.specialty = sanitizeInput(updates.specialty, 100);
  if (updates.location !== undefined) allowed.location = sanitizeInput(updates.location, 100);
  if (updates.registration_number !== undefined) {
    const sanitized = sanitizeInput(updates.registration_number, 30);
    if (sanitized !== '' && !/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
      throw new Error('Registration number can only contain letters, numbers, underscores, and hyphens.');
    }
    allowed.registration_number = sanitized;
  }
  if (updates.bio !== undefined) allowed.bio = sanitizeInput(updates.bio, 500);

  const { data, error } = await supabase
    .from('users')
    .update(allowed)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Update a child's profile in children table */
export async function updateChild(childId, updates) {
  const allowed = {};
  if (updates.first_name !== undefined) {
    const sanitized = sanitizeInput(updates.first_name, 50);
    validateName(sanitized, 'First name');
    allowed.first_name = sanitized;
  }
  if (updates.last_name !== undefined) {
    const sanitized = sanitizeInput(updates.last_name, 50);
    if (sanitized !== '') {
      validateName(sanitized, 'Last name');
    }
    allowed.last_name = sanitized;
  }
  if (updates.age !== undefined) {
    if (updates.age !== null && updates.age !== '') {
      allowed.age = validateAgeRange(updates.age);
    } else {
      allowed.age = null;
    }
  }
  if (updates.diagnosis !== undefined) {
    allowed.diagnosis = sanitizeInput(updates.diagnosis, 100);
  }
  if (updates.avatar_url !== undefined) {
    allowed.avatar_url = updates.avatar_url;
  }

  const { data, error } = await supabase
    .from('children')
    .update(allowed)
    .eq('id', childId)
    .select()
    .single();
  if (error) throw error;
  return normaliseChild(data);
}

/** Upload a child avatar to storage and update the database */
export async function uploadChildAvatar(childId, file) {
  const fileExt = file.name.split('.').pop();
  const filePath = `${childId}_${Date.now()}.${fileExt}`;
  
  // Upload to avatars bucket
  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(filePath, file, { upsert: true });
    
  if (uploadError) throw uploadError;

  // Get public URL
  const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
  
  // Update child profile
  return updateChild(childId, { avatar_url: data.publicUrl });
}

/** Delete a child and all associated data (cascading DB + Storage) */
export async function deleteChild(childId) {
  // 0. Cleanup Storage (Avatars and Documents)
  const { data: childData } = await supabase.from('children').select('avatar_url').eq('id', childId).maybeSingle();
  if (childData?.avatar_url) {
    const fileName = childData.avatar_url.split('/').pop();
    if (fileName) {
      await supabase.storage.from('avatars').remove([fileName]).catch(e => console.warn('Avatar delete error:', e));
    }
  }

  const { data: docs } = await supabase.from('documents').select('file_path').eq('child_id', childId);
  if (docs && docs.length > 0) {
    const paths = docs.map(d => d.file_path).filter(Boolean);
    if (paths.length > 0) {
      await supabase.storage.from('patient-documents').remove(paths).catch(e => console.warn('Docs delete error:', e));
    }
  }

  // 1. Delete reflex_scores (via sessions)
  const { data: sessData } = await supabase
    .from('sessions').select('id').eq('learner_id', childId);
  const sessionIds = (sessData || []).map(s => s.id);
  if (sessionIds.length > 0) {
    await supabase.from('reflex_scores').delete().in('session_id', sessionIds);
  }

  // 2. Delete sessions
  await supabase.from('sessions').delete().eq('learner_id', childId);

  // 3. Delete atlas profiles
  await supabase.from('atlas_profiles').delete().eq('child_id', childId);

  // 4. Delete documents
  await supabase.from('documents').delete().eq('child_id', childId);

  // 5. Delete prescriptions
  await supabase.from('prescriptions').delete().eq('learner_id', childId);

  // 6. Delete connections
  await supabase.from('practitioner_children').delete().eq('child_id', childId);
  await supabase.from('connection_requests').delete().eq('child_id', childId);

  // 6b. Delete Ask AI message history
  await supabase.from('ask_ai_messages').delete().eq('child_id', childId);

  // 7. Delete the child row itself
  const { error } = await supabase.from('children').delete().eq('id', childId);
  if (error) throw error;

  return { status: 'deleted' };
}

// ── Admin Functions ──────────────────────────────────────────────────────────

/** Get all parents (users with role='parent') */
export async function getParents() {
  const { data, error } = await supabase
    .from('users')
    .select('id, first_name, last_name, created_at, role, email, is_active')
    .eq('role', 'parent')
    .order('first_name');
  if (error) throw error;
  return (data || []).map(u => ({
    ...u,
    name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Parent',
  }));
}

/** Add a new specialist (practitioner) — creates auth account + public.users row */
export async function addSpecialist(specialistData, adminId) {
  const { email, first_name, last_name, specialty, location, bio, avatar_url, is_featured } = specialistData;

  // Validate inputs
  const cleanEmail = validateEmail(email);
  
  // Generate a secure random temporary password (32 chars)
  const array = new Uint32Array(8);
  window.crypto.getRandomValues(array);
  const tempPassword = Array.from(array, dec => ('0' + dec.toString(16)).substr(-2)).join('') + '!aA1';

  const cleanFirstName = sanitizeInput(first_name, 50);
  validateName(cleanFirstName, 'First name');

  let cleanLastName = '';
  if (last_name) {
    cleanLastName = sanitizeInput(last_name, 50);
    if (cleanLastName !== '') {
      validateName(cleanLastName, 'Last name');
    }
  }

  const cleanSpecialty = specialty ? sanitizeInput(specialty, 100) : 'Occupational Therapist';
  const cleanLocation = location ? sanitizeInput(location, 100) : '';
  const cleanBio = bio ? sanitizeInput(bio, 500) : '';

  // 1. Create auth account via a disposable Supabase client (avoid polluting current session)
  const altSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    },
  });

  const { data: authData, error: authErr } = await altSupabase.auth.signUp({
    email: cleanEmail,
    password: tempPassword,
    options: {
      data: {
        role: 'practitioner',
        first_name: cleanFirstName,
        last_name: cleanLastName,
      },
      emailRedirectTo: `${window.location.origin}/auth/callback?type=invitation`
    },
  });

  if (authErr) {
    if (authErr.message?.includes('Failed to fetch') || authErr.name === 'AuthRetryableFetchError') {
      throw new Error('Network Error: Could not reach Supabase Auth. Check your connection or AdBlocker.');
    }
    throw authErr;
  }

  if (!authData?.user?.id) {
    throw new Error('Specialist auth account creation failed: no user returned.');
  }

  const authUserId = authData.user.id;

  // Give the DB trigger a moment to fire
  await new Promise(r => setTimeout(r, 600));

  // 2. Upsert into public.users with full specialist profile
  const code = 'OT-' + Math.random().toString(36).substring(2, 7).toUpperCase();

  // Set invitation expiry to 15 days from now
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 15);

  const { data, error } = await supabase
    .from('users')
    .upsert([{
      id: authUserId,
      role: 'practitioner',
      first_name: cleanFirstName,
      last_name: cleanLastName,
      practice_name: null,
      specialty: cleanSpecialty,
      location: cleanLocation,
      bio: cleanBio,
      avatar_url: avatar_url || "data:image/svg+xml,%3Csvg viewBox='0 0 1024 1024' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='%23e2e8f0' d='M512 0C229.23 0 0 229.23 0 512s229.23 512 512 512 512-229.23 512-512S794.77 0 512 0z'/%3E%3Cpath fill='%2394a3b8' d='M512 256c-88.37 0-160 71.63-160 160 0 88.37 71.63 160 160 160s160-71.63 160-160c0-88.37-71.63-160-160-160zm0 384c-176.73 0-320 89.54-320 200v32c0 17.67 14.33 32 32 32h576c17.67 0 32-14.33 32-32v-32c0-110.46-143.27-200-320-200z'/%3E%3C/svg%3E",
      is_featured: is_featured || false,
      is_demo: false,
      beta_participant: false,
      connection_code: code,
      must_reset_password: true,
      invitation_expires_at: expiresAt.toISOString(),
      invitation_accepted_at: null,
    }])
    .select()
    .single();

  // Log the action
  const details = `Created and invited specialist: ${cleanFirstName} ${cleanLastName} (${cleanEmail})`;
  await logAdminAction(adminId || authUserId, 'create', authUserId, details);

  return data;
}

/** Delete a specialist completely (including public profile, connections, and auth account) */
export async function deleteSpecialist(specialistId) {
  // Remove practitioner connections first
  await supabase.from('practitioner_children').delete().eq('practitioner_id', specialistId);
  await supabase.from('connection_requests').delete().eq('practitioner_id', specialistId);

  const { error } = await supabase.rpc('delete_auth_user', { target_user_id: specialistId });
  if (error) throw error;
  return { status: 'deleted' };
}

/** Delete a parent and all associated children, data, and auth accounts */
export async function deleteParent(parentId) {
  // Get all children of this parent to clean up storage/sessions/auth
  const { data: children } = await supabase.from('children').select('id, auth_user_id').eq('parent_id', parentId);
  if (children && children.length > 0) {
    for (const child of children) {
      // Re-use deleteChild to clean up storage, sessions, etc.
      await deleteChild(child.id);
      // Clean up child's auth account if it exists
      if (child.auth_user_id) {
        await supabase.rpc('delete_auth_user', { target_user_id: child.auth_user_id });
      }
    }
  }

  // Delete parent from public.users and auth.users via SECURITY DEFINER function
  const { error } = await supabase.rpc('delete_auth_user', { target_user_id: parentId });
  if (error) throw error;
  return { status: 'deleted' };
}

/** Grant complimentary family subscription to a parent */
export async function grantFreeAccess(parentId, adminId) {
  // Check if they already have an active subscription
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('id, status')
    .eq('parent_id', parentId)
    .in('status', ['active', 'trialing'])
    .maybeSingle();

  if (existing) {
    throw new Error('Parent already has an active subscription.');
  }

  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

  const { data, error } = await supabase
    .from('subscriptions')
    .insert([{
      parent_id: parentId,
      stripe_subscription_id: 'comp_' + Math.random().toString(36).substring(2, 10),
      stripe_customer_id: 'comp_user',
      tier: 'family',
      learner_count: 1,
      status: 'active',
      billing_period: 'yearly',
      current_period_end: oneYearFromNow.toISOString(),
      cancel_at_period_end: false
    }])
    .select()
    .single();

  if (error) throw error;

  // Log the action
  await logAdminAction(adminId, 'grant_free_access', parentId, 'Granted 1-year complimentary Family subscription');

  return data;
}

/** Add a new learn content resource */
export async function uploadResourceThumbnail(file) {
  const fileExt = file.name.split('.').pop();
  const fileName = `thumb_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExt}`;

  // Try uploading to 'avatars' bucket (since it's often the default public bucket created)
  const { error } = await supabase.storage
    .from('avatars')
    .upload(fileName, file, { upsert: true });

  if (error) {
    console.error('Storage upload error:', error);
    throw new Error('Download error. Please verify the "avatars" bucket exists and allows anon access.');
  }

  const { data } = supabase.storage.from('avatars').getPublicUrl(fileName);
  return data.publicUrl;
}

/** Add a new learn content resource */
export async function addLearnContent(contentData) {
  const { data, error } = await supabase
    .from('learn_content')
    .insert([{
      title: contentData.title,
      description: contentData.description || null,
      type: contentData.type,
      url: contentData.url,
      thumbnail_url: contentData.thumbnail_url || null,
      duration: contentData.duration || null,
      tags: contentData.tags || [],
      featured: contentData.featured || false,
    }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Delete a learn content resource */
export async function deleteLearnContent(contentId) {
  const { error } = await supabase.from('learn_content').delete().eq('id', contentId);
  if (error) throw error;
  return { status: 'deleted' };
}

/** Get all learn content (for admin — no tag filtering) */
export async function getAllLearnContent() {
  const { data, error } = await supabase
    .from('learn_content')
    .select('*')
    .order('featured', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Fetch connection requests for a given child */
export async function getConnectionRequestsByChild(childId) {
  const { data, error } = await supabase
    .from('connection_requests')
    .select('practitioner_id, status')
    .eq('child_id', childId);
  if (error) throw error;
  return data || [];
}

/** Get all admin audit logs */
export async function getAdminAuditLogs() {
  const { data, error } = await supabase
    .from('admin_audit_logs')
    .select(`
      *,
      admin:users!admin_id(first_name, last_name)
    `)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Create an admin audit log entry */
export async function logAdminAction(adminId, action, targetUserId, details = '') {
  const { data, error } = await supabase
    .from('admin_audit_logs')
    .insert([{
      admin_id: adminId,
      action,
      target_user_id: targetUserId,
      details,
    }])
    .select()
    .single();
  if (error) {
    console.error('[logAdminAction] Error writing audit log:', error.message);
  }
  return data;
}

/** Update specialist details (from admin panel) */
export async function updateSpecialistProfile(specialistId, updates, adminId) {
  const allowed = {
    first_name: updates.first_name,
    last_name: updates.last_name,
    specialty: updates.specialty,
    location: updates.location,
    bio: updates.bio,
    is_featured: updates.is_featured,
  };

  const { data, error } = await supabase
    .from('users')
    .update(allowed)
    .eq('id', specialistId)
    .select()
    .single();

  if (error) throw error;

  // Log the action
  const details = `Edited specialist: ${updates.first_name || ''} ${updates.last_name || ''}. Fields: specialty=${updates.specialty || ''}, location=${updates.location || ''}, featured=${updates.is_featured ? 'true' : 'false'}`;
  await logAdminAction(adminId, 'edit', specialistId, details);

  return data;
}

/** Toggle active/deactive status of a specialist */
export async function setSpecialistActiveStatus(specialistId, isActive, adminId) {
  const { data, error } = await supabase
    .from('users')
    .update({ is_active: isActive })
    .eq('id', specialistId)
    .select()
    .single();

  if (error) throw error;

  // If deactivating, reject pending connection requests for this specialist
  if (!isActive) {
    await supabase
      .from('connection_requests')
      .update({ status: 'rejected' })
      .eq('practitioner_id', specialistId)
      .eq('status', 'pending');
  }

  // Log the action
  const actionName = isActive ? 'reactivate' : 'deactivate';
  const details = `${isActive ? 'Reactivated' : 'Deactivated'} specialist: ${data.first_name || ''} ${data.last_name || ''} (${data.email || ''})`;
  await logAdminAction(adminId, actionName, specialistId, details);

  return data;
}

/** Trigger a password reset email for a specialist and log the action */
export async function resetSpecialistPassword(specialistId, adminId) {
  // 1. Fetch the user's email
  const { data: user, error: fetchError } = await supabase
    .from('users')
    .select('email, first_name, last_name')
    .eq('id', specialistId)
    .single();

  if (fetchError) throw fetchError;
  if (!user?.email) throw new Error('User email not found.');

  // 2. Trigger SMTP reset password email
  const { error: resetError } = await supabase.auth.resetPasswordForEmail(user.email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });

  if (resetError) throw resetError;

  // 3. Log the action
  const details = `Sent password reset email to: ${user.first_name || ''} ${user.last_name || ''} (${user.email})`;
  await logAdminAction(adminId, 'reset_password', specialistId, details);

  return { status: 'ok' };
}

/** Resend an invitation email to a specialist and extend expiry */
export async function resendInvitation(specialistId, adminId) {
  const { data: user, error: fetchError } = await supabase
    .from('users')
    .select('email, first_name, last_name, invitation_accepted_at')
    .eq('id', specialistId)
    .single();

  if (fetchError) throw fetchError;
  if (!user?.email) throw new Error('User email not found.');
  if (user.invitation_accepted_at) throw new Error('User has already accepted their invitation.');

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 15);

  const { error: updateError } = await supabase
    .from('users')
    .update({ 
      invitation_expires_at: expiresAt.toISOString(),
      must_reset_password: true 
    })
    .eq('id', specialistId);

  if (updateError) throw updateError;

  const { error: resetError } = await supabase.auth.resetPasswordForEmail(user.email, {
    redirectTo: `${window.location.origin}/auth/callback?type=invitation`,
  });

  if (resetError) throw resetError;

  const details = `Resent invitation to: ${user.first_name || ''} ${user.last_name || ''} (${user.email})`;
  await logAdminAction(adminId, 'resend_invitation', specialistId, details);

  return { status: 'ok' };
}

/** Accept an invitation (called after first password reset) */
export async function acceptInvitation(userId) {
  const { data, error } = await supabase.rpc('accept_invitation', { user_id: userId });

  if (error) throw error;
  return { status: 'ok', data };
}

/** Check if a specialist's invitation is pending, expired, or accepted */
export async function checkInvitationStatus(specialistId) {
  const { data: user, error } = await supabase
    .from('users')
    .select('invitation_accepted_at, invitation_expires_at, must_reset_password')
    .eq('id', specialistId)
    .single();

  if (error) throw error;

  if (user.invitation_accepted_at || !user.must_reset_password) return 'accepted';
  if (user.invitation_expires_at && new Date(user.invitation_expires_at) < new Date()) return 'expired';
  return 'pending';
}


