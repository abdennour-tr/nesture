/**
 * reflexDetectors/tlr.js
 * TLR — Tonic Labyrinthine Reflex
 *
 * Patron : corrélation entre le pitch de la tête
 * et l'extension globale des deux mains (handOpenScore).
 *
 * Détection de patrons développementaux (non diagnostique)
 */

import { pearsonCorrelation, handOpenScore, clamp, mean, hasVariation } from '../mathUtils.js';

/* A reflex the data could not support is reported as `not_measured`, never as
   `none` with a score of 0. "none" means measured and integrated; before this
   distinction existed, a camera that saw nothing produced a clean bill of
   health, and `toAiEngineFormat` sent Supabase a score of 100 — "perfectly
   integrated" — for a reflex nobody had observed. */

/**
 * @param {Array} frames - Buffer de frames récentes
 * @returns {Object} résultat TLR
 */
export function detectTLR(frames) {
  if (!frames || frames.length < 5) {
    return { score: null, label: 'not_measured', confidence: 0, detail: 'Insufficient data' };
  }

  const pitchSeries    = [];
  const handOpenSeries = [];

  for (const f of frames) {
    const pitch = f.headPitch ?? null;
    if (pitch === null) continue;

    const leftOpen  = f.leftHand  ? handOpenScore(f.leftHand)  : null;
    const rightOpen = f.rightHand ? handOpenScore(f.rightHand) : null;

    let avgOpen = null;
    if (leftOpen !== null && rightOpen !== null) avgOpen = (leftOpen + rightOpen) / 2;
    else if (leftOpen !== null) avgOpen = leftOpen;
    else if (rightOpen !== null) avgOpen = rightOpen;

    if (avgOpen !== null) {
      pitchSeries.push(pitch);
      handOpenSeries.push(avgOpen);
    }
  }

  if (pitchSeries.length < 5) {
    return { score: null, label: 'not_measured', confidence: 0, detail: 'Insufficient data' };
  }

  /* Même garde que STNR : une tête immobile ne mesure pas un TLR intégré. */
  if (!hasVariation(pitchSeries) || !hasVariation(handOpenSeries)) {
    return {
      score: null, label: 'not_measured', confidence: 0,
      detail: {
        reason: !hasVariation(pitchSeries)
          ? 'Head pitch did not vary — nothing to correlate'
          : 'Hand openness did not vary — nothing to correlate',
        frames_analyzed: pitchSeries.length,
      },
    };
  }

  // TLR : tête en hyperextension → tonus extenseur augmente (mains plus ouvertes)
  //       tête en flexion → tonus fléchisseur (mains se ferment)
  const correlation = pearsonCorrelation(pitchSeries, handOpenSeries);
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
      pitch_hand_correlation: correlation.toFixed(3),
      avg_pitch: mean(pitchSeries).toFixed(2),
      avg_hand_openness: mean(handOpenSeries).toFixed(3),
      frames_analyzed: pitchSeries.length,
    }
  };
}
