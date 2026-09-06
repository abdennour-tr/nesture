/**
 * useGestureDetection.js
 * Gesture recognition engine for Magic Finger Copy game.
 *
 * Classifies 7 hand gestures from MediaPipe 21-point hand landmarks:
 *   - Thumbs Up, One Finger, Two Fingers, Open Hand, Closed Fist
 *   - OK Sign, Pinch
 *
 * Uses finger state detection (tip vs PIP joint positions) to determine
 * which fingers are extended or curled, then pattern-matches against
 * known gesture definitions.
 *
 * Usage:
 *   const { detectedGesture, fingerStates, accuracy, handedness, isHandDetected }
 *     = useGestureDetection(landmarks, multiHandData, targetGesture);
 */
import { useMemo } from 'react';

// ── MediaPipe 21-point hand landmark indices ───────────────────────────────
const LM = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

// ── Gesture definitions ────────────────────────────────────────────────────
// Each gesture is a pattern of finger states: 'up' = extended, 'down' = curled
// Special gestures (OK, Pinch) use additional distance checks
export const GESTURE_DEFS = {
  thumbs_up:   { thumb: 'up',   index: 'down', middle: 'down', ring: 'down', pinky: 'down' },
  one_finger:  { thumb: 'down', index: 'up',   middle: 'down', ring: 'down', pinky: 'down' },
  two_fingers: { thumb: 'down', index: 'up',   middle: 'up',   ring: 'down', pinky: 'down' },
  open_hand:   { thumb: 'up',   index: 'up',   middle: 'up',   ring: 'up',   pinky: 'up'   },
  closed_fist: { thumb: 'down', index: 'down', middle: 'down', ring: 'down', pinky: 'down' },
  // ── Added so Medium has its own distinct, finer-motor set (see LEVELS) ──
  three_fingers: { thumb: 'down', index: 'up',   middle: 'up',   ring: 'up',   pinky: 'down' },
  rock:          { thumb: 'down', index: 'up',   middle: 'down', ring: 'down', pinky: 'up'   },
  pinky_up:      { thumb: 'down', index: 'down', middle: 'down', ring: 'down', pinky: 'up'   },
  call_me:       { thumb: 'up',   index: 'down', middle: 'down', ring: 'down', pinky: 'up'   },
  // OK and Pinch need special handling — see classifyGesture()
  ok_sign:     { thumb: 'special', index: 'special', middle: 'up', ring: 'up', pinky: 'up'   },
  pinch:       { thumb: 'special', index: 'special', middle: 'any', ring: 'any', pinky: 'any' },
};

// ── Gesture display info ───────────────────────────────────────────────────
export const GESTURE_INFO = {
  thumbs_up:   { emoji: '👍', name: 'Thumbs Up',   color: '#10B981' },
  one_finger:  { emoji: '☝️', name: 'One Finger',  color: '#3B82F6' },
  two_fingers: { emoji: '✌️', name: 'Two Fingers', color: '#8B5CF6' },
  open_hand:   { emoji: '✋', name: 'Open Hand',   color: '#F59E0B' },
  closed_fist: { emoji: '✊', name: 'Closed Fist', color: '#EF4444' },
  ok_sign:     { emoji: '👌', name: 'OK Sign',     color: '#EC4899' },
  pinch:       { emoji: '🤏', name: 'Pinch',       color: '#14B8A6' },
  three_fingers: { emoji: '🤟', name: 'Three Fingers', color: '#6366F1' },
  rock:          { emoji: '🤘', name: 'Rock Horns',    color: '#A855F7' },
  pinky_up:      { emoji: '🖖', name: 'Pinky Only',    color: '#0EA5E9' },
  call_me:       { emoji: '🤙', name: 'Call Me',       color: '#F97316' },
};

// ── Level definitions ──────────────────────────────────────────────────────
/**
 * Client feedback: "Magic finger copy -> what is the difference between level 1
 * and 2? as i see some movements repeating in both -> like open hand, thumbs
 * up, two fingers?"
 *
 * That was real: Level 2's `allGestures` re-used three of Level 1's gestures.
 * The sets are now DISJOINT and the difficulty comes from three independent
 * dials, so the progression is obvious to a learner and to a therapist:
 *
 *   Easy   — 4 gross, whole-hand shapes, held one at a time, generous timer.
 *   Medium — 5 completely different fine-motor shapes, shorter hold + timer.
 *   Hard   — sequences of 3 shapes from both sets, fastest timer.
 *
 * Invariant enforced by the assertion below: no gesture appears in both
 * Easy and Medium.
 */
export const LEVELS = {
  1: {
    label: 'Easy',
    key: 'easy',
    // Gross motor: the whole hand moves, no individual finger isolation.
    gestures: ['open_hand', 'closed_fist', 'thumbs_up', 'one_finger'],
    challengeCount: 5,
    isSequence: false,
    holdMs: 1200,        // how long the shape must be held to score
    timeLimitMs: 15000,  // per challenge
    minAccuracy: 70,
  },
  2: {
    label: 'Medium',
    key: 'medium',
    // Fine motor: finger isolation and thumb–finger opposition.
    // NONE of these appear in Level 1.
    gestures: ['two_fingers', 'three_fingers', 'ok_sign', 'pinch', 'rock'],
    challengeCount: 6,
    isSequence: false,
    holdMs: 900,
    timeLimitMs: 11000,
    minAccuracy: 80,
  },
  3: {
    label: 'Hard',
    key: 'hard',
    // Sequences — memory + speed on top of the shapes already learned.
    sequences: [
      ['open_hand', 'closed_fist', 'thumbs_up'],
      ['two_fingers', 'ok_sign', 'closed_fist'],
      ['pinch', 'rock', 'open_hand'],
      ['one_finger', 'three_fingers', 'pinch'],
    ],
    challengeCount: 3,   // 3 sequences of 3 gestures each
    isSequence: true,
    holdMs: 650,
    timeLimitMs: 9000,   // for the whole sequence
    minAccuracy: 80,
  },
};

/* Guard rail: fail loudly in development if the level sets ever overlap again. */
if (process.env.NODE_ENV !== 'production') {
  const overlap = LEVELS[1].gestures.filter((g) => LEVELS[2].gestures.includes(g));
  if (overlap.length) {
    // eslint-disable-next-line no-console
    console.error(
      '[useGestureDetection] Level 1 and Level 2 share gestures:', overlap,
      '— levels must feel different. Fix LEVELS in useGestureDetection.js.'
    );
  }
}

/** Accepts 1|2|3 or 'easy'|'medium'|'hard'. */
export function getLevelConfig(level) {
  const map = { easy: 1, medium: 2, hard: 3 };
  const n = map[String(level).toLowerCase()] ?? Number(level);
  return LEVELS[n] || LEVELS[1];
}

/** All gestures a level can ask for (sequences flattened). */
export function gesturesForLevel(level) {
  const cfg = getLevelConfig(level);
  if (cfg.isSequence) return [...new Set(cfg.sequences.flat())];
  return cfg.gestures;
}

// ── Utility: Euclidean distance between two landmarks ──────────────────────
function dist(a, b) {
  if (!a || !b) return 999;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ── Detect which fingers are extended ──────────────────────────────────────
/**
 * Determine up/down state for each finger.
 *
 * For thumb: compare tip x-position relative to IP joint, adjusting for
 * handedness (MediaPipe mirrors the image, so 'Left' label = right hand).
 *
 * For other fingers: tip y < PIP y means extended (in normalised coords,
 * y increases downward).
 *
 * @param {Array} lm — 21-point landmark array
 * @param {string} handLabel — 'Left' or 'Right' from MediaPipe handedness
 * @returns {{ thumb, index, middle, ring, pinky }} — each 'up' or 'down'
 */
export function detectFingerStates(lm, handLabel = 'Right') {
  if (!lm || lm.length < 21) {
    return { thumb: 'down', index: 'down', middle: 'down', ring: 'down', pinky: 'down' };
  }

  // ── Thumb ────────────────────────────────────────────────────────────────
  // For a right hand (camera label 'Left' due to mirror):
  //   thumb extended = tip.x < IP.x (pointing left in camera view)
  // For a left hand (camera label 'Right' due to mirror):
  //   thumb extended = tip.x > IP.x (pointing right in camera view)
  const thumbTip = lm[LM.THUMB_TIP];
  const thumbIP  = lm[LM.THUMB_IP];
  const thumbMCP = lm[LM.THUMB_MCP];

  let thumbUp;
  // Use the distance between thumb tip and wrist compared to thumb MCP and wrist
  // as a more robust check — a truly extended thumb moves away from the palm
  const thumbTipDist = dist(thumbTip, lm[LM.INDEX_MCP]);
  const thumbIPDist  = dist(thumbIP, lm[LM.INDEX_MCP]);
  thumbUp = thumbTipDist > thumbIPDist * 1.1;

  // ── Four fingers ─────────────────────────────────────────────────────────
  // Tip further from wrist than PIP = extended (rotation invariant and more robust)
  const wrist = lm[LM.WRIST];
  const indexUp  = dist(wrist, lm[LM.INDEX_TIP]) > dist(wrist, lm[LM.INDEX_PIP]);
  const middleUp = dist(wrist, lm[LM.MIDDLE_TIP]) > dist(wrist, lm[LM.MIDDLE_PIP]);
  const ringUp   = dist(wrist, lm[LM.RING_TIP]) > dist(wrist, lm[LM.RING_PIP]);
  const pinkyUp  = dist(wrist, lm[LM.PINKY_TIP]) > dist(wrist, lm[LM.PINKY_PIP]);

  return {
    thumb:  thumbUp  ? 'up' : 'down',
    index:  indexUp  ? 'up' : 'down',
    middle: middleUp ? 'up' : 'down',
    ring:   ringUp   ? 'up' : 'down',
    pinky:  pinkyUp  ? 'up' : 'down',
  };
}

// ── Classify the current gesture ───────────────────────────────────────────
/**
 * Identify which gesture the user is currently making.
 *
 * @param {Array}  lm          — 21-point landmark array
 * @param {object} fingerStates — output of detectFingerStates
 * @returns {string|null} — gesture key or null if no match
 */
export function classifyGesture(lm, fingerStates) {
  if (!lm || lm.length < 21 || !fingerStates) return null;

  const { thumb, index, middle, ring, pinky } = fingerStates;

  // ── Special gesture: OK Sign ─────────────────────────────────────────────
  // Thumb tip touches index tip, middle/ring/pinky extended
  const thumbIndexDist = dist(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP]);
  if (thumbIndexDist < 0.07 && middle === 'up' && ring === 'up' && pinky === 'up') {
    return 'ok_sign';
  }

  // ── Special gesture: Pinch ───────────────────────────────────────────────
  // Thumb tip very close to index tip, other fingers can be anything
  if (thumbIndexDist < 0.06 && middle !== 'up') {
    return 'pinch';
  }

  // ── Pattern matching for simple gestures ─────────────────────────────────
  // Check each gesture definition against current finger states
  // Most specific patterns first so e.g. `rock` is not swallowed by a looser
  // match. Every non-special gesture in GESTURE_DEFS must be listed here.
  const simpleGestures = [
    'open_hand', 'closed_fist',
    'three_fingers', 'two_fingers', 'one_finger',
    'rock', 'call_me', 'pinky_up', 'thumbs_up',
  ];

  for (const gestureKey of simpleGestures) {
    const def = GESTURE_DEFS[gestureKey];
    if (
      thumb  === def.thumb &&
      index  === def.index &&
      middle === def.middle &&
      ring   === def.ring &&
      pinky  === def.pinky
    ) {
      return gestureKey;
    }
  }

  return null;
}

// ── Calculate accuracy against a target gesture ────────────────────────────
/**
 * Compute how closely the user's finger states match the target gesture.
 * Each correct finger contributes 20% (5 fingers × 20% = 100%).
 *
 * For special gestures (OK, Pinch), the thumb–index distance is also factored.
 *
 * @param {object} fingerStates — current finger states
 * @param {string} targetGesture — target gesture key
 * @param {Array}  lm — landmarks (for distance checks)
 * @returns {number} — 0–100 accuracy percentage
 */
export function calculateAccuracy(fingerStates, targetGesture, lm) {
  if (!fingerStates || !targetGesture) return 0;

  const def = GESTURE_DEFS[targetGesture];
  if (!def) return 0;

  const fingers = ['thumb', 'index', 'middle', 'ring', 'pinky'];
  let matchCount = 0;

  // For special gestures, handle thumb and index differently
  if (targetGesture === 'ok_sign' || targetGesture === 'pinch') {
    const thumbIndexDist = lm ? dist(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP]) : 999;

    // Thumb–index proximity check (worth 40% — 2 fingers)
    if (thumbIndexDist < 0.08) {
      matchCount += 2; // Both thumb and index are "correct"
    } else if (thumbIndexDist < 0.12) {
      matchCount += 1; // Partial credit
    }

    // Check remaining fingers
    for (const finger of ['middle', 'ring', 'pinky']) {
      const expected = def[finger];
      if (expected === 'any' || fingerStates[finger] === expected) {
        matchCount++;
      }
    }
  } else {
    // Simple pattern matching
    for (const finger of fingers) {
      if (fingerStates[finger] === def[finger]) {
        matchCount++;
      }
    }
  }

  return Math.round((matchCount / 5) * 100);
}

// ── Main hook ──────────────────────────────────────────────────────────────
/**
 * Custom hook for gesture detection and classification.
 *
 * @param {Array}       landmarks     — 21-point hand landmark array (from useHandTracking)
 * @param {object|null} multiHandData — { left, right, all } from useHandTracking
 * @param {string|null} targetGesture — current target gesture key for accuracy calc
 * @returns {object} — detection results
 */
export default function useGestureDetection(landmarks, multiHandData, targetGesture) {
  return useMemo(() => {
    const isHandDetected = !!(landmarks && landmarks.length >= 21);

    if (!isHandDetected) {
      return {
        detectedGesture: null,
        fingerStates: null,
        accuracy: 0,
        handedness: null,
        isHandDetected: false,
      };
    }

    // Determine handedness from multiHandData
    let handedness = null;
    if (multiHandData) {
      if (multiHandData.right && multiHandData.left) {
        handedness = 'both';
      } else if (multiHandData.right) {
        handedness = 'right';
      } else if (multiHandData.left) {
        handedness = 'left';
      }
    }

    // Detect finger states
    const handLabel = handedness === 'left' ? 'Right' : 'Left'; // MediaPipe mirrors
    const fingerStates = detectFingerStates(landmarks, handLabel);

    // Classify gesture
    const detectedGesture = classifyGesture(landmarks, fingerStates);

    // Calculate accuracy against target
    const accuracy = targetGesture
      ? calculateAccuracy(fingerStates, targetGesture, landmarks)
      : 0;

    return {
      detectedGesture,
      fingerStates,
      accuracy,
      handedness,
      isHandDetected,
    };
  }, [landmarks, multiHandData, targetGesture]);
}
