/**
 * reflexDetectors/handToMouth.js
 * Hand-to-Mouth / Rooting Reflex (Proxy)
 *
 * Mesures :
 *   - Distance main-bouche
 *   - Vitesse d'approche
 *   - Réaction de la bouche (ouverture)
 *   - Alignement tête-main
 *
 * Détection de patrons développementaux (non diagnostique)
 */

import {
  distance2D,
  getMouthCenter,
  mouthOpenScore,
  speed2D,
  clamp,
  mean,
} from '../mathUtils.js';

const APPROACH_THRESHOLD = 0.30; // distance normalisée main-bouche pour "proche"
const MOUTH_REACT_THRESHOLD = 0.025; // ouverture minimale pour "bouche réagit"

/**
 * @param {Array} frames
 * @returns {Object}
 */
export function detectHandToMouth(frames) {
  if (!frames || frames.length < 4) {
    return {
      score: 0, label: 'none', confidence: 0,
      events: 0, detail: 'Insufficient data'
    };
  }

  let approachEvents = 0;
  const approachDistances = [];
  const approachSpeeds    = [];

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const curr = frames[i];
    const dt   = curr.timestamp - prev.timestamp;
    if (dt <= 0) continue;

    const mouthCenter = curr.faceMesh ? getMouthCenter(curr.faceMesh) : null;
    if (!mouthCenter) continue;

    // Vérifier les deux mains
    for (const side of ['leftHand', 'rightHand']) {
      const currHand = curr[side];
      const prevHand = prev[side];
      if (!currHand) continue;

      // Utiliser l'index tip (point 8) comme extrémité de la main
      const indexTip = currHand[8];
      if (!indexTip) continue;

      const dist = distance2D(indexTip, mouthCenter);
      approachDistances.push(dist);

      if (prevHand) {
        const prevIndexTip = prevHand[8];
        if (prevIndexTip) {
          const prevDist = distance2D(prevIndexTip, mouthCenter);
          const approachRate = (prevDist - dist) / (dt / 1000); // positif = approche

          if (approachRate > 0.1 && dist < APPROACH_THRESHOLD) {
            approachSpeeds.push(approachRate);

            // Vérifier si la bouche s'ouvre en réponse
            const mouthOpen = mouthOpenScore(curr.faceMesh);
            if (mouthOpen > MOUTH_REACT_THRESHOLD) {
              approachEvents++;
            }
          }
        }
      }
    }
  }

  const avgDist  = mean(approachDistances);
  const avgSpeed = mean(approachSpeeds);

  // Score de rétention : approches fréquentes + réaction buccale
  const proximityScore = clamp(1 - avgDist / APPROACH_THRESHOLD, 0, 1);
  const reactionRate   = approachEvents / Math.max(1, approachSpeeds.length);
  const retentionScore = clamp(Math.round((proximityScore * 40) + (reactionRate * 60)), 0, 100);

  const label = retentionScore >= 65 ? 'strong'
    : retentionScore >= 40 ? 'moderate'
    : retentionScore >= 20 ? 'weak'
    : 'none';

  const hasFace = frames.some(f => f.faceMesh);
  const hasHand = frames.some(f => f.leftHand || f.rightHand);

  return {
    score: retentionScore,
    label,
    confidence: hasFace && hasHand ? 0.75 : 0.2,
    events: approachEvents,
    detail: {
      avg_hand_mouth_distance: avgDist.toFixed(3),
      avg_approach_speed: avgSpeed.toFixed(3),
      mouth_reactions: approachEvents,
      proximity_score: proximityScore.toFixed(3),
      frames_analyzed: frames.length,
    }
  };
}
