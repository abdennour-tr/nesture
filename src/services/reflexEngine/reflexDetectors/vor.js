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

import { pearsonCorrelation, getIrisCenter, speed2D, clamp } from '../mathUtils.js';

/**
 * @param {Array} frames
 * @returns {Object}
 */
export function detectVOR(frames) {
  if (!frames || frames.length < 8) {
    return { score: 0, label: 'none', confidence: 0, detail: 'Insufficient data' };
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
    return { score: 0, label: 'none', confidence: 0, detail: 'Insufficient iris data' };
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

  return {
    score: retentionScore,
    label,
    confidence: clamp(headYawSeries.length / frames.length, 0, 1),
    detail: {
      horizontal_vor_correlation: corrHorizontal.toFixed(3),
      vertical_vor_correlation: corrVertical.toFixed(3),
      vor_quality_index: vorQuality.toFixed(3),
      frames_analyzed: headYawSeries.length,
    }
  };
}
