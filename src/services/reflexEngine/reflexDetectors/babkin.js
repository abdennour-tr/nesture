/**
 * reflexDetectors/babkin.js
 * Babkin Reflex — Multimodal avec contrainte temporelle
 *
 * Séquence à détecter dans une fenêtre de 300–800 ms :
 *   1) Fermeture bilatérale des mains
 *   2) Ouverture de la bouche
 *   3) Mouvement de la tête (optionnel — renforce le score)
 *
 * Détection de patrons développementaux (non diagnostique)
 */

import {
  handOpenScore,
  mouthOpenScore,
  clamp,
} from '../mathUtils.js';

/* A reflex the data could not support is reported as `not_measured`, never as
   `none` with a score of 0. "none" means measured and integrated; before this
   distinction existed, a camera that saw nothing produced a clean bill of
   health, and `toAiEngineFormat` sent Supabase a score of 100 — "perfectly
   integrated" — for a reflex nobody had observed. */

const BABKIN_MIN_MS = 300;
const BABKIN_MAX_MS = 800;
const HAND_CLOSE_THRESHOLD = 0.35; // score < threshold → main fermée
const MOUTH_OPEN_THRESHOLD = 0.02; // distance relative lèvres pour bouche ouverte

/**
 * @param {Array} frames
 * @returns {Object}
 */
export function detectBabkin(frames) {
  if (!frames || frames.length < 6) {
    return {
      score: null, label: 'not_measured', confidence: 0,
      events: 0, detail: 'Insufficient data'
    };
  }

  let babkinEvents = 0;
  let state = 'idle';
  let phaseStartTime = null;
  let mouthOpenedDuringPhase = false;
  let headMovedDuringPhase   = false;

  const initialHeadPitch = frames[0]?.headPitch ?? 0;
  const initialHeadYaw   = frames[0]?.headYaw   ?? 0;

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const ts = f.timestamp;

    const leftOpen  = f.leftHand  ? handOpenScore(f.leftHand)  : 1; // 1 = main ouverte (pas de données)
    const rightOpen = f.rightHand ? handOpenScore(f.rightHand) : 1;
    const bothHandsClosed = leftOpen < HAND_CLOSE_THRESHOLD && rightOpen < HAND_CLOSE_THRESHOLD;

    const mouthOpen = f.faceMesh ? mouthOpenScore(f.faceMesh) : 0;
    const headMoved = f.headPitch !== undefined
      ? Math.abs(f.headPitch - initialHeadPitch) > 5 || Math.abs(f.headYaw - initialHeadYaw) > 5
      : false;

    if (state === 'idle' && bothHandsClosed) {
      state = 'hands_closed';
      phaseStartTime = ts;
      mouthOpenedDuringPhase = mouthOpen > MOUTH_OPEN_THRESHOLD;
      headMovedDuringPhase   = headMoved;
    } else if (state === 'hands_closed') {
      const elapsed = ts - phaseStartTime;

      if (mouthOpen > MOUTH_OPEN_THRESHOLD) mouthOpenedDuringPhase = true;
      if (headMoved) headMovedDuringPhase = true;

      if (elapsed >= BABKIN_MIN_MS && elapsed <= BABKIN_MAX_MS) {
        if (mouthOpenedDuringPhase) {
          babkinEvents++;
          if (headMovedDuringPhase) babkinEvents += 0.5; // bonus séquence complète
          state = 'idle';
        }
      } else if (elapsed > BABKIN_MAX_MS) {
        // Fenêtre temporelle dépassée
        state = 'idle';
      }

      // Reset si les mains s'ouvrent avant complétion
      if (!bothHandsClosed) state = 'idle';
    }
  }

  /* The Babkin sequence is hands-then-mouth: it needs both hands AND the face
     in the same frames. Without them the loop simply never fires and the old
     code returned score 0 / "none" — an integrated reflex, inferred from a
     sequence that could not have been seen even if it had happened. */
  const usableFrames = frames.filter(f => f.leftHand && f.rightHand && f.faceMesh).length;
  const MIN_USABLE = 15;
  if (usableFrames < MIN_USABLE) {
    return {
      score: null, label: 'not_measured', confidence: 0, events: 0,
      detail: {
        reason: 'Both hands and the face were not in view together long enough',
        usable_frames: usableFrames,
        required: MIN_USABLE,
        frames_analyzed: frames.length,
      },
    };
  }

  const eventScore = clamp(Math.round((babkinEvents / Math.max(1, frames.length / 60)) * 80), 0, 100);

  const label = eventScore >= 65 ? 'strong'
    : eventScore >= 40 ? 'moderate'
    : eventScore >= 20 ? 'weak'
    : 'none';

  return {
    score: eventScore,
    label,
    confidence: clamp(usableFrames / frames.length, 0, 1),
    events: Math.floor(babkinEvents),
    detail: {
      babkin_sequences_detected: babkinEvents,
      temporal_window_ms: `${BABKIN_MIN_MS}–${BABKIN_MAX_MS}`,
      hand_close_threshold: HAND_CLOSE_THRESHOLD,
      mouth_open_threshold: MOUTH_OPEN_THRESHOLD,
      frames_analyzed: frames.length,
    }
  };
}
