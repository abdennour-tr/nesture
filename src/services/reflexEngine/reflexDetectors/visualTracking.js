/**
 * reflexDetectors/visualTracking.js
 * Visual Tracking
 *
 * Mesure la corrélation entre la vitesse du doigt cible
 * et la vitesse des yeux, avec estimation de la latence.
 *
 * Détection de patrons développementaux (non diagnostique)
 */

import {
  getIrisCenter,
  pearsonCorrelation,
  speed2D,
  speed,
  clamp,
  mean,
} from '../mathUtils.js';

/* A reflex the data could not support is reported as `not_measured`, never as
   `none` with a score of 0. "none" means measured and integrated; before this
   distinction existed, a camera that saw nothing produced a clean bill of
   health, and `toAiEngineFormat` sent Supabase a score of 100 — "perfectly
   integrated" — for a reflex nobody had observed. */

const LATENCY_TEST_OFFSETS = [0, 1, 2, 3, 4, 5]; // frames de décalage à tester

/**
 * @param {Array} frames
 * @returns {Object}
 */
/* ── Suspended ─────────────────────────────────────────────────────────────
   This detector reported "strong" on essentially every session — 96 to 99 out
   of 100 even on clean synthetic data where the eyes tracked the hand. Two
   reasons, both structural:

     1. It correlates finger SPEED with eye SPEED. Two signals that both rise
        and fall but not in lockstep correlate near zero, so `1 - corr` lands
        near 1 whatever the child does.
     2. "Eye speed" comes from the iris centre in absolute image coordinates,
        which moves when the head moves even if the gaze is perfectly still.
        It cannot separate gaze from head translation.

   Reporting it would put "Attention Required" on every session report and bury
   the reflexes that ARE measured. It is suspended rather than deleted: the
   measurement below still runs and is returned in `detail`, so the correlation
   can be reviewed against real recordings before the scoring is redesigned
   with the occupational therapist.  */
const SUSPENDED = true;

export function detectVisualTracking(frames) {
  if (!frames || frames.length < 10) {
    return {
      score: null, label: 'not_measured', confidence: 0,
      detail: 'Insufficient data'
    };
  }

  const fingerSpeedSeries = [];
  const eyeSpeedSeries    = [];

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const curr = frames[i];
    const dt   = curr.timestamp - prev.timestamp;
    if (dt <= 0) continue;

    // Vitesse du doigt index de la main dominante (préférer la droite)
    const hand     = curr.rightHand || curr.leftHand;
    const prevHand = prev.rightHand || prev.leftHand;
    if (!hand || !prevHand) continue;

    const currTip  = hand[8];    // Index tip
    const prevTip  = prevHand[8];
    if (!currTip || !prevTip) continue;

    const fingerSpd = speed(prevTip, currTip, dt);

    // Vitesse des yeux (centroïde iris)
    if (!curr.faceMesh || !prev.faceMesh) continue;
    const currLeftIris  = getIrisCenter(curr.faceMesh, 'left');
    const currRightIris = getIrisCenter(curr.faceMesh, 'right');
    const prevLeftIris  = getIrisCenter(prev.faceMesh, 'left');
    const prevRightIris = getIrisCenter(prev.faceMesh, 'right');
    if (!currLeftIris || !prevLeftIris) continue;

    // Centroïde des deux iris
    const currEye = {
      x: ((currLeftIris.x + (currRightIris?.x || currLeftIris.x)) / 2),
      y: ((currLeftIris.y + (currRightIris?.y || currLeftIris.y)) / 2),
    };
    const prevEye = {
      x: ((prevLeftIris.x + (prevRightIris?.x || prevLeftIris.x)) / 2),
      y: ((prevLeftIris.y + (prevRightIris?.y || prevLeftIris.y)) / 2),
    };

    const eyeSpd = speed2D(prevEye, currEye, dt);

    fingerSpeedSeries.push(fingerSpd);
    eyeSpeedSeries.push(eyeSpd);
  }

  if (fingerSpeedSeries.length < 8) {
    return {
      score: null, label: 'not_measured', confidence: 0,
      detail: 'Insufficient complete frames'
    };
  }

  // Tester différents décalages pour trouver la meilleure corrélation (latence)
  let bestCorr   = -1;
  let bestOffset = 0;

  for (const offset of LATENCY_TEST_OFFSETS) {
    const a = fingerSpeedSeries.slice(0, fingerSpeedSeries.length - offset);
    const b = eyeSpeedSeries.slice(offset);
    if (a.length < 5) continue;
    const corr = pearsonCorrelation(a, b);
    if (corr > bestCorr) {
      bestCorr   = corr;
      bestOffset = offset;
    }
  }

  // Score de rétention : tracking faible = corrélation basse
  const retentionScore = clamp(Math.round((1 - clamp(bestCorr, 0, 1)) * 100), 0, 100);

  const label = retentionScore >= 65 ? 'strong'
    : retentionScore >= 40 ? 'moderate'
    : retentionScore >= 20 ? 'weak'
    : 'none';

  // Estimation de la latence en ms (1 frame ≈ 33ms à 30fps)
  const frameDurations = [];
  for (let i = 1; i < frames.length; i++) {
    frameDurations.push(frames[i].timestamp - frames[i - 1].timestamp);
  }
  const avgFrameMs = mean(frameDurations) || 33;
  const latencyMs  = Math.round(bestOffset * avgFrameMs);

  return {
    score: SUSPENDED ? null : retentionScore,
    label: SUSPENDED ? 'not_measured' : label,
    confidence: SUSPENDED ? 0 : clamp(fingerSpeedSeries.length / frames.length, 0, 1),
    detail: {
      suspended: SUSPENDED ? 'Scoring suspended pending redesign — see file header' : undefined,
      would_have_scored: retentionScore,
      best_correlation: bestCorr.toFixed(3),
      latency_frames: bestOffset,
      latency_ms: latencyMs,
      avg_finger_speed: mean(fingerSpeedSeries).toFixed(4),
      avg_eye_speed: mean(eyeSpeedSeries).toFixed(4),
      frames_analyzed: fingerSpeedSeries.length,
    }
  };
}
