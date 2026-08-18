/**
 * reflexDetectors/eyeCoordination.js
 * Eye Coordination Index
 *
 * Mesure la corrélation entre les mouvements des deux yeux.
 * Un index élevé = bonne coordination binoculaire.
 * Une corrélation faible = possible dysfonction de vergence.
 *
 * Détection de patrons développementaux (non diagnostique)
 */

import { getIrisCenter, pearsonCorrelation, clamp } from '../mathUtils.js';

/**
 * @param {Array} frames
 * @returns {Object}
 */
export function detectEyeCoordination(frames) {
  if (!frames || frames.length < 8) {
    return {
      score: 0, label: 'none', confidence: 0,
      detail: 'Insufficient data'
    };
  }

  const leftXSeries  = [];
  const rightXSeries = [];
  const leftYSeries  = [];
  const rightYSeries = [];

  for (const f of frames) {
    if (!f.faceMesh) continue;

    const leftIris  = getIrisCenter(f.faceMesh, 'left');
    const rightIris = getIrisCenter(f.faceMesh, 'right');
    if (!leftIris || !rightIris) continue;

    leftXSeries.push(leftIris.x);
    rightXSeries.push(rightIris.x);
    leftYSeries.push(leftIris.y);
    rightYSeries.push(rightIris.y);
  }

  if (leftXSeries.length < 8) {
    return {
      score: 0, label: 'none', confidence: 0,
      detail: 'Insufficient iris data'
    };
  }

  // Corrélation horizontale (mouvement conjugué gauche-droite)
  const corrX = pearsonCorrelation(leftXSeries, rightXSeries);
  // Corrélation verticale
  const corrY = pearsonCorrelation(leftYSeries, rightYSeries);

  // Index de coordination = moyenne des deux corrélations
  // 1.0 = mouvement parfaitement synchronisé (bon)
  // 0.0 = aucune coordination
  const coordinationIndex = (corrX + corrY) / 2;

  // Score de rétention = absence de coordination
  const retentionScore = clamp(Math.round((1 - clamp(coordinationIndex, 0, 1)) * 100), 0, 100);

  const label = retentionScore >= 65 ? 'strong'
    : retentionScore >= 40 ? 'moderate'
    : retentionScore >= 20 ? 'weak'
    : 'none';

  return {
    score: retentionScore,
    label,
    confidence: clamp(leftXSeries.length / frames.length, 0, 1),
    detail: {
      horizontal_correlation: corrX.toFixed(3),
      vertical_correlation: corrY.toFixed(3),
      coordination_index: coordinationIndex.toFixed(3),
      frames_with_iris: leftXSeries.length,
      frames_analyzed: frames.length,
    }
  };
}
