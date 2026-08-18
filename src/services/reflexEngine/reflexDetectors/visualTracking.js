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

const LATENCY_TEST_OFFSETS = [0, 1, 2, 3, 4, 5]; // frames de décalage à tester

/**
 * @param {Array} frames
 * @returns {Object}
 */
export function detectVisualTracking(frames) {
  if (!frames || frames.length < 10) {
    return {
      score: 0, label: 'none', confidence: 0,
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
      score: 0, label: 'none', confidence: 0,
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
    score: retentionScore,
    label,
    confidence: clamp(fingerSpeedSeries.length / frames.length, 0, 1),
    detail: {
      best_correlation: bestCorr.toFixed(3),
      latency_frames: bestOffset,
      latency_ms: latencyMs,
      avg_finger_speed: mean(fingerSpeedSeries).toFixed(4),
      avg_eye_speed: mean(eyeSpeedSeries).toFixed(4),
      frames_analyzed: fingerSpeedSeries.length,
    }
  };
}
