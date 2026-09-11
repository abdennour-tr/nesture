/**
 * reflexProfiles.js
 * ---------------------------------------------------------------------------
 * ONE SOURCE OF TRUTH for which reflexes each game is about, and for what the
 * word "reflex" is allowed to mean on this platform.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The engine ran all ten detectors on every session and the report printed
 * whatever came back. That produced three problems.
 *
 * 1. TWO DIFFERENT KINDS OF THING WERE BEING CALLED "REFLEXES".
 *
 *    ATNR, STNR, TLR, Moro, Palmar Grasp, Babkin and Hand-to-Mouth are
 *    PRIMITIVE reflexes: brainstem patterns that are normal in an infant and
 *    are expected to INTEGRATE (disappear) as higher centres mature. Finding
 *    one still active in a school-age child is the finding.
 *
 *    VOR, eye coordination and visual tracking are not that. The
 *    vestibulo-ocular reflex is a lifelong brainstem reflex that should be
 *    present and strong at every age — it never "integrates", and a weak one is
 *    a deficit rather than a retention. Binocular coordination and smooth
 *    pursuit are oculomotor SKILLS, not reflexes at all.
 *
 *    The scoring direction was in fact handled correctly (vor.js maps poor VOR
 *    quality to a high retention score), so the numbers were not wrong. The
 *    WORDS were. Both groups shared one vocabulary — strong / moderate / weak /
 *    none — which describes retention, so a child whose vestibulo-ocular reflex
 *    is failing was reported as "VOR: strong". Next to "retained reflex" that
 *    reads as bad news; next to "Vestibulo-Ocular Reflex" it reads as good
 *    news. Same word, opposite meaning, same report.
 *
 *    So the two groups are separated here, and each gets its own vocabulary.
 *
 * 2. A REFLEX WAS BEING INFERRED WITH NO WAY TO OBSERVE IT.
 *
 *    Spinal Galant is elicited by stroking the skin alongside the spine. A
 *    webcam pointed at a seated child's hands and face cannot observe it under
 *    any circumstances. It was nonetheless inferred by aiEngine from "erratic
 *    control" and "high variability" — cursor wobble, which has a hundred
 *    causes. It is marked here as questionnaire-only and is not inferred from
 *    gameplay. (See services/aiEngine.js.)
 *
 * 3. EVERY GAME REPORTED THE SAME TEN REFLEXES, INCLUDING GAMES THAT
 *    CANNOT MEASURE ANY OF THEM.
 *
 *    Only LetterQuest runs Face Mesh with iris plus head pose plus two hands,
 *    so only LetterQuest can feed the head-based detectors (ATNR, STNR, TLR)
 *    or the face-based ones (Babkin, Hand-to-Mouth, VOR, eye coordination).
 *    Every other game runs hands only.
 *
 *    Hence the distinction this file draws, which runs through the whole
 *    reporting layer:
 *
 *      TARGETS  — what the ACTIVITY is designed to work on. A clinical
 *                 statement about the task, true before anyone plays it, and
 *                 independent of what the camera can see.
 *      MEASURED — what THIS session actually observed. Only ever reported for
 *                 reflexes whose detector had the sensor data it needs.
 *
 *    A game may target a reflex it cannot measure. It must never report a
 *    measurement it did not make.
 *
 * Nothing here is diagnostic. Targets describe an activity; measurements
 * describe movement patterns. Neither identifies a condition.
 */

// ═══════════════════════════════════════════════════════════════════════════
// TAXONOMY
// ═══════════════════════════════════════════════════════════════════════════

/** Patterns that should integrate with maturity. High score = still active. */
export const PRIMITIVE_REFLEXES = [
  'ATNR', 'STNR', 'TLR', 'Moro',
  'Palmar Grasp', 'Babkin', 'Hand-to-Mouth', 'Spinal Galant',
];

/** Lifelong reflexes and oculomotor skills. High score = FUNCTIONING POORLY. */
export const FUNCTION_MEASURES = ['VOR', 'Eye Coordination', 'Visual Tracking'];

export const GROUP = { PRIMITIVE: 'primitive', FUNCTION: 'function' };

const GROUP_BY_KEY = {};
PRIMITIVE_REFLEXES.forEach((k) => { GROUP_BY_KEY[k] = GROUP.PRIMITIVE; });
FUNCTION_MEASURES.forEach((k) => { GROUP_BY_KEY[k] = GROUP.FUNCTION; });

export function reflexGroup(key) {
  return GROUP_BY_KEY[key] || GROUP.PRIMITIVE;
}

export function isPrimitiveReflex(key) {
  return reflexGroup(key) === GROUP.PRIMITIVE;
}

/**
 * Turn an engine label into words that mean the same thing in both groups.
 *
 * The engine's `score` is always "how much of a problem is there" — retention
 * for a primitive reflex, dysfunction for a lifelong one. The labels below say
 * that in the terms each group is actually read in.
 *
 * @returns {{ text, tone, hint }} tone: 'good' | 'watch' | 'attention' | 'none'
 */
export function describeReflexLabel(key, label) {
  if (label === 'not_measured' || label == null) {
    return { text: 'Not measured', tone: 'none', hint: 'No usable observation this session' };
  }
  if (reflexGroup(key) === GROUP.FUNCTION) {
    // High score = the reflex/skill is working POORLY.
    switch (label) {
      case 'strong':   return { text: 'Needs support', tone: 'attention', hint: 'Responded weakly or inconsistently' };
      case 'moderate': return { text: 'Developing',    tone: 'watch',     hint: 'Present but not yet consistent' };
      case 'weak':     return { text: 'Working well',  tone: 'good',      hint: 'Responded as expected most of the time' };
      default:         return { text: 'Working well',  tone: 'good',      hint: 'Responded as expected' };
    }
  }
  // Primitive: high score = still active.
  switch (label) {
    case 'strong':   return { text: 'Clearly active',  tone: 'attention', hint: 'Pattern showed up often this session' };
    case 'moderate': return { text: 'Partly active',   tone: 'watch',     hint: 'Pattern showed up some of the time' };
    case 'weak':     return { text: 'Mostly settled',  tone: 'good',      hint: 'Pattern showed up only occasionally' };
    default:         return { text: 'Settled',         tone: 'good',      hint: 'Pattern did not show up this session' };
  }
}

/** Heading each group is reported under. */
export const GROUP_META = {
  [GROUP.PRIMITIVE]: {
    title: 'Primitive reflex patterns',
    blurb: 'Early movement patterns that usually settle as a child grows. '
         + 'Seeing one still active points to where practice may help.',
  },
  [GROUP.FUNCTION]: {
    title: 'Visual & vestibular function',
    blurb: 'These are not primitive reflexes — they are lifelong responses and '
         + 'eye-movement skills that should be working well at every age.',
  },
};

/** Reflexes no camera in this platform can observe. Never inferred from play. */
export const OBSERVATION_UNAVAILABLE = {
  'Spinal Galant':
    'Elicited by touch alongside the spine, so it cannot be seen by a camera '
    + 'pointed at the hands and face. Recorded from the intake questionnaire '
    + 'or a practitioner’s observation, never inferred from gameplay.',
};

// ═══════════════════════════════════════════════════════════════════════════
// SENSOR CAPABILITY
// ═══════════════════════════════════════════════════════════════════════════

/** What each detector needs before it can say anything at all. */
export const DETECTOR_REQUIREMENTS = {
  ATNR:               ['hands', 'head'],
  STNR:               ['hands', 'head'],
  TLR:                ['hands', 'head'],
  Moro:               ['hands'],
  'Palmar Grasp':     ['hands'],
  Babkin:             ['hands', 'face'],
  'Hand-to-Mouth':    ['hands', 'face'],
  VOR:                ['face', 'head'],
  'Eye Coordination': ['face'],
  'Visual Tracking':  ['hands', 'face'],
  'Spinal Galant':    ['unavailable'],
};

/** Does this game's sensor set carry what the detector needs? */
export function canMeasure(reflexKey, sensors = []) {
  const need = DETECTOR_REQUIREMENTS[reflexKey];
  if (!need || need.includes('unavailable')) return false;
  return need.every((s) => sensors.includes(s));
}

/* ── Having the sensor is not the same as the reading meaning anything ──────
   The palmar grasp detector scores how much the hand pulls into a closed
   position during effort. That is a retained reflex ONLY when closing is not
   what the child was asked to do.

   In Pinch the Coin, Finger Piano and Magic Finger Copy, closing the hand IS
   the task. The detector cannot tell a deliberate pinch from an involuntary
   grasp, so it would score a child who is playing the game correctly as having
   a strongly retained reflex — the more skilful the child, the worse the
   report. Those games therefore TARGET palmar grasp (the activity genuinely
   works on it) but do not MEASURE it.

   Where the task demands a sustained open or pointing hand — LetterQuest,
   Trace → Find → Type, Follow the Ladybug, Pop the Bubble, Path Tracing —
   closure is unwanted, so it means what the detector thinks it means. */
export function shouldMeasure(gameId, reflexKey) {
  const profile = getGameProfile(gameId);
  if (!profile) return false;
  if (!canMeasure(reflexKey, profile.sensors)) return false;
  const target = profile.targets.find((t) => t.key === reflexKey);
  return !target || target.measurable !== false;
}

/** Why a targeted reflex is not scored, for the report to say out loud. */
export function measurementBlockedReason(gameId, reflexKey) {
  const profile = getGameProfile(gameId);
  const target = profile?.targets.find((t) => t.key === reflexKey);
  if (target?.measurable === false) return target.measureNote || null;
  if (profile && !canMeasure(reflexKey, profile.sensors)) {
    return 'This game’s camera setup does not capture what this pattern needs.';
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// PER-GAME PROFILES
// ═══════════════════════════════════════════════════════════════════════════
/**
 * `tier`:
 *   'primary'   — the activity is substantially built around this pattern.
 *   'secondary' — the activity loads it meaningfully but is not built on it.
 *
 * `why` is shown to parents and therapists, so it has to say what the CHILD
 * DOES that loads the reflex — not what the reflex is. A reflex with no
 * honest sentence of that kind does not belong in the list.
 *
 * Moro and TLR are deliberately absent from LetterQuest. Both are real and
 * both were being reported, but a seated spelling game has no startle stimulus
 * and no whole-body posture change, so the activity does not train either one.
 * They can still be MEASURED there if they happen to occur — targets and
 * measurements are different claims.
 */
export const GAME_PROFILES = {
  letterquest: {
    id: 'letterquest',
    name: 'LetterQuest',
    tagline: 'Spell words by pointing at letters',
    sensors: ['hands', 'face', 'head'],
    measures: true,
    targets: [
      { key: 'ATNR', tier: 'primary',
        why: 'Letters sit right across a wide keyboard, so each word means reaching '
           + 'over the middle of the body again and again while the head turns to follow.' },
      { key: 'Palmar Grasp', tier: 'primary',
        why: 'One finger points and holds while the rest of the hand stays relaxed — '
           + 'the opposite of the whole-hand grip this reflex produces.' },
      { key: 'STNR', tier: 'primary',
        why: 'Eyes and head move between the word above and the keys below while the '
           + 'arm stays extended, which is exactly the head-to-arm link this reflex drives.' },
      { key: 'Babkin', tier: 'secondary',
        why: 'Long stretches of careful hand work often bring the mouth along with them; '
           + 'the camera can see both at once here.' },
      { key: 'Hand-to-Mouth', tier: 'secondary',
        why: 'The hand tends to drift toward the face during effort, which this game '
           + 'gives plenty of.' },
    ],
  },

  'trace-type': {
    id: 'trace-type',
    name: 'Trace → Find → Type',
    tagline: 'Trace a letter, then find and type it',
    sensors: ['hands'],
    measures: true,
    targets: [
      { key: 'Palmar Grasp', tier: 'primary',
        why: 'Tracing asks one finger to lead a slow, continuous line while the other '
           + 'fingers stay out of it — the longest stretch of finger isolation in the platform.' },
      { key: 'ATNR', tier: 'secondary',
        why: 'Both the letter shape and the keyboard run across the middle of the body, '
           + 'so the hand keeps crossing it.' },
    ],
  },

  'pinch-coin': {
    id: 'pinch-coin',
    name: 'Pinch the Coin',
    tagline: 'Pinch coins and drop them in the piggy bank',
    sensors: ['hands'],
    measures: true,
    targets: [
      { key: 'Palmar Grasp', tier: 'primary',
        why: 'A thumb-and-finger pinch is the movement this reflex most directly gets '
           + 'in the way of, because it pulls the hand toward closing as a whole.',
        measurable: false,
        measureNote: 'Closing the hand is the point of this game, so the camera cannot tell a deliberate movement from a reflex one. Practised here, measured in the pointing games.' },
      { key: 'Babkin', tier: 'secondary',
        why: 'Pinching is effortful, and hand effort and mouth movement are linked while '
           + 'this reflex is still active.' },
    ],
  },

  ladybug: {
    id: 'ladybug',
    name: 'Follow the Ladybug',
    tagline: 'Track a moving target with your fingertip',
    sensors: ['hands'],
    measures: true,
    targets: [
      { key: 'ATNR', tier: 'primary',
        why: 'The ladybug wanders across the middle of the screen, so following it means '
           + 'carrying the hand over the midline without the arm pulling away.' },
      { key: 'Palmar Grasp', tier: 'secondary',
        why: 'The pointing finger has to stay extended through a long chase.' },
    ],
  },

  bubble: {
    id: 'bubble',
    name: 'Pop the Bubble',
    tagline: 'Reach out and pop bubbles as they appear',
    sensors: ['hands'],
    measures: true,
    targets: [
      { key: 'ATNR', tier: 'primary',
        why: 'Bubbles appear on both sides, so the child reaches across the middle of the '
           + 'body to whichever side the next one lands on.' },
      { key: 'Moro', tier: 'secondary',
        why: 'Bubbles arrive suddenly but harmlessly, which is the kind of repeated, '
           + 'predictable surprise that helps a startle response settle.' },
      { key: 'Palmar Grasp', tier: 'secondary',
        why: 'Reaching with an open, extended hand works against the pull into a fist.' },
    ],
  },

  'finger-copy': {
    id: 'finger-copy',
    name: 'Magic Finger Copy',
    tagline: 'Copy the hand shape on screen',
    sensors: ['hands'],
    measures: true,
    targets: [
      { key: 'Palmar Grasp', tier: 'primary',
        why: 'Holding one shape means some fingers bend while others stay straight, which '
           + 'a hand still working as a single unit cannot do.',
        measurable: false,
        measureNote: 'Closing the hand is the point of this game, so the camera cannot tell a deliberate movement from a reflex one. Practised here, measured in the pointing games.' },
      { key: 'Babkin', tier: 'secondary',
        why: 'Holding an awkward hand shape is effortful, and the mouth often joins in '
           + 'while this reflex is active.' },
    ],
  },

  'finger-piano': {
    id: 'finger-piano',
    name: 'Finger Piano',
    tagline: 'Play notes with individual fingers',
    sensors: ['hands'],
    measures: true,
    targets: [
      { key: 'Palmar Grasp', tier: 'primary',
        why: 'Each note needs one finger to move on its own while the others wait — the '
           + 'clearest test of whether the hand can act as separate fingers.',
        measurable: false,
        measureNote: 'Closing the hand is the point of this game, so the camera cannot tell a deliberate movement from a reflex one. Practised here, measured in the pointing games.' },
      { key: 'Babkin', tier: 'secondary',
        why: 'Repeated finger effort tends to pull the mouth along with it.' },
    ],
  },

  /* Path Tracing runs the same full stack as LetterQuest — useMediaPipeTracking
     gives it Face Mesh with iris, head pose and two hands, and it already feeds
     the reflex engine — so it is the second game that can MEASURE the
     head-based patterns rather than only train them. */
  'path-tracing': {
    id: 'path-tracing',
    name: 'Path Tracing',
    tagline: 'Follow a path with your fingertip',
    sensors: ['hands', 'face', 'head'],
    measures: true,
    targets: [
      { key: 'ATNR', tier: 'primary',
        why: 'Paths run left to right across the middle of the body, so the hand '
           + 'has to keep crossing it while the head follows the line.' },
      { key: 'Palmar Grasp', tier: 'primary',
        why: 'One finger leads the whole path while the rest of the hand stays out '
           + 'of the way — a long, unbroken stretch of finger isolation.' },
      { key: 'STNR', tier: 'secondary',
        why: 'Following a path up and down the screen moves the head vertically '
           + 'while the arm stays extended.' },
      { key: 'Hand-to-Mouth', tier: 'secondary',
        why: 'Sustained concentration tends to bring the hand toward the face, and '
           + 'the camera can see both here.' },
    ],
  },
};

export function getGameProfile(gameId) {
  return GAME_PROFILES[gameId] || null;
}

/**
 * The reflexes a game targets AND can actually observe. This is the list a
 * results screen may show a score against; everything else in `targets` is
 * shown as a target only.
 */
export function measurableTargets(gameId) {
  const profile = getGameProfile(gameId);
  if (!profile) return [];
  return profile.targets
    .filter((t) => canMeasure(t.key, profile.sensors))
    .map((t) => t.key);
}

/** Targets this game trains but cannot see. Shown without a score, never with one. */
export function unmeasurableTargets(gameId) {
  const profile = getGameProfile(gameId);
  if (!profile) return [];
  return profile.targets
    .filter((t) => !canMeasure(t.key, profile.sensors))
    .map((t) => t.key);
}

export default GAME_PROFILES;

// ═══════════════════════════════════════════════════════════════════════════
// THE REFLEX SECTION, ASSEMBLED ONCE
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Build the reflex part of a session report.
 *
 * The on-screen report and the downloadable PDF both call this, and neither
 * assembles the list itself. They used to: the screen showed grouped targets
 * with plain-language findings, while the PDF drew its own table straight from
 * the stored rows — where a missing score defaulted to 50 and the "status"
 * column was derived from CONFIDENCE, so a well-observed settled reflex printed
 * "Action recommended". A parent could hold the two side by side and read two
 * different findings for the same session.
 *
 * One function, one answer. A renderer decides how it looks, never what it says.
 *
 * @param {string} gameId
 * @param {Object|null} measurements  keyed by reflex, values as the engine
 *        formats them: { reflex_key, reflex_name, measured, score, label }.
 *        `score` is a RETENTION score — high means the pattern is still active.
 * @returns {Array<{ group, title, blurb, entries }>} only non-empty groups
 */
export function buildReflexSections(gameId, measurements) {
  const profile = getGameProfile(gameId);
  const targets = profile?.targets || [];
  const targetKeys = new Set(targets.map((t) => t.key));

  const entryFor = (key, tier, why, measurement, blockedReason) => {
    const usable = measurement && measurement.measured !== false && measurement.score != null;
    const phrasing = describeReflexLabel(key, usable ? measurement.label : 'not_measured');
    return {
      key,
      name: measurement?.reflex_name || key,
      tier,
      why,
      measured: !!usable,
      /* Never a number when nothing was observed. A default score is a finding
         the session did not earn. */
      score: usable ? measurement.score : null,
      confidence: usable ? (measurement.confidence ?? null) : null,
      statusText: phrasing.text,
      statusHint: phrasing.hint,
      tone: usable ? phrasing.tone : 'none',
      blockedReason: usable ? null : (blockedReason || null),
    };
  };

  const fromTargets = targets.map((t) => entryFor(
    t.key, t.tier, t.why,
    shouldMeasure(gameId, t.key) ? (measurements?.[t.key] || null) : null,
    measurementBlockedReason(gameId, t.key),
  ));

  // Something the camera saw that the activity does not claim to train. Still
  // reported — it is an observation — but after the targets and without a tier.
  const extras = Object.values(measurements || {})
    .filter((r) => r && r.measured !== false && r.score != null && !targetKeys.has(r.reflex_key))
    .map((r) => entryFor(r.reflex_key, null, null, r, null));

  const all = [...fromTargets, ...extras];
  return [GROUP.PRIMITIVE, GROUP.FUNCTION]
    .map((group) => ({
      group,
      title: GROUP_META[group].title,
      blurb: GROUP_META[group].blurb,
      entries: all.filter((e) => reflexGroup(e.key) === group),
    }))
    .filter((s) => s.entries.length > 0);
}

/** True when any group carries a real observation. */
export function hasAnyMeasurement(sections) {
  return sections.some((s) => s.entries.some((e) => e.measured));
}

/** The line every report ends on, in one place so both renderers agree. */
export const REPORT_DISCLAIMER =
  'Nesture describes movement patterns to guide practice. It is not a medical '
  + 'assessment and does not identify any condition.';

/**
 * Resolve a stored `session.game_name` back to a profile id.
 * Sessions save a display name ("Pop the Bubble"), not an id, so a report built
 * from a database row has to find its way back to the profile.
 */
export function gameIdFromName(name) {
  if (!name) return null;
  const wanted = String(name).trim().toLowerCase();
  const exact = Object.values(GAME_PROFILES)
    .find((p) => p.name.toLowerCase() === wanted || p.id === wanted);
  if (exact) return exact.id;
  // Tolerate punctuation drift ("Trace -> Find -> Type" vs "Trace → Find → Type").
  const loose = wanted.replace(/[^a-z]/g, '');
  const near = Object.values(GAME_PROFILES)
    .find((p) => p.name.toLowerCase().replace(/[^a-z]/g, '') === loose);
  return near ? near.id : null;
}

/**
 * Convert stored reflex rows into the retention-scored map the report expects.
 *
 * BEWARE THE DIRECTION. `toAiEngineFormat` INVERTS the engine's retention score
 * before saving, so a stored row's `score` is an INTEGRATION score — high means
 * integrated, which is good. Everything in the reporting layer works in
 * retention, where high means the pattern is still active. Feeding a stored row
 * straight in would flip every finding on the page.
 */
export function reflexMapFromStoredRows(rows) {
  if (!Array.isArray(rows)) return null;
  const map = {};
  for (const r of rows) {
    const key = r.reflex || r.reflex_key;
    if (!key) continue;
    const measured = r.measured !== false && typeof r.score === 'number';
    map[key] = {
      reflex_key: key,
      reflex_name: r.reflex_name || key,
      measured,
      score: measured ? 100 - r.score : null,
      label: r.label ?? 'none',
      confidence: r.confidence_value ?? null,
    };
  }
  return map;
}
