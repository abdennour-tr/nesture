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

/* A reflex the data could not support is reported as `not_measured`, never as
   `none` with a score of 0. "none" means measured and integrated; before this
   distinction existed, a camera that saw nothing produced a clean bill of
   health, and `toAiEngineFormat` sent Supabase a score of 100 — "perfectly
   integrated" — for a reflex nobody had observed. */

/**
 * @param {Array} frames
 * @returns {Object}
 */
export function detectEyeCoordination(frames) {
  if (!frames || frames.length < 8) {
    return {
      score: null, label: 'not_measured', confidence: 0,
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
      score: null, label: 'not_measured', confidence: 0,
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

  /* Confidence is the share of the frames that COULD have carried this signal,
     not of every camera frame. The face mesh is deliberately computed on one
     frame in five, so denominating against all frames capped every face-based
     reflex at 0.20 confidence — permanently below any reporting threshold, which
     would have quietly excluded the eye reflexes from every session report. */
  const faceFrames = frames.filter(f => f.faceMesh).length || frames.length;
  return {
    score: retentionScore,
    label,
    confidence: clamp(leftXSeries.length / faceFrames, 0, 1),
    detail: {
      horizontal_correlation: corrX.toFixed(3),
      vertical_correlation: corrY.toFixed(3),
      coordination_index: coordinationIndex.toFixed(3),
      frames_with_iris: leftXSeries.length,
      frames_analyzed: frames.length,
    }
  };
}
