/**
 * reflexDetectors/atnr.js
 * ATNR — Asymmetrical Tonic Neck Reflex
 *
 * Patron : corrélation entre la rotation latérale de la tête (yaw)
 * et l'extension asymétrique des index droit et gauche.
 *
 * Détection de patrons développementaux (non diagnostique)
 */

import { pearsonCorrelation, indexExtension, clamp } from '../mathUtils.js';

/**
 * @param {Array} frames - Buffer de frames récentes
 * @returns {Object} résultat ATNR
 */
export function detectATNR(frames) {
  if (!frames || frames.length < 5) {
    return { score: 0, label: 'none', confidence: 0, detail: 'Insufficient data' };
  }

  const yawSeries     = [];
  const leftExtSeries = [];
  const rightExtSeries = [];

  for (const f of frames) {
    const yaw = f.headYaw ?? 0;

    const leftExt  = f.leftHand  ? indexExtension(f.leftHand)  : null;
    const rightExt = f.rightHand ? indexExtension(f.rightHand) : null;

    if (leftExt !== null && rightExt !== null) {
      yawSeries.push(yaw);
      leftExtSeries.push(leftExt);
      rightExtSeries.push(rightExt);
    }
  }

  if (yawSeries.length < 5) {
    return { score: 0, label: 'none', confidence: 0, detail: 'Insufficient bimanual data' };
  }

  // Quand tête tourne à droite (yaw+), le bras droit devrait s'étendre (ATNR)
  // et le bras gauche se fléchir → corrélation positive yaw↔right, négative yaw↔left
  const corrRight = pearsonCorrelation(yawSeries, rightExtSeries);
  const corrLeft  = pearsonCorrelation(yawSeries, leftExtSeries);

  // Asymétrie = différence entre les deux corrélations
  const asymmetry = (corrRight - corrLeft) / 2; // [-1, 1]

  // Un score élevé d'asymétrie indique une rétention ATNR
  const rawScore = Math.abs(asymmetry);

  // Convertir en score de rétention [0-100] où 0 = intégré, 100 = fort patron
  const retentionScore = clamp(Math.round(rawScore * 100), 0, 100);

  const label = retentionScore >= 65 ? 'strong'
    : retentionScore >= 40 ? 'moderate'
    : retentionScore >= 20 ? 'weak'
    : 'none';

  return {
    score: retentionScore,
    label,
    confidence: clamp(yawSeries.length / frames.length, 0, 1),
    detail: {
      yaw_right_correlation: corrRight.toFixed(3),
      yaw_left_correlation: corrLeft.toFixed(3),
      asymmetry_index: asymmetry.toFixed(3),
      frames_analyzed: yawSeries.length,
    }
  };
}
