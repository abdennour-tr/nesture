/**
 * reflexDetectors/stnr.js
 * STNR — Symmetrical Tonic Neck Reflex
 *
 * Patron : corrélation entre l'inclinaison verticale de la tête (pitch)
 * et l'extension moyenne des deux index.
 *
 * Détection de patrons développementaux (non diagnostique)
 */

import { pearsonCorrelation, indexExtension, clamp, mean, hasVariation } from '../mathUtils.js';

/* A reflex the data could not support is reported as `not_measured`, never as
   `none` with a score of 0. "none" means measured and integrated; before this
   distinction existed, a camera that saw nothing produced a clean bill of
   health, and `toAiEngineFormat` sent Supabase a score of 100 — "perfectly
   integrated" — for a reflex nobody had observed. */

/**
 * @param {Array} frames - Buffer de frames récentes
 * @returns {Object} résultat STNR
 */
export function detectSTNR(frames) {
  if (!frames || frames.length < 5) {
    return { score: null, label: 'not_measured', confidence: 0, detail: 'Insufficient data' };
  }

  const pitchSeries  = [];
  const avgExtSeries = [];

  for (const f of frames) {
    const pitch = f.headPitch ?? 0;
    const leftExt  = f.leftHand  ? indexExtension(f.leftHand)  : null;
    const rightExt = f.rightHand ? indexExtension(f.rightHand) : null;

    if (leftExt !== null && rightExt !== null) {
      pitchSeries.push(pitch);
      avgExtSeries.push((leftExt + rightExt) / 2);
    } else if (leftExt !== null) {
      pitchSeries.push(pitch);
      avgExtSeries.push(leftExt);
    } else if (rightExt !== null) {
      pitchSeries.push(pitch);
      avgExtSeries.push(rightExt);
    }
  }

  if (pitchSeries.length < 5) {
    return { score: null, label: 'not_measured', confidence: 0, detail: 'Insufficient data' };
  }

  /* Sans variation du pitch, il n'y a rien à corréler : le score de 0 qui en
     sortait se lisait comme « intégré ». */
  if (!hasVariation(pitchSeries) || !hasVariation(avgExtSeries)) {
    return {
      score: null, label: 'not_measured', confidence: 0,
      detail: {
        reason: !hasVariation(pitchSeries)
          ? 'Head pitch did not vary — nothing to correlate'
          : 'Arm extension did not vary — nothing to correlate',
        frames_analyzed: pitchSeries.length,
      },
    };
  }

  // STNR : tête en extension (pitch+) → bras s'étendent
  //        tête en flexion (pitch-) → bras se fléchissent
  const correlation = pearsonCorrelation(pitchSeries, avgExtSeries);

  // Corrélation forte positive = patron STNR présent
  const retentionScore = clamp(Math.round(Math.abs(correlation) * 100), 0, 100);

  const label = retentionScore >= 65 ? 'strong'
    : retentionScore >= 40 ? 'moderate'
    : retentionScore >= 20 ? 'weak'
    : 'none';

  return {
    score: retentionScore,
    label,
    confidence: clamp(pitchSeries.length / frames.length, 0, 1),
    detail: {
      pitch_extension_correlation: correlation.toFixed(3),
      avg_pitch: mean(pitchSeries).toFixed(2),
      avg_extension: mean(avgExtSeries).toFixed(3),
      frames_analyzed: pitchSeries.length,
    }
  };
}
