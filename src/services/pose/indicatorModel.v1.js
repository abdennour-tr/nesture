/**
 * indicatorModel.v1.js
 * ---------------------------------------------------------------------------
 * LAYER 3 of the touch-mode pipeline: movement features → reflex INDICATORS.
 *
 *   capture → features → [INDICATOR MODEL] → score → export
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS, AND WHAT IT IS NOT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * It is a declarative, VERSIONED hypothesis. Every number in it — every
 * threshold, every cut-off, every weight — is a starting point chosen from the
 * described behaviour of the reflex, not from data collected with this system.
 * None of it has been validated against a clinical assessment.
 *
 * That is why the whole model is one exported object with a version string
 * rather than logic spread through the codebase. When enough sessions have been
 * recorded to fit these constants properly, the work is to write
 * `indicatorModel.v2.js` and switch `ACTIVE_MODEL` — not to hunt for magic
 * numbers in a dozen files. Every stored session records the model version that
 * produced its indicators, so old numbers stay interpretable.
 *
 * AN INDICATOR IS NOT A DIAGNOSIS. A retained primitive reflex is identified by
 * a trained clinician through specific elicited manoeuvres. A webcam watching a
 * child play a game observes movement that is CONSISTENT WITH a pattern, in an
 * uncontrolled setting, with no elicitation. Everything here is written to
 * support research and to flag "worth a closer look", and the `disclaimer`
 * field travels with each indicator so the wording cannot be dropped by a UI.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THESE FOUR, AND NOT THE OTHER SIX
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A reflex earns a place here only if the movement it produces is (a) described
 * in the clinical literature as an upper-body pattern and (b) actually visible
 * to a single webcam looking at a seated child.
 *
 *   ATNR   IN.  The clearest case. The described pattern — head rotation to one
 *               side, extension of the face-side arm, flexion of the skull-side
 *               arm — is exactly a correlation between head yaw and the
 *               difference in elbow extension. Both are measurable.
 *   STNR   IN.  Described as head extension → arm extension, head flexion → arm
 *               flexion. A correlation between head pitch and mean extension.
 *               Weaker than ATNR only because pitch from a webcam is noisier.
 *   Moro   IN, exploratory. The startle shape — rapid bilateral abduction then
 *               adduction — is detectable. But a game does not deliberately
 *               startle anyone, and a two-handed reach makes the same shape,
 *               so the count is a candidate event rate, not a reflex.
 *   TLR    IN, exploratory. Head position relative to gravity is described as
 *               changing trunk tone. Seated, upper body only, the visible
 *               fragment is head-pitch/trunk coupling. Thin, but measurable.
 *
 *   Palmar Grasp   OUT. Pose gives three coarse hand points. Grasp needs the
 *                  21-point Hands model; it is already measured there.
 *   Babkin,
 *   Hand-to-Mouth  OUT. Both need mouth aperture. Pose has two mouth corners
 *                  and no reliable opening.
 *   Spinal Galant  OUT. Elicited by stroking the spine. No camera can observe
 *                  it. Postural restlessness is an ASSOCIATED behaviour, not
 *                  the reflex, and scoring one as the other is how a plausible
 *                  number becomes a false finding.
 *   VOR, Eye
 *   Coordination   OUT of this file by definition — not primitive reflexes.
 *                  They need iris tracking, which Pose does not provide.
 */

export const MODEL_VERSION = 'pose-indicators-v1.0.0-provisional';

export const MODEL_NOTICE =
  'Provisional research model. Thresholds are reasoned starting points, not '
  + 'values fitted to data, and no indicator has been validated against a '
  + 'clinical assessment. Use for research and for flagging sessions worth a '
  + 'closer look — never as a finding about a child.';

/** How much weight a reader should give an indicator. */
export const EVIDENCE = {
  /** Pattern is well described clinically AND maps directly onto what we measure. */
  DIRECT: 'direct',
  /** Described clinically, but the measurement is an indirect fragment of it. */
  INDIRECT: 'indirect',
  /** Movement shape is detectable; its link to the reflex is untested here. */
  EXPLORATORY: 'exploratory',
};

/**
 * Shared gates. A session where the child never turned their head cannot say
 * anything about a head-linked reflex, and must return "not measured" rather
 * than a low score — the same rule the hand-tracking detectors already follow
 * (see reflexDetectors/vor.js, which refuses to score a motionless head).
 */
export const GATES = {
  MIN_FRAMES: 90,          // ~6s at 15Hz. Below this, nothing is stable.
  MIN_QUALITY: 0.45,       // mean landmark visibility across the session
  MIN_YAW_RANGE: 0.22,     // normalised head-yaw travel needed to see ATNR
  MIN_PITCH_RANGE: 0.18,   // shoulder-widths of nose travel needed for STNR
  MIN_PAIRED_SAMPLES: 45,  // frames where BOTH sides of a correlation exist
};

/**
 * Turn a correlation into a 0..100 indicator.
 *
 * Only the HYPOTHESISED direction counts. If ATNR predicts a positive
 * correlation and the session shows a strong negative one, that is not evidence
 * of ATNR — it is evidence against, and it scores 0 rather than being made
 * positive by an absolute value. Taking |r| here would let any strong
 * relationship, in either direction, look like a retained reflex.
 *
 * `floor` is the correlation below which we treat the relationship as noise.
 * It is deliberately well above zero: with a few hundred samples, small
 * correlations are easy to get by chance from an unrelated movement habit.
 */
export function directionalCorrelationScore(r, { expectSign = 1, floor = 0.15, ceiling = 0.75 } = {}) {
  if (r == null || !Number.isFinite(r)) return null;
  const aligned = r * expectSign;
  if (aligned <= floor) return 0;
  return Math.round(Math.min(1, (aligned - floor) / (ceiling - floor)) * 100);
}

/** Turn an events-per-minute rate into 0..100. */
export function rateScore(events, durationSec, { perMinuteCeiling = 6 } = {}) {
  if (!durationSec || durationSec < 20) return null;
  const perMinute = (events / durationSec) * 60;
  return Math.round(Math.min(1, perMinute / perMinuteCeiling) * 100);
}

/**
 * THE MAPPING.
 *
 * `gate(s)`      → null when observable, or a string saying why it is not.
 * `compute(s)`   → 0..100, where HIGH means "more consistent with the pattern
 *                  still being active" — the same direction as every other
 *                  retention score on the platform.
 * `confidence(s)`→ 0..1, how much data stood behind it.
 */
export const INDICATORS = [
  {
    key: 'ATNR',
    group: 'primitive',
    evidence: EVIDENCE.DIRECT,
    label: 'Asymmetric Tonic Neck Reflex',
    describes:
      'Clinically described as: turning the head to one side draws the arm on '
      + 'that side into extension while the opposite arm flexes.',
    measuredAs:
      'Correlation across the session between head rotation and the difference '
      + 'in elbow extension between the two arms. A child whose arms follow '
      + 'their head produces a positive correlation.',
    features: ['headYaw', 'extensionAsymmetry'],
    caveat:
      'A child may also extend the arm they are reaching with and turn to look '
      + 'at it. Reaching and this pattern are not separable from posture alone.',
    gate: (s) => {
      if (s.headYawRange == null || s.headYawRange < GATES.MIN_YAW_RANGE) {
        return 'The head stayed still, so a head-linked pattern could not be observed.';
      }
      if ((s.corrYawSampleN || 0) < GATES.MIN_PAIRED_SAMPLES) {
        return 'Too few frames showed the head and both arms at the same time.';
      }
      return null;
    },
    compute: (s) => directionalCorrelationScore(s.corrYawVsExtensionAsymmetry, { expectSign: 1 }),
    confidence: (s) => Math.min(1,
      ((s.corrYawSampleN || 0) / 300) * 0.6
      + Math.min(1, (s.headYawRange || 0) / 0.6) * 0.25
      + (s.meanQuality || 0) * 0.15),
  },

  {
    key: 'STNR',
    group: 'primitive',
    evidence: EVIDENCE.DIRECT,
    label: 'Symmetric Tonic Neck Reflex',
    describes:
      'Clinically described as: raising the head draws both arms toward '
      + 'extension; lowering the chin draws them toward flexion.',
    measuredAs:
      'Correlation between head flexion/extension and the average extension of '
      + 'both arms, taken together rather than as a difference.',
    features: ['headPitch', 'meanExtension'],
    caveat:
      'Head pitch from a single camera is a proxy — the nose\'s height above the '
      + 'shoulder line — not a measured angle, so this is noisier than ATNR.',
    gate: (s) => {
      if (s.headPitchRange == null || s.headPitchRange < GATES.MIN_PITCH_RANGE) {
        return 'The head did not move up and down enough for this pattern to show.';
      }
      if ((s.corrPitchSampleN || 0) < GATES.MIN_PAIRED_SAMPLES) {
        return 'Too few frames showed the head and both arms at the same time.';
      }
      return null;
    },
    compute: (s) => directionalCorrelationScore(s.corrPitchVsMeanExtension, { expectSign: 1 }),
    confidence: (s) => Math.min(1,
      ((s.corrPitchSampleN || 0) / 300) * 0.55
      + Math.min(1, (s.headPitchRange || 0) / 0.5) * 0.25
      + (s.meanQuality || 0) * 0.20),
  },

  {
    key: 'Moro',
    group: 'primitive',
    evidence: EVIDENCE.EXPLORATORY,
    label: 'Moro Reflex',
    describes:
      'Clinically described as a startle: both arms sweep outward and extend, '
      + 'then draw back in, within about a second.',
    measuredAs:
      'The rate of movements with that shape — both hands moving away from the '
      + 'midline together and returning inside 1.2 seconds.',
    features: ['wristSpreadFromMidline'],
    caveat:
      'STRONGEST CAVEAT IN THIS MODEL. Nothing in a game deliberately startles '
      + 'a child, and a two-handed reach produces the same shape. Read this as a '
      + 'count of candidate events for a human to review, not as a reflex score.',
    gate: (s) => {
      if (s.durationSec < 30) return 'The round was too short to judge a rate.';
      if (s.wristSpreadSd == null) return 'Both hands were not visible together often enough.';
      return null;
    },
    compute: (s) => rateScore(s.bilateralAbductionEvents, s.durationSec),
    confidence: (s) => Math.min(1, (s.durationSec / 240) * 0.5 + (s.meanQuality || 0) * 0.5) * 0.6,
  },

  {
    key: 'TLR',
    group: 'primitive',
    evidence: EVIDENCE.EXPLORATORY,
    label: 'Tonic Labyrinthine Reflex',
    describes:
      'Clinically described as head position relative to gravity altering '
      + 'muscle tone through the trunk, affecting posture and balance.',
    measuredAs:
      'Coupling between head flexion/extension and lateral trunk displacement — '
      + 'the only fragment of a whole-body pattern a seated upper-body view can see.',
    features: ['headPitch', 'trunkLeanLateral'],
    caveat:
      'This reflex is about whole-body tone, most of which is out of frame and '
      + 'unobservable in a seated child. Treat as a weak signal at best.',
    gate: (s) => {
      if (s.corrPitchVsTrunkLean == null) return 'The hips were not visible enough to measure the trunk.';
      if (s.headPitchRange == null || s.headPitchRange < GATES.MIN_PITCH_RANGE) {
        return 'The head did not move up and down enough for this pattern to show.';
      }
      return null;
    },
    compute: (s) => directionalCorrelationScore(s.corrPitchVsTrunkLean, { expectSign: 1, floor: 0.2 }),
    confidence: (s) => Math.min(1, (s.meanQuality || 0) * 0.6 + Math.min(1, s.frameCount / 600) * 0.4) * 0.5,
  },
];

/**
 * Postural measures. NOT reflexes and never reported as such — they are plain
 * descriptions of how steadily the child sat and how much they crossed the
 * midline. They are here because they are the part of this pipeline that is
 * genuinely measurable today, so they are the part allowed to affect a score.
 *
 * `betterWhenLow` says which direction is good, because it differs per measure.
 */
export const POSTURAL_MEASURES = [
  {
    key: 'posturalSteadiness',
    label: 'Sitting steadiness',
    describes: 'How much the shoulders drifted around during the round.',
    betterWhenLow: true,
    from: (s) => s.posturalSwaySd,
    /** Sway in normalised image units; 0.06 is a lot of drifting for a seated child. */
    normalise: (v) => (v == null ? null : Math.round((1 - Math.min(1, v / 0.06)) * 100)),
  },
  {
    key: 'shoulderSymmetry',
    label: 'Shoulder symmetry',
    describes: 'How level the shoulders stayed. A persistent tilt is worth noticing.',
    betterWhenLow: true,
    from: (s) => (s.shoulderTiltMean == null ? null : Math.abs(s.shoulderTiltMean)),
    /** Degrees of average tilt; 12° is a marked, sustained lean. */
    normalise: (v) => (v == null ? null : Math.round((1 - Math.min(1, v / 12)) * 100)),
  },
  {
    key: 'midlineCrossing',
    label: 'Midline crossing',
    describes: 'How often a hand travelled across the middle of the body.',
    betterWhenLow: false,
    from: (s) => (s.durationSec > 20 ? (s.midlineCrossings / s.durationSec) * 60 : null),
    /** Crossings per minute; 10 is a session with plenty of crossing in it. */
    normalise: (v) => (v == null ? null : Math.round(Math.min(1, v / 10) * 100)),
  },
];

/**
 * How much the pose pipeline may contribute to a child's game score, per game.
 *
 * EVERY REFLEX WEIGHT IS ZERO, DELIBERATELY.
 *
 * The reflex indicators are unvalidated. Letting an unvalidated research number
 * move the score a child sees would mean a child playing well could be marked
 * down by a correlation nobody has checked. The postural measures are different
 * — sitting steadily and crossing the midline are directly observed and are
 * reasonable things to credit — so those carry the weight for now.
 *
 * After calibration, raise the reflex weights HERE. Nothing else needs editing.
 */
export const SCORE_CONTRIBUTION = {
  default: {
    postural: { posturalSteadiness: 0.5, shoulderSymmetry: 0.25, midlineCrossing: 0.25 },
    reflex: {},                 // intentionally empty until calibrated
    maxShareOfGameScore: 0.15,  // pose can never be more than a sixth of a score
  },
  'trace-type': {
    postural: { posturalSteadiness: 0.6, shoulderSymmetry: 0.25, midlineCrossing: 0.15 },
    reflex: {},
    maxShareOfGameScore: 0.15,
  },
  bubble: {
    // Reaching wide across the body is the point of this game, so crossing
    // counts for more of the pose contribution here than anywhere else.
    postural: { posturalSteadiness: 0.3, shoulderSymmetry: 0.2, midlineCrossing: 0.5 },
    reflex: {},
    maxShareOfGameScore: 0.15,
  },
  ladybug: {
    postural: { posturalSteadiness: 0.35, shoulderSymmetry: 0.2, midlineCrossing: 0.45 },
    reflex: {},
    maxShareOfGameScore: 0.15,
  },
  letterquest: {
    /* Typing on an on-screen keyboard keeps both hands inside the body's
       width almost the whole time. Crediting midline crossing here would mark
       a child down for playing the game exactly as intended, so it carries
       almost no weight and sitting steadily carries most of it. */
    postural: { posturalSteadiness: 0.65, shoulderSymmetry: 0.3, midlineCrossing: 0.05 },
    reflex: {},
    maxShareOfGameScore: 0.15,
  },
  'finger-piano': {
    // Keys run left to right, so some crossing is expected — but far less than
    // in the two reaching games.
    postural: { posturalSteadiness: 0.45, shoulderSymmetry: 0.3, midlineCrossing: 0.25 },
    reflex: {},
    maxShareOfGameScore: 0.15,
  },
};

export function scoreContributionFor(gameId) {
  return SCORE_CONTRIBUTION[gameId] || SCORE_CONTRIBUTION.default;
}

export default {
  MODEL_VERSION, MODEL_NOTICE, INDICATORS, POSTURAL_MEASURES,
  SCORE_CONTRIBUTION, GATES, EVIDENCE,
};
