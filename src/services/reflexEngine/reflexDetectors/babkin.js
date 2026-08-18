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
      score: 0, label: 'none', confidence: 0,
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

  const eventScore = clamp(Math.round((babkinEvents / Math.max(1, frames.length / 60)) * 80), 0, 100);

  const label = eventScore >= 65 ? 'strong'
    : eventScore >= 40 ? 'moderate'
    : eventScore >= 20 ? 'weak'
    : 'none';

  const hasValidData = frames.some(f => f.leftHand && f.rightHand && f.faceMesh);

  return {
    score: eventScore,
    label,
    confidence: hasValidData ? 0.7 : 0.1,
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
