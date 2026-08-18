/**
 * localDB.js — Nesture AI in-browser persistence layer
 * Replaces the Python backend's CSV store + all API routes.
 * Uses IndexedDB for persistent local storage. Seeds demo data on first load.
 */

const DB_NAME = 'nesture-ai-db';
const DB_VERSION = 1;

const STORES = {
  USERS: 'users',
  LEARNERS: 'learners',
  SESSIONS: 'sessions',
  GESTURES: 'gestures',
  REFLEX_SCORES: 'reflex_scores',
  EXERCISES: 'exercises',
  PRESCRIPTIONS: 'prescriptions',
};

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      Object.values(STORES).forEach(name => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => { _dbPromise = null; reject(e.target.error); };
  });
  return _dbPromise;
}

async function getAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function getById(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function getWhere(storeName, filter = {}) {
  const all = await getAll(storeName);
  return all.filter(record =>
    Object.entries(filter).every(([k, v]) => record[k] === v)
  );
}

async function putRecord(storeName, record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

async function deleteRecord(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function putMany(storeName, records) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    records.forEach(r => store.put(r));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

// ── Seed data (mirrors backend/app/core/data_init.py) ─────────────────────────

const SEED_USERS = [
  { id: 'user-parent-001', email: 'jennifer@example.com', password: 'password123', role: 'parent',  name: 'Jennifer Chen' },
  { id: 'user-ot-001',     email: 'sarah@example.com',    password: 'password123', role: 'ot',      name: 'Sarah Williams' },
  { id: 'user-learner-001',email: 'akhil@example.com',    password: 'password123', role: 'learner', name: 'Akhil M.' },
  { id: 'user-parent-002', email: 'david@example.com',    password: 'password123', role: 'parent',  name: 'David Park' },
  { id: 'user-learner-002',email: 'liam@example.com',     password: 'password123', role: 'learner', name: 'Liam Park' },
];

const SEED_LEARNERS = [
  { id: 'learner-001', name: 'Akhil M.',   age: '22', diagnosis: 'ASD, CAPD, Mitochondrial Disease, Generalised Dyspraxia', parent_id: 'user-parent-001', ot_id: 'user-ot-001', avatar_color: '#10b981' },
  { id: 'learner-002', name: 'Liam Park',  age: '9',  diagnosis: 'Non-speaking autism, sensory processing disorder',         parent_id: 'user-parent-002', ot_id: 'user-ot-001', avatar_color: '#E8841A' },
  { id: 'learner-003', name: 'Lily Chen',  age: '8',  diagnosis: 'ASD — High support needs, limited verbal output',          parent_id: 'user-parent-001', ot_id: 'user-ot-001', avatar_color: '#F472B6' },
  { id: 'learner-004', name: 'Marcus Chen',age: '12', diagnosis: 'ASD — Moderate support needs, emerging AAC user',          parent_id: 'user-parent-001', ot_id: 'user-ot-001', avatar_color: '#6366F1' },
  { id: 'learner-005', name: 'Alex Chen',  age: '10', diagnosis: 'ASD — Sensory processing difficulties, motor coordination', parent_id: 'user-parent-001', ot_id: 'user-ot-001', avatar_color: '#F59E0B' },
];

const SEED_EXERCISES = [
  { id: 'ex-001', name: 'Starfish Stretch',       target_reflex: 'Moro',          description: 'Lie flat, spread arms and legs wide. Hold 10 seconds. Repeat 5 times.',                        duration_minutes: '5',  video_url: '/videos/starfish-stretch.mp4',    difficulty_level: 'easy' },
  { id: 'ex-002', name: 'Deep Pressure Massage',  target_reflex: 'Moro',          description: 'Apply firm pressure to shoulders and arms. Use a weighted blanket.',                          duration_minutes: '10', video_url: '/videos/deep-pressure.mp4',       difficulty_level: 'easy' },
  { id: 'ex-003', name: 'Slow Swinging',          target_reflex: 'Moro',          description: 'Sit in a hammock swing. Sway side to side slowly for 5 minutes.',                             duration_minutes: '5',  video_url: '/videos/slow-swinging.mp4',       difficulty_level: 'easy' },
  { id: 'ex-004', name: 'Cross-Crawl Patterns',   target_reflex: 'ATNR',          description: 'Touch right hand to left knee alternately while marching in place.',                          duration_minutes: '5',  video_url: '/videos/cross-crawl.mp4',         difficulty_level: 'medium' },
  { id: 'ex-005', name: 'Bilateral Clapping',     target_reflex: 'ATNR',          description: 'Clap hands at midline, then clap each hand to opposite shoulder.',                            duration_minutes: '3',  video_url: '/videos/bilateral-clapping.mp4',  difficulty_level: 'easy' },
  { id: 'ex-006', name: 'Angels in Snow',         target_reflex: 'ATNR',          description: 'Lie on floor, move arms and legs simultaneously like a snow angel.',                          duration_minutes: '5',  video_url: '/videos/angels-snow.mp4',         difficulty_level: 'medium' },
  { id: 'ex-007', name: 'Cat-Cow Yoga',           target_reflex: 'STNR',          description: 'On hands and knees, alternate between arching and rounding the back.',                        duration_minutes: '5',  video_url: '/videos/cat-cow.mp4',             difficulty_level: 'easy' },
  { id: 'ex-008', name: 'Tabletop Rocking',       target_reflex: 'STNR',          description: 'In tabletop position, rock forward and backward slowly.',                                     duration_minutes: '5',  video_url: '/videos/tabletop-rocking.mp4',    difficulty_level: 'easy' },
  { id: 'ex-009', name: 'Head Lifts (Prone)',     target_reflex: 'TLR',           description: 'Lie on tummy, lift head slowly keeping chin tucked. Hold 5 seconds.',                         duration_minutes: '5',  video_url: '/videos/head-lifts-prone.mp4',    difficulty_level: 'medium' },
  { id: 'ex-010', name: 'Superman Pose',          target_reflex: 'TLR',           description: 'Lie on tummy, extend arms and legs. Lift all four off the ground.',                           duration_minutes: '3',  video_url: '/videos/superman-pose.mp4',       difficulty_level: 'medium' },
  { id: 'ex-011', name: 'Snow Angel Movements',   target_reflex: 'Spinal Galant', description: 'Stand and make snow angel arm movements, focusing on trunk rotation.',                        duration_minutes: '5',  video_url: '/videos/snow-angel.mp4',          difficulty_level: 'easy' },
  { id: 'ex-012', name: 'Core Ball Rolling',      target_reflex: 'Spinal Galant', description: 'Roll a therapy ball along both sides of the spine gently.',                                  duration_minutes: '5',  video_url: '/videos/ball-rolling.mp4',        difficulty_level: 'easy' },
  { id: 'ex-013', name: 'Squeeze Ball',           target_reflex: 'Palmar Grasp',  description: 'Squeeze a therapy ball 10 times each hand. Focus on full finger engagement.',                duration_minutes: '3',  video_url: '/videos/squeeze-ball.mp4',        difficulty_level: 'easy' },
  { id: 'ex-014', name: 'Playdough Manipulation', target_reflex: 'Palmar Grasp',  description: 'Roll, pinch, and shape playdough. Focus on pincer grip and finger isolation.',               duration_minutes: '10', video_url: '/videos/playdough.mp4',           difficulty_level: 'easy' },
  { id: 'ex-015', name: 'Tweezers Pick-up',       target_reflex: 'Palmar Grasp',  description: 'Use tweezers to pick up small objects (beads, pom-poms) into a cup.',                       duration_minutes: '5',  video_url: '/videos/tweezers.mp4',            difficulty_level: 'medium' },
];

// Maya: 10 sessions, improving trend (base date 2026-01-10, every 4 days)
const MAYA_SESSIONS_RAW = [
  { acc: 0.62, rt: 4200, pg: 22, fg: 18, sk: 5, sm: 0.58, lpi: 52, fi: 0.30 },
  { acc: 0.65, rt: 4000, pg: 24, fg: 16, sk: 4, sm: 0.61, lpi: 55, fi: 0.28 },
  { acc: 0.68, rt: 3800, pg: 26, fg: 14, sk: 4, sm: 0.64, lpi: 58, fi: 0.26 },
  { acc: 0.70, rt: 3600, pg: 28, fg: 13, sk: 3, sm: 0.67, lpi: 61, fi: 0.24 },
  { acc: 0.72, rt: 3400, pg: 30, fg: 11, sk: 3, sm: 0.70, lpi: 65, fi: 0.22 },
  { acc: 0.75, rt: 3200, pg: 32, fg: 10, sk: 2, sm: 0.73, lpi: 68, fi: 0.20 },
  { acc: 0.78, rt: 3000, pg: 34, fg:  9, sk: 2, sm: 0.76, lpi: 72, fi: 0.18 },
  { acc: 0.80, rt: 2800, pg: 36, fg:  8, sk: 2, sm: 0.79, lpi: 76, fi: 0.16 },
  { acc: 0.83, rt: 2600, pg: 38, fg:  7, sk: 1, sm: 0.82, lpi: 80, fi: 0.14 },
  { acc: 0.84, rt: 2500, pg: 40, fg:  6, sk: 1, sm: 0.85, lpi: 84, fi: 0.12 },
];
const MAYA_REFLEXES = [
  [38,45,55,60,50,42],[42,48,57,62,52,45],[46,52,59,63,54,48],[50,56,61,65,56,52],
  [54,60,63,66,58,55],[58,64,65,67,60,58],[62,68,67,68,62,62],[66,72,69,70,64,65],
  [70,76,71,72,66,68],[74,79,73,74,68,71],
];

// Liam: 5 sessions, needs attention (every 5 days)
const LIAM_SESSIONS_RAW = [
  { acc: 0.40, rt: 7500, pg: 14, fg: 22, sk: 8, sm: 0.35, lpi: 30, fi: 0.72 },
  { acc: 0.38, rt: 7800, pg: 13, fg: 23, sk: 9, sm: 0.32, lpi: 28, fi: 0.72 },
  { acc: 0.42, rt: 7200, pg: 15, fg: 21, sk: 8, sm: 0.37, lpi: 32, fi: 0.72 },
  { acc: 0.39, rt: 7600, pg: 14, fg: 22, sk: 9, sm: 0.34, lpi: 29, fi: 0.72 },
  { acc: 0.41, rt: 7400, pg: 14, fg: 21, sk: 8, sm: 0.36, lpi: 31, fi: 0.72 },
];
const LIAM_REFLEXES = [
  [22,28,30,25,20,18],[20,26,28,23,18,16],[24,30,32,27,22,20],[21,27,29,24,19,17],[23,29,31,26,21,19],
];

// Lily (learner-003, age 8): 6 sessions, slow-but-steady progress (easy level)
const LILY_SESSIONS_RAW = [
  { acc: 0.42, rt: 6800, pg: 10, fg: 18, sk: 6, sm: 0.40, lpi: 36, fi: 0.65 },
  { acc: 0.45, rt: 6500, pg: 11, fg: 17, sk: 5, sm: 0.43, lpi: 39, fi: 0.62 },
  { acc: 0.48, rt: 6200, pg: 12, fg: 16, sk: 5, sm: 0.46, lpi: 42, fi: 0.60 },
  { acc: 0.50, rt: 5900, pg: 13, fg: 15, sk: 4, sm: 0.49, lpi: 45, fi: 0.57 },
  { acc: 0.53, rt: 5600, pg: 14, fg: 14, sk: 4, sm: 0.52, lpi: 48, fi: 0.54 },
  { acc: 0.55, rt: 5400, pg: 15, fg: 13, sk: 3, sm: 0.55, lpi: 51, fi: 0.51 },
];
const LILY_REFLEXES = [
  [20,24,28,22,18,16],[22,26,30,24,20,18],[24,28,32,26,22,20],
  [26,30,34,28,24,22],[28,32,36,30,26,24],[30,34,38,32,28,26],
];

// Marcus (learner-004, age 12): 8 sessions, good progress with AAC support (medium)
const MARCUS_SESSIONS_RAW = [
  { acc: 0.55, rt: 5200, pg: 18, fg: 18, sk: 4, sm: 0.52, lpi: 48, fi: 0.50 },
  { acc: 0.58, rt: 4900, pg: 20, fg: 16, sk: 4, sm: 0.55, lpi: 52, fi: 0.46 },
  { acc: 0.62, rt: 4600, pg: 22, fg: 14, sk: 3, sm: 0.59, lpi: 56, fi: 0.42 },
  { acc: 0.65, rt: 4300, pg: 24, fg: 13, sk: 3, sm: 0.62, lpi: 60, fi: 0.38 },
  { acc: 0.69, rt: 4000, pg: 26, fg: 11, sk: 2, sm: 0.66, lpi: 64, fi: 0.34 },
  { acc: 0.72, rt: 3700, pg: 28, fg: 10, sk: 2, sm: 0.69, lpi: 68, fi: 0.30 },
  { acc: 0.74, rt: 3500, pg: 29, fg:  9, sk: 2, sm: 0.72, lpi: 71, fi: 0.27 },
  { acc: 0.76, rt: 3300, pg: 30, fg:  8, sk: 1, sm: 0.74, lpi: 74, fi: 0.24 },
];
const MARCUS_REFLEXES = [
  [32,38,42,36,30,28],[36,42,46,40,34,32],[40,46,50,44,38,36],[44,50,54,48,42,40],
  [48,54,57,52,46,44],[52,58,60,55,49,48],[55,61,63,57,52,51],[58,64,66,60,54,53],
];

// Alex (learner-005, age 10): 7 sessions, moderate progress, sensory challenges
const ALEX_SESSIONS_RAW = [
  { acc: 0.50, rt: 5800, pg: 15, fg: 16, sk: 5, sm: 0.47, lpi: 43, fi: 0.58 },
  { acc: 0.53, rt: 5500, pg: 16, fg: 15, sk: 5, sm: 0.50, lpi: 46, fi: 0.55 },
  { acc: 0.56, rt: 5200, pg: 18, fg: 14, sk: 4, sm: 0.53, lpi: 50, fi: 0.52 },
  { acc: 0.59, rt: 4900, pg: 19, fg: 13, sk: 4, sm: 0.56, lpi: 53, fi: 0.48 },
  { acc: 0.62, rt: 4600, pg: 21, fg: 12, sk: 3, sm: 0.59, lpi: 57, fi: 0.44 },
  { acc: 0.65, rt: 4300, pg: 22, fg: 11, sk: 3, sm: 0.62, lpi: 60, fi: 0.40 },
  { acc: 0.68, rt: 4100, pg: 23, fg: 10, sk: 2, sm: 0.65, lpi: 63, fi: 0.37 },
];
const ALEX_REFLEXES = [
  [28,34,38,32,26,24],[31,37,41,35,29,27],[34,40,44,38,32,30],
  [37,43,47,41,35,33],[40,46,50,44,38,36],[43,49,53,47,41,39],[46,52,56,50,44,42],
];

const REFLEX_NAMES = ['Moro', 'ATNR', 'STNR', 'TLR', 'Spinal Galant', 'Palmar Grasp'];

function buildSessions() {
  const sessions = [];
  const reflexScores = [];
  const baseDate = new Date('2026-01-10T00:00:00Z');

  // Maya sessions
  MAYA_SESSIONS_RAW.forEach((s, i) => {
    const d = new Date(baseDate.getTime() + i * 4 * 86400000);
    const end = new Date(d.getTime() + (15 + i) * 60000);
    const total = s.pg + s.fg + s.sk;
    const invalid = i % 3; // small random-ish value
    const midline = 8 + (i % 8);
    const session = {
      id: `session-maya-${String(i + 1).padStart(3, '0')}`,
      learner_id: 'learner-001',
      start_time: d.toISOString(),
      end_time: end.toISOString(),
      duration_seconds: String((15 + i) * 60),
      difficulty: i < 5 ? 'medium' : 'hard',
      scenario: 'happy_path',
      total_attempts: String(total),
      perfect_grabs: String(s.pg),
      failed_grabs: String(s.fg),
      skipped: String(s.sk),
      invalid: String(invalid),
      accuracy_score: String(s.acc.toFixed(3)),
      avg_response_time_ms: String(s.rt),
      trajectory_smoothness: String(s.sm.toFixed(3)),
      fatigue_index: String(s.fi.toFixed(3)),
      midline_crossings: String(midline),
      lpi_score: String(s.lpi),
    };
    sessions.push(session);
    MAYA_REFLEXES[i].forEach((score, j) => {
      const conf = score < 50 ? 'High' : (score < 65 ? 'Medium' : 'Low');
      reflexScores.push({
        id: `reflex-maya-${String(i + 1).padStart(3, '0')}-${j}`,
        session_id: session.id,
        learner_id: 'learner-001',
        reflex_name: REFLEX_NAMES[j],
        confidence_level: conf,
        score: String(score),
        indicators_found: String(Math.max(0, 3 - (j % 3))),
        created_at: d.toISOString(),
      });
    });
  });

  // Liam sessions
  LIAM_SESSIONS_RAW.forEach((s, i) => {
    const d = new Date(baseDate.getTime() + i * 5 * 86400000);
    const end = new Date(d.getTime() + 12 * 60000);
    const total = s.pg + s.fg + s.sk;
    const session = {
      id: `session-liam-${String(i + 1).padStart(3, '0')}`,
      learner_id: 'learner-002',
      start_time: d.toISOString(),
      end_time: end.toISOString(),
      duration_seconds: '720',
      difficulty: 'easy',
      scenario: 'alternate_path',
      total_attempts: String(total),
      perfect_grabs: String(s.pg),
      failed_grabs: String(s.fg),
      skipped: String(s.sk),
      invalid: '3',
      accuracy_score: String(s.acc.toFixed(3)),
      avg_response_time_ms: String(s.rt),
      trajectory_smoothness: String(s.sm.toFixed(3)),
      fatigue_index: String(s.fi),
      midline_crossings: '2',
      lpi_score: String(s.lpi),
    };
    sessions.push(session);
    LIAM_REFLEXES[i].forEach((score, j) => {
      const conf = score < 25 ? 'High' : (score < 35 ? 'Medium' : 'Low');
      reflexScores.push({
        id: `reflex-liam-${String(i + 1).padStart(3, '0')}-${j}`,
        session_id: session.id,
        learner_id: 'learner-002',
        reflex_name: REFLEX_NAMES[j],
        confidence_level: conf,
        score: String(score),
        indicators_found: String(score < 25 ? 3 : 2),
        created_at: d.toISOString(),
      });
    });
  });

  // Helper to build sessions for Jennifer's children
  function buildChildSessions(raw, reflexData, learnerId, prefix, difficulty, intervalDays) {
    raw.forEach((s, i) => {
      const d = new Date(baseDate.getTime() + i * intervalDays * 86400000);
      const end = new Date(d.getTime() + (12 + i * 2) * 60000);
      const total = s.pg + s.fg + s.sk;
      const session = {
        id: `session-${prefix}-${String(i + 1).padStart(3, '0')}`,
        learner_id: learnerId,
        start_time: d.toISOString(),
        end_time: end.toISOString(),
        duration_seconds: String((12 + i * 2) * 60),
        difficulty,
        scenario: 'happy_path',
        total_attempts: String(total),
        perfect_grabs: String(s.pg),
        failed_grabs: String(s.fg),
        skipped: String(s.sk),
        invalid: String(i % 2),
        accuracy_score: String(s.acc.toFixed(3)),
        avg_response_time_ms: String(s.rt),
        trajectory_smoothness: String(s.sm.toFixed(3)),
        fatigue_index: String(s.fi.toFixed(2)),
        midline_crossings: String(4 + i),
        lpi_score: String(s.lpi),
      };
      sessions.push(session);
      reflexData[i].forEach((score, j) => {
        const conf = score < 35 ? 'High' : (score < 55 ? 'Medium' : 'Low');
        reflexScores.push({
          id: `reflex-${prefix}-${String(i + 1).padStart(3, '0')}-${j}`,
          session_id: session.id,
          learner_id: learnerId,
          reflex_name: REFLEX_NAMES[j],
          confidence_level: conf,
          score: String(score),
          indicators_found: String(score < 35 ? 3 : score < 55 ? 2 : 1),
          created_at: d.toISOString(),
        });
      });
    });
  }

  buildChildSessions(LILY_SESSIONS_RAW,   LILY_REFLEXES,   'learner-003', 'lily',   'easy',   4);
  buildChildSessions(MARCUS_SESSIONS_RAW, MARCUS_REFLEXES, 'learner-004', 'marcus', 'medium', 3);
  buildChildSessions(ALEX_SESSIONS_RAW,   ALEX_REFLEXES,   'learner-005', 'alex',   'medium', 4);

  return { sessions, reflexScores };
}

async function _seedIfEmpty() {
  const existing = await getAll(STORES.USERS);
  if (existing.length > 0) return; // already seeded

  console.log('[NestureAI] Seeding demo data into IndexedDB…');
  const { sessions, reflexScores } = buildSessions();

  await Promise.all([
    putMany(STORES.USERS, SEED_USERS),
    putMany(STORES.LEARNERS, SEED_LEARNERS),
    putMany(STORES.EXERCISES, SEED_EXERCISES),
    putMany(STORES.SESSIONS, sessions),
    putMany(STORES.REFLEX_SCORES, reflexScores),
  ]);
  console.log('[NestureAI] ✅ Demo data seeded');
}

// ── Public initialiser (call once at app start) ───────────────────────────────
export async function initDB() {
  await openDB();
  await _seedIfEmpty();
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function getDemoAccounts() {
  return [
    { role: 'learner', name: 'Akhil M.',       email: 'akhil@example.com',    password: 'password123' },
    { role: 'parent',  name: 'Jennifer Chen',  email: 'jennifer@example.com', password: 'password123' },
    { role: 'ot',      name: 'Sarah Williams', email: 'sarah@example.com',    password: 'password123' },
  ];
}

/** Bridge: get local IndexedDB user record by email (used to map Supabase UUID → local ID) */
export async function getUserByEmail(email) {
  const users = await getWhere(STORES.USERS, { email });
  return users[0] || null;
}

export async function verifyLogin(email, password) {
  const users = await getWhere(STORES.USERS, { email });
  if (!users.length) throw Object.assign(new Error('Invalid email or password'), { status: 401 });
  const user = users[0];
  if (user.password !== password) throw Object.assign(new Error('Invalid email or password'), { status: 401 });

  // Resolve learner_id for learner accounts
  let learner_id = null;
  if (user.role === 'learner') {
    const learners = await getAll(STORES.LEARNERS);
    const learner = learners.find(l => l.name === user.name);
    if (learner) learner_id = learner.id;
  }

  return { user_id: user.id, name: user.name, role: user.role, learner_id };
}

// ── Learners ──────────────────────────────────────────────────────────────────
export async function getLearners() {
  return getAll(STORES.LEARNERS);
}

export async function getLearner(learnerId) {
  const learner = await getById(STORES.LEARNERS, learnerId);
  if (!learner) throw Object.assign(new Error('Learner not found'), { status: 404 });
  return learner;
}

export async function getLearnersByParent(parentId) {
  return getWhere(STORES.LEARNERS, { parent_id: parentId });
}

export async function getLearnersByOT(otId) {
  return getWhere(STORES.LEARNERS, { ot_id: otId });
}

// ── Sessions ──────────────────────────────────────────────────────────────────
export async function startSession(learnerId, difficulty) {
  const session = {
    id: generateId(),
    learner_id: learnerId,
    start_time: nowIso(),
    end_time: '',
    duration_seconds: '',
    difficulty,
    scenario: '',
    total_attempts: '0',
    perfect_grabs: '0',
    failed_grabs: '0',
    skipped: '0',
    invalid: '0',
    accuracy_score: '0',
    avg_response_time_ms: '0',
    trajectory_smoothness: '0',
    fatigue_index: '0',
    midline_crossings: '0',
    lpi_score: '0',
  };
  await putRecord(STORES.SESSIONS, session);
  return { session_id: session.id };
}

export async function endSession(sessionId, gestures) {
  const { analyseSession } = await import('./aiEngine.js');

  const session = await getById(STORES.SESSIONS, sessionId);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });

  const endTime = new Date();
  const startTime = new Date(session.start_time);
  const duration = Math.round((endTime - startTime) / 1000);

  if (!gestures || gestures.length === 0) {
    const updated = { ...session, end_time: endTime.toISOString(), duration_seconds: String(duration), scenario: 'Warmup Only', lpi_score: '0' };
    await putRecord(STORES.SESSIONS, updated);
    return { session_id: sessionId, narrative: 'No motor patterns recorded during this session.', lpi_score: 0, scenario: 'Warmup Only', reflex_scores: [], recommendations: [], metrics: {} };
  }

  const total = gestures.length;
  const perfect  = gestures.filter(g => g.classification === 'Perfect').length;
  const failed   = gestures.filter(g => g.classification === 'Failed').length;
  const skipped  = gestures.filter(g => g.classification === 'Skipped').length;
  const invalid  = gestures.filter(g => g.classification === 'Invalid').length;
  const accuracy = perfect / total;
  const avgRt    = gestures.reduce((s, g) => s + (g.response_time_ms || 0), 0) / total;
  const avgSmooth= gestures.reduce((s, g) => s + (g.trajectory_smoothness || 0), 0) / total;
  const avgFatigue=gestures.reduce((s, g) => s + (g.fatigue_indicator || 0), 0) / total;
  const midline  = gestures.filter(g => g.midline_crossing).length;
  const avgHhc   = gestures.reduce((s, g) => s + (g.head_hand_coupling || 0.5), 0) / total;

  // Save gestures
  const gestureRecords = gestures.map((g, idx) => ({
    id: `${sessionId}-g${idx}`,
    session_id: sessionId,
    timestamp: nowIso(),
    target_letter: g.target_letter || '',
    classification: g.classification || '',
    response_time_ms: String(g.response_time_ms || 0),
    trajectory_smoothness: String(g.trajectory_smoothness || 0),
    midline_crossing: String(g.midline_crossing || false),
    head_hand_coupling: String(g.head_hand_coupling || 0.5),
    fatigue_indicator: String(g.fatigue_indicator || 0),
  }));
  await putMany(STORES.GESTURES, gestureRecords);

  const updatedSession = {
    ...session,
    end_time: endTime.toISOString(),
    duration_seconds: String(duration),
    total_attempts: String(total),
    perfect_grabs: String(perfect),
    failed_grabs: String(failed),
    skipped: String(skipped),
    invalid: String(invalid),
    accuracy_score: String(accuracy.toFixed(4)),
    avg_response_time_ms: String(avgRt.toFixed(1)),
    trajectory_smoothness: String(avgSmooth.toFixed(4)),
    fatigue_index: String(avgFatigue.toFixed(4)),
    midline_crossings: String(midline),
    head_hand_coupling: String(avgHhc.toFixed(4)),
  };

  // Run AI engine
  const sessionDataForEngine = { ...updatedSession, head_hand_coupling: String(avgHhc) };
  const analysis = analyseSession(sessionDataForEngine, gestures);

  // Save reflex scores
  const reflexRecords = analysis.reflex_scores.map((rs, idx) => ({
    id: `${sessionId}-r${idx}`,
    session_id: sessionId,
    learner_id: session.learner_id,
    reflex_name: rs.reflex,
    confidence_level: rs.confidence,
    score: String(rs.score),
    indicators_found: String(rs.indicators_found.length),
    created_at: endTime.toISOString(),
  }));
  await putMany(STORES.REFLEX_SCORES, reflexRecords);

  // Update session with LPI + scenario
  const finalSession = { ...updatedSession, lpi_score: String(analysis.lpi_score), scenario: analysis.scenario };
  await putRecord(STORES.SESSIONS, finalSession);

  return {
    session_id: sessionId,
    narrative: analysis.narrative,
    lpi_score: analysis.lpi_score,
    scenario: analysis.scenario,
    reflex_scores: analysis.reflex_scores,
    recommendations: analysis.recommendations,
    metrics: analysis.metrics,
  };
}

export async function getSessions(learnerId, limit = 20) {
  const all = await getWhere(STORES.SESSIONS, { learner_id: learnerId });
  const valid = all.filter(s => s.end_time && s.end_time.trim());
  valid.sort((a, b) => (b.start_time || '').localeCompare(a.start_time || ''));
  return valid.slice(0, limit);
}

export async function getSession(sessionId) {
  const session = await getById(STORES.SESSIONS, sessionId);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
  return session;
}

export async function getSessionAnalysis(sessionId) {
  const { analyseSession } = await import('./aiEngine.js');
  const session = await getById(STORES.SESSIONS, sessionId);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
  const gestures = await getWhere(STORES.GESTURES, { session_id: sessionId });
  const analysis = analyseSession(session, gestures);
  return { session_id: sessionId, ...analysis };
}

// ── Reflexes ──────────────────────────────────────────────────────────────────
const REFLEX_NAMES_LIST = ['Moro', 'ATNR', 'STNR', 'TLR', 'Spinal Galant', 'Palmar Grasp'];

export async function getReflexSummary(learnerId) {
  const all = await getWhere(STORES.REFLEX_SCORES, { learner_id: learnerId });
  const result = [];
  for (const rname of REFLEX_NAMES_LIST) {
    const rscores = all.filter(s => s.reflex_name === rname);
    rscores.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    if (!rscores.length) continue;
    const latest = rscores[rscores.length - 1];
    let trend = 'stable';
    if (rscores.length >= 2) {
      const prev = parseFloat(rscores[rscores.length - 2].score || 50);
      const curr = parseFloat(latest.score || 50);
      trend = curr > prev + 2 ? 'improving' : (curr < prev - 2 ? 'declining' : 'stable');
    }
    result.push({ ...latest, trend });
  }
  return result;
}

export async function getLatestReflexes(learnerId) {
  const all = await getWhere(STORES.REFLEX_SCORES, { learner_id: learnerId });
  all.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const latest = {};
  for (const s of all) {
    if (!latest[s.reflex_name]) latest[s.reflex_name] = s;
  }
  return Object.values(latest);
}

// ── Exercises ─────────────────────────────────────────────────────────────────
export async function getExercises(reflex = null) {
  const all = await getAll(STORES.EXERCISES);
  if (reflex) return all.filter(e => e.target_reflex?.toLowerCase() === reflex.toLowerCase());
  return all;
}

export async function getExercise(exerciseId) {
  const ex = await getById(STORES.EXERCISES, exerciseId);
  if (!ex) throw Object.assign(new Error('Exercise not found'), { status: 404 });
  return ex;
}

export async function prescribeExercise(learnerId, exerciseId, sessionId = '', notes = '') {
  const record = {
    id: generateId(),
    learner_id: learnerId,
    ot_id: '',
    exercise_id: exerciseId,
    session_id: sessionId,
    notes,
    status: 'active',
    assigned_at: nowIso(),
  };
  await putRecord(STORES.PRESCRIPTIONS, record);
  return { status: 'ok', prescription_id: record.id };
}

export async function getPrescriptions(learnerId) {
  const prescriptions = await getWhere(STORES.PRESCRIPTIONS, { learner_id: learnerId });
  const exercises = await getAll(STORES.EXERCISES);
  const exMap = Object.fromEntries(exercises.map(e => [e.id, e]));
  return prescriptions.map(p => ({ ...p, exercise: exMap[p.exercise_id] || {} }));
}

export async function getPrescriptionsByExercise(exerciseId) {
  const prescriptions = await getWhere(STORES.PRESCRIPTIONS, { exercise_id: exerciseId });
  const learners = await getAll(STORES.LEARNERS);
  const lMap = Object.fromEntries(learners.map(l => [l.id, l]));
  return prescriptions.map(p => ({ ...p, learner: lMap[p.learner_id] || {} }));
}

export async function getAllPrescriptions() {
  const prescriptions = await getAll(STORES.PRESCRIPTIONS);
  const exercises = await getAll(STORES.EXERCISES);
  const learners = await getAll(STORES.LEARNERS);
  const exMap = Object.fromEntries(exercises.map(e => [e.id, e]));
  const lMap = Object.fromEntries(learners.map(l => [l.id, l]));
  return prescriptions.map(p => ({ ...p, exercise: exMap[p.exercise_id] || {}, learner: lMap[p.learner_id] || {} }));
}

export async function deletePrescription(prescriptionId) {
  await deleteRecord(STORES.PRESCRIPTIONS, prescriptionId);
  return { status: 'ok' };
}

export async function deleteSession(sessionId) {
  // Delete the session itself
  await deleteRecord(STORES.SESSIONS, sessionId);
  // Cascade: delete related gestures
  const gestures = await getWhere(STORES.GESTURES, { session_id: sessionId });
  for (const g of gestures) {
    await deleteRecord(STORES.GESTURES, g.id);
  }
  // Cascade: delete related reflex scores
  const reflexScores = await getWhere(STORES.REFLEX_SCORES, { session_id: sessionId });
  for (const r of reflexScores) {
    await deleteRecord(STORES.REFLEX_SCORES, r.id);
  }
  return { status: 'ok' };
}

// ── Report data helper ────────────────────────────────────────────────────────
export async function getReportData(sessionId) {
  const { analyseSession } = await import('./aiEngine.js');
  const session = await getById(STORES.SESSIONS, sessionId);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
  const learner = await getById(STORES.LEARNERS, session.learner_id);
  const reflexScores = await getWhere(STORES.REFLEX_SCORES, { session_id: sessionId });
  const exercises = await getAll(STORES.EXERCISES);
  const analysis = analyseSession(session, []);
  return { session, learner, reflexScores: reflexScores.length ? reflexScores : analysis.reflex_scores, exercises, analysis };
}
