/**
 * reflexDetectors/moro.js
 * Moro Reflex
 *
 * Patron : mouvement simultané des deux mains vers l'extérieur
 * puis vers l'intérieur (réponse de sursaut).
 *
 * Détection de patrons développementaux (non diagnostique)
 */

import { distance3D, speed, clamp } from '../mathUtils.js';

/* A reflex the data could not support is reported as `not_measured`, never as
   `none` with a score of 0. "none" means measured and integrated; before this
   distinction existed, a camera that saw nothing produced a clean bill of
   health, and `toAiEngineFormat` sent Supabase a score of 100 — "perfectly
   integrated" — for a reflex nobody had observed. */

const OUTWARD_THRESHOLD  = 0.04; // vitesse min pour mouvement vers l'extérieur
const INWARD_THRESHOLD   = 0.03; // vitesse min pour mouvement vers l'intérieur
const TIME_WINDOW_MS     = 1200; // la séquence doit se produire dans ce délai

/**
 * Détecte les événements Moro (abduction → adduction bilatérale soudaine)
 * @param {Array} frames
 * @returns {Object}
 */
export function detectMoro(frames) {
  if (!frames || frames.length < 6) {
    return { score: null, label: 'not_measured', confidence: 0, events: 0, detail: 'Insufficient data' };
  }

  let moroEvents = 0;
  let state = 'idle'; // idle | outward | waiting_inward
  let outwardStartTime = null;

  const wristPositions = frames.map(f => {
    const left  = f.leftHand  ? f.leftHand[0]  : null;
    const right = f.rightHand ? f.rightHand[0] : null;
    return { left, right, ts: f.timestamp };
  }).filter(p => p.left && p.right);

  /* Moro is a BILATERAL pattern: it needs both wrists. With one hand in view —
     which is Letter Quest's normal case — the old code found zero events and
     reported score 0 / "none", i.e. "integrated". Finding no evidence of a
     reflex you had no way to observe is not the same as observing its absence. */
  const MIN_BILATERAL_FRAMES = 15;
  if (wristPositions.length < MIN_BILATERAL_FRAMES) {
    return {
      score: null, label: 'not_measured', confidence: 0, events: 0,
      detail: {
        reason: 'Both hands were not in view long enough — Moro is bilateral',
        frames_with_both_hands: wristPositions.length,
        required: MIN_BILATERAL_FRAMES,
        frames_analyzed: frames.length,
      },
    };
  }

  for (let i = 1; i < wristPositions.length; i++) {
    const prev = wristPositions[i - 1];
    const curr = wristPositions[i];
    const dt   = curr.ts - prev.ts;
    if (dt <= 0) continue;

    // Vitesse de séparation (distance entre mains augmente → abduction)
    const prevDist = distance3D(prev.left, prev.right);
    const currDist = distance3D(curr.left, curr.right);
    const deltaD   = (currDist - prevDist) / (dt / 1000);

    if (state === 'idle' && deltaD > OUTWARD_THRESHOLD) {
      state = 'outward';
      outwardStartTime = curr.ts;
    } else if (state === 'outward' && deltaD < -INWARD_THRESHOLD) {
      // Mouvement vers l'intérieur détecté après abduction
      if (curr.ts - outwardStartTime <= TIME_WINDOW_MS) {
        moroEvents++;
      }
      state = 'idle';
    } else if (state === 'outward' && curr.ts - outwardStartTime > TIME_WINDOW_MS) {
      // Timeout — la séquence n'a pas été complétée
      state = 'idle';
    }
  }

  // Normaliser le nombre d'événements (>3 = fort patron)
  const retentionScore = clamp(Math.round((moroEvents / Math.max(1, frames.length / 30)) * 50), 0, 100);

  const label = retentionScore >= 65 ? 'strong'
    : retentionScore >= 40 ? 'moderate'
    : retentionScore >= 20 ? 'weak'
    : 'none';

  return {
    score: retentionScore,
    label,
    confidence: clamp(wristPositions.length / frames.length, 0, 1),
    events: moroEvents,
    detail: {
      moro_events_detected: moroEvents,
      frames_with_both_hands: wristPositions.length,
      duration_analyzed_ms: wristPositions.length > 1
        ? wristPositions[wristPositions.length - 1].ts - wristPositions[0].ts
        : 0,
    }
  };
}
