/**
 * reflexDetectors/vor.js
 * VOR — Vestibulo-Ocular Reflex
 *
 * Patron : corrélation INVERSE entre le mouvement de la tête (yaw/pitch)
 * et le mouvement compensatoire des yeux.
 * Un VOR sain = corrélation proche de -1 (yeux bougent à l'opposé de la tête).
 *
 * Détection de patrons développementaux (non diagnostique)
 */

import { pearsonCorrelation, getIrisCenter, speed2D, clamp, hasVariation } from '../mathUtils.js';

/* A reflex the data could not support is reported as `not_measured`, never as
   `none` with a score of 0. "none" means measured and integrated; before this
   distinction existed, a camera that saw nothing produced a clean bill of
   health, and `toAiEngineFormat` sent Supabase a score of 100 — "perfectly
   integrated" — for a reflex nobody had observed. */

/**
 * @param {Array} frames
 * @returns {Object}
 */
export function detectVOR(frames) {
  if (!frames || frames.length < 8) {
    return { score: null, label: 'not_measured', confidence: 0, detail: 'Insufficient data' };
  }

  const headYawSeries  = [];
  const eyeXSeries     = [];
  const headPitchSeries = [];
  const eyeYSeries     = [];

  for (const f of frames) {
    if (!f.faceMesh || f.headYaw === undefined) continue;

    const leftIris  = getIrisCenter(f.faceMesh, 'left');
    const rightIris = getIrisCenter(f.faceMesh, 'right');
    if (!leftIris || !rightIris) continue;

    const avgEyeX = (leftIris.x + rightIris.x) / 2;
    const avgEyeY = (leftIris.y + rightIris.y) / 2;

    headYawSeries.push(f.headYaw);
    eyeXSeries.push(avgEyeX);
    headPitchSeries.push(f.headPitch ?? 0);
    eyeYSeries.push(avgEyeY);
  }

  if (headYawSeries.length < 8) {
    return { score: null, label: 'not_measured', confidence: 0, detail: 'Insufficient iris data' };
  }

  if (!hasVariation(headYawSeries) && !hasVariation(headPitchSeries)) {
    return {
      score: null, label: 'not_measured', confidence: 0,
      detail: {
        reason: 'Head did not move — a VOR cannot be observed without head motion',
        frames_analyzed: headYawSeries.length,
      },
    };
  }

  // VOR horizontal : tête droite → yeux gauche (corrélation négative)
  const corrHorizontal = pearsonCorrelation(headYawSeries, eyeXSeries);
  // VOR vertical
  const corrVertical   = pearsonCorrelation(headPitchSeries, eyeYSeries);

  // Score VOR sain = corrélation très négative
  // corrélation = -1 : VOR parfait
  // corrélation = 0  : pas de VOR
  // corrélation = +1 : mouvement oculaire dans même direction que la tête (très anormal)
  const vorQuality = -(corrHorizontal + corrVertical) / 2; // [-1, 1], 1 = bon VOR

  // Rétention = absence de VOR (vorQuality bas)
  // Score de rétention = (1 - vorQuality) / 2 → [0, 1] → × 100
  const retentionScore = clamp(Math.round((1 - clamp(vorQuality, -1, 1)) / 2 * 100), 0, 100);

  const label = retentionScore >= 65 ? 'strong'
    : retentionScore >= 40 ? 'moderate'
    : retentionScore >= 20 ? 'weak'
    : 'none';

  /* Confidence is the share of the frames that COULD have carried this signal,
     not of every camera frame. The face mesh is deliberately computed on one
     frame in five, so denominating against all frames capped every face-based
     reflex at 0.20 confidence — permanently below any reporting threshold, which
     would have quietly excluded the eye reflexes from every session report. */
  const faceFrames = frames.filter(f => f.faceMesh).length || frames.length;
  return {
    score: retentionScore,
    label,
    confidence: clamp(headYawSeries.length / faceFrames, 0, 1),
    detail: {
      horizontal_vor_correlation: corrHorizontal.toFixed(3),
      vertical_vor_correlation: corrVertical.toFixed(3),
      vor_quality_index: vorQuality.toFixed(3),
      frames_analyzed: headYawSeries.length,
    }
  };
}
