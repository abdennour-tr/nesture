/**
 * reflexEngine/outputFormatter.js
 * Structured JSON output formatter for all reflexes.
 *
 * Generates final output compatible with the educational module,
 * with metadata: explanation, recommended activities, associated podcast.
 *
 * Developmental patterns detection (non-diagnostic)
 */

// ── Educational Metadata ─────────────────────────────────────────────────────

export const REFLEX_EDUCATION = {
  ATNR: {
    fullName: 'Asymmetric Tonic Neck Reflex',
    explanation:
      "ATNR is a primitive reflex that links head rotation to the limbs. "
      + "When the head turns to one side, the arm and leg on that same side extend. "
      + "Retention can make crossing the midline difficult, affecting "
      + "handwriting and hand-eye coordination.",
    activities: [
      'Midline crossing exercises (figure 8s)',
      'Supervised rolling and ground movements',
      'Bilateral coordination activities (juggling, catching)',
      'Drawing large circles alternating both hands',
    ],
    podcast: 'podcast-atnr-001',
    category: 'Postural Reflexes',
  },
  STNR: {
    fullName: 'Symmetric Tonic Neck Reflex',
    explanation:
      "STNR links vertical movements of the head to limb posture. "
      + "Head extension -> arms extend, legs bend. "
      + "Retention can affect sitting posture, concentration in class "
      + "and upper/lower body dissociation.",
    activities: [
      'Quadruped position with head/back rocking',
      'Crawling alternating arms and legs',
      'Yoga for children (animal poses)',
      'Therapy ball exercises',
    ],
    podcast: 'podcast-stnr-001',
    category: 'Postural Reflexes',
  },
  TLR: {
    fullName: 'Tonic Labyrinthine Reflex',
    explanation:
      "TLR is linked to the vestibular system and influences overall muscle tone. "
      + "In retention, the child may struggle to maintain a stable posture, "
      + "present low or high muscle tone, and experience balance and proprioception difficulties.",
    activities: [
      "Supervised mini-trampoline jumping",
      "Balance activities (balance board)",
      "Swimming and water activities",
      "Therapeutic swing",
    ],
    podcast: 'podcast-tlr-001',
    category: 'Vestibular Reflexes',
  },
  Moro: {
    fullName: 'Moro Reflex',
    explanation:
      "The Moro reflex is a primitive startle response. "
      + "In retention, the child may be hypersensitive to sensory stimulation, "
      + "exhibit high anxiety, have difficulty with emotional regulation "
      + "and show increased sensitivity to noise or sudden movements.",
    activities: [
      "Proprioceptive compression activities (firm hugs)",
      "Sensory brushing supervised by an OT",
      "Predictable routines to reduce anticipatory anxiety",
      "Progressive breathing and relaxation exercises",
    ],
    podcast: 'podcast-moro-001',
    category: 'Survival Reflexes',
  },
  'Spinal Galant': {
    fullName: 'Spinal Galant Reflex',
    explanation:
      "This reflex causes lateral flexion of the trunk when the skin along "
      + "the spine is stimulated. In retention, the child may be unable "
      + "to sit still, showing concentration difficulties and tactile hypersensitivity on the back.",
    activities: [
      'Core strengthening activities',
      'Swimming and water activities',
      'Crawling movements on the ground',
      'Back massage with firm pressure',
    ],
    podcast: 'podcast-galant-001',
    category: 'Trunk Reflexes',
  },
  'Palmar Grasp': {
    fullName: 'Palmar Grasp Reflex',
    explanation:
      "This reflex causes automatic closure of the hand upon palmar stimulation. "
      + "In retention, the child may have difficulty releasing their grip, "
      + "using writing tools correctly, or developing precise fine motor skills.",
    activities: [
      "Playdough and kneading activities",
      "Pinching and fine manipulation games",
      "Intentional object release exercises",
      "Gradual writing tools and paintbrush activities",
    ],
    podcast: 'podcast-palmar-001',
    category: 'Grip Reflexes',
  },
  VOR: {
    fullName: 'Vestibulo-Ocular Reflex',
    explanation:
      "VOR stabilizes images on the retina during head movements by generating "
      + "compensatory eye movements. A weak VOR can lead to reading difficulties (text seems to move), "
      + "motion sickness during travel, and visual attention issues.",
    activities: [
      'Visual fixation exercises with head movement',
      'Visual tracking games with stationary target',
      'Reading activities with head stabilization',
      'Ball games with focus on the target',
    ],
    podcast: 'podcast-vor-001',
    category: 'Vestibular Reflexes',
  },
  Babkin: {
    fullName: 'Babkin Reflex',
    explanation:
      "The Babkin reflex links palmar pressure to mouth opening and head movements. "
      + "In retention, it can create an automatic link between hand and mouth movements, "
      + "affecting the hand-mouth dissociation required for writing and speech.",
    activities: [
      "Dissociated oral and manual activities",
      "Blowing games (bubbles, instruments)",
      "Fine motor exercises without automatic vocalization",
      "Palmar massage followed by targeted oral exercises",
    ],
    podcast: 'podcast-babkin-001',
    category: 'Oral-Motor Reflexes',
  },
  'Hand-to-Mouth': {
    fullName: 'Hand-to-Mouth / Rooting Reflex (proxy)',
    explanation:
      "This pattern reflects instinctive hand-to-mouth approach behavior. "
      + "Retention can manifest as persistent thumb sucking, difficulty inhibiting "
      + "hand-mouth movement during fine motor tasks, or oral dependency for sensory regulation.",
    activities: [
      'Oral substitution activities (chewing gum, chewelry)',
      'Games keeping hands busy away from the mouth',
      'Oral proprioceptive awareness',
      'Progressive weaning program supervised by an OT',
    ],
    podcast: 'podcast-htom-001',
    category: 'Oral-Motor Reflexes',
  },
  'Eye Coordination': {
    fullName: 'Eye Coordination Index',
    explanation:
      "Binocular coordination allows both eyes to work together as a unit. "
      + "Weak coordination can lead to reading, copying, depth perception, "
      + "and visual tracking difficulties, significantly affecting academic learning.",
    activities: [
      'Vergence exercises (slowly moving a pen towards the nose)',
      'Puzzles and spatial localization games',
      'Hand-eye coordination activities (catching, threading)',
      'Reading with a finger guide to maintain line focus',
    ],
    podcast: 'podcast-eye-coord-001',
    category: 'Oculomotor Reflexes',
  },
  'Visual Tracking': {
    fullName: 'Visual Tracking',
    explanation:
      "Visual tracking is the ability to maintain gaze on a moving target. "
      + "Reduced latency or accuracy can indicate visual attention difficulties, "
      + "affecting reading, sports, and spatial awareness.",
    activities: [
      "Tracking a pen/finger at different speeds",
      "Suspended ball games (Marsden ball)",
      "Interactive visual tracking applications",
      "Light games in a dark room (flashlight play)",
    ],
    podcast: 'podcast-visual-track-001',
    category: 'Oculomotor Reflexes',
  },
};

// ── JSON Output Generation ──────────────────────────────────────────────────

/**
 * Formats raw results from all detectors
 * into a structured and enriched JSON output.
 *
 * @param {Object} rawResults - { reflexName: { score, label, confidence, ...detail } }
 * @param {Object} sessionMeta - { sessionId, learnerId, timestamp }
 * @returns {Object} final JSON output
 */
/* The reflexes this engine knows how to look for. `formatOutput` emits an entry
   for every one of them, measured or not: with an empty `rawResults` the output
   used to carry no reflexes at all, so a dashboard iterating the list rendered
   an empty panel with nothing to explain why. */
export const KNOWN_REFLEXES = [
  'ATNR', 'STNR', 'TLR', 'Moro', 'VOR',
  'Palmar Grasp', 'Babkin', 'Hand-to-Mouth',
  'Eye Coordination', 'Visual Tracking',
];

export function formatOutput(rawResults, sessionMeta = {}) {
  const formatted = {};

  const complete = { ...rawResults };
  for (const key of KNOWN_REFLEXES) {
    if (!complete[key]) {
      complete[key] = {
        score: null, label: 'not_measured', confidence: 0,
        /* The reason travels with the reflex. "Not measured" on its own reads
           the same whether the camera failed, the child was out of frame, or
           the session was deliberately played on the touch screen with no
           camera at all — and those call for very different responses. */
        detail: { reason: sessionMeta.noDataReason || 'Detector produced no result for this session' },
      };
    }
  }

  for (const [reflexKey, result] of Object.entries(complete)) {
    const education = REFLEX_EDUCATION[reflexKey] || {};

    formatted[reflexKey] = {
      // ── Identification ─────────────────────────────────────────────────────
      reflex_key:  reflexKey,
      reflex_name: education.fullName || reflexKey,
      category:    education.category || 'Unknown',

      /* ── Scores ───────────────────────────────────────────────────────
         `score` is null when the reflex could not be measured — NOT 0. The old
         `result.score ?? 0` turned every unmeasurable reflex into a score of
         zero with the label "none", which downstream reads as "integrated". A
         reflex nobody observed and a reflex that is genuinely integrated are
         not the same statement about a child. */
      score:      result.score ?? null,
      label:      result.label ?? 'none',       // strong | moderate | weak | none | not_measured
      measured:   result.label !== 'not_measured' && result.score !== null,
      confidence: result.confidence ?? 0,
      events:     result.events ?? null,

      // ── Technical Detail ──────────────────────────────────────────────────
      detail:     result.detail ?? {},
      left:       result.left   ?? null,
      right:      result.right  ?? null,
      bilateral:  result.bilateral ?? null,

      // ── Educational Metadata ─────────────────────────────────────────────
      education: {
        explanation:  education.explanation  || '',
        activities:   education.activities   || [],
        podcast:      education.podcast      || null,
      },

      // ── Mandatory Disclaimer ─────────────────────────────────────────────
      disclaimer: 'Developmental patterns detection (non-diagnostic)',
    };
  }

  const inputModes = sessionMeta.inputModes || ['camera'];
  return {
    system:   'Nesture AI — Developmental patterns detection (non-diagnostic)',
    version:  '2.0.0',
    timestamp: sessionMeta.timestamp || new Date().toISOString(),
    session_id:  sessionMeta.sessionId  || null,
    learner_id:  sessionMeta.learnerId  || null,
    /* How the child played. A touch-only session cannot produce reflex data by
       design, and a report should say so rather than leave a blank panel that
       looks like a malfunction. */
    input_modes:  inputModes,
    camera_used:  inputModes.includes('camera'),
    windows_analyzed: sessionMeta.windows ?? 0,
    frames_received:  sessionMeta.totalFrames ?? 0,
    reflexes:    formatted,
    summary: _generateSummary(formatted, sessionMeta),
  };
}

// ── Global Summary ─────────────────────────────────────────────────────────────

/* Below this, a score rests on too little data to be worth putting in front of
   a parent. It is still returned in `reflexes` with its confidence attached —
   it just does not drive the session's headline status. */
export const MIN_REPORTABLE_CONFIDENCE = 0.35;

function _generateSummary(formatted, sessionMeta = {}) {
  const reflexList = Object.values(formatted);

  /* Three states, not two. `not_measured` used to be indistinguishable from
     `none`, so a session in which the engine received no frames at all
     reported "Integrated" — a clean bill of health from zero observations. */
  const notMeasured = reflexList.filter(r => !r.measured);
  const measured    = reflexList.filter(r => r.measured);

  /* Confidence was computed by every detector and then thrown away here: a
     reflex scored on a tenth of the frames drove the headline exactly like one
     scored on all of them. */
  const reportable = measured.filter(r => (r.confidence ?? 0) >= MIN_REPORTABLE_CONFIDENCE);
  const lowConf    = measured.filter(r => (r.confidence ?? 0) <  MIN_REPORTABLE_CONFIDENCE);

  const strong   = reportable.filter(r => r.label === 'strong').map(r => r.reflex_key);
  const moderate = reportable.filter(r => r.label === 'moderate').map(r => r.reflex_key);
  const mild     = reportable.filter(r => r.label === 'weak').map(r => r.reflex_key);
  const none     = reportable.filter(r => r.label === 'none').map(r => r.reflex_key);

  const inputModes = sessionMeta.inputModes || ['camera'];
  const touchOnly  = inputModes.length === 1 && inputModes[0] === 'touch';

  let overallStatus;
  if (reportable.length === 0) {
    /* Nothing usable was measured. Saying "Integrated" here is the single most
       misleading thing this engine could output. A touch-only session is
       called out separately: nothing went wrong, the exercise simply was not
       the kind that observes reflexes. */
    overallStatus = touchOnly ? 'Not Applicable (touch mode)' : 'Not Measured';
  } else if (strong.length > 0)        overallStatus = 'Attention Required';
  else if (moderate.length > 0)        overallStatus = 'Monitor';
  else if (mild.length > 0)            overallStatus = 'Mild';
  else                                 overallStatus = 'Integrated';

  return {
    overall_status:    overallStatus,
    strong_patterns:   strong,
    moderate_patterns: moderate,
    mild_patterns:     mild,
    integrated:        none,
    not_measured:      notMeasured.map(r => r.reflex_key),
    low_confidence:    lowConf.map(r => r.reflex_key),
    total_analyzed:    reflexList.length,
    total_measured:    measured.length,
    total_reportable:  reportable.length,
    min_confidence:    MIN_REPORTABLE_CONFIDENCE,
    input_modes:       inputModes,
    /* True when the session mixed both: part of it is measured, part cannot be,
       and the coverage figures on each reflex say how much. */
    partial_camera:    inputModes.length > 1,
    no_data_reason:    reportable.length === 0 ? (sessionMeta.noDataReason || null) : null,
    disclaimer:        'Developmental patterns detection (non-diagnostic)',
  };
}
