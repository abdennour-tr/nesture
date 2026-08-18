/**
 * reflexDetectors/palmarGrasp.js
 * Palmar Grasp Reflex — Détaillé
 *
 * Détecte :
 *   A) Score de fermeture (diminution rapide distance doigts–poignet)
 *   B) Vitesse de réponse
 *   C) Symétrie entre les deux mains
 *
 * Détection de patrons développementaux (non diagnostique)
 */

import {
  fingersToWristDistance,
  handOpenScore,
  clamp,
  mean,
  stddev,
} from '../mathUtils.js';

const CLOSE_THRESHOLD = 0.05; // variation par seconde pour définir "fermeture rapide"

/**
 * @param {Array} frames
 * @returns {Object}
 */
export function detectPalmarGrasp(frames) {
  if (!frames || frames.length < 4) {
    return {
      score: 0, label: 'none', confidence: 0,
      left: null, right: null, bilateral: null,
      detail: 'Insufficient data'
    };
  }

  const leftScores  = [];
  const rightScores = [];
  const leftClosingEvents  = [];
  const rightClosingEvents = [];

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const curr = frames[i];
    const dt   = (curr.timestamp - prev.timestamp) / 1000 || 0.033;

    if (curr.leftHand && prev.leftHand) {
      const prevDist = fingersToWristDistance(prev.leftHand);
      const currDist = fingersToWristDistance(curr.leftHand);
      const closingSpeed = (prevDist - currDist) / dt;
      leftScores.push(handOpenScore(curr.leftHand));
      if (closingSpeed > CLOSE_THRESHOLD) leftClosingEvents.push(closingSpeed);
    }

    if (curr.rightHand && prev.rightHand) {
      const prevDist = fingersToWristDistance(prev.rightHand);
      const currDist = fingersToWristDistance(curr.rightHand);
      const closingSpeed = (prevDist - currDist) / dt;
      rightScores.push(handOpenScore(curr.rightHand));
      if (closingSpeed > CLOSE_THRESHOLD) rightClosingEvents.push(closingSpeed);
    }
  }

  const leftMeanOpen  = mean(leftScores);
  const rightMeanOpen = mean(rightScores);
  const leftStdDev    = stddev(leftScores);
  const rightStdDev   = stddev(rightScores);

  // Symétrie : différence de fermeture entre les deux mains (0 = symétrique)
  const symmetryDiff = leftScores.length > 0 && rightScores.length > 0
    ? Math.abs(leftMeanOpen - rightMeanOpen)
    : 0;
  const symmetryScore = clamp(1 - symmetryDiff * 4, 0, 1);

  // Score de rétention = main très fermée avec fermetures rapides répétées
  const avgOpen = (leftMeanOpen + rightMeanOpen) / 2;
  const closingRate = (leftClosingEvents.length + rightClosingEvents.length) / Math.max(1, frames.length);
  const retentionScore = clamp(Math.round((closingRate * 50) + ((1 - avgOpen) * 50)), 0, 100);

  const label = retentionScore >= 65 ? 'strong'
    : retentionScore >= 40 ? 'moderate'
    : retentionScore >= 20 ? 'weak'
    : 'none';

  return {
    score: retentionScore,
    label,
    confidence: clamp((leftScores.length + rightScores.length) / (2 * frames.length), 0, 1),
    left: {
      mean_openness: leftMeanOpen.toFixed(3),
      closing_events: leftClosingEvents.length,
      variability: leftStdDev.toFixed(3),
    },
    right: {
      mean_openness: rightMeanOpen.toFixed(3),
      closing_events: rightClosingEvents.length,
      variability: rightStdDev.toFixed(3),
    },
    bilateral: {
      symmetry_score: symmetryScore.toFixed(3),
      total_closing_events: leftClosingEvents.length + rightClosingEvents.length,
    },
    detail: {
      avg_hand_openness: avgOpen.toFixed(3),
      closing_rate_per_frame: closingRate.toFixed(3),
    }
  };
}
