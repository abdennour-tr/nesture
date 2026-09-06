/**
 * otScore.js
 * ---------------------------------------------------------------------------
 * One rule for turning OT sub-scores into a composite, shared by every game.
 *
 * THE RULE: absence of evidence is not a perfect performance.
 *
 * Every game had the same class of bug. When an accumulator was empty, the
 * sub-score computed from it landed on its BEST value, because "no bad events"
 * and "no events" are the same number:
 *
 *   Follow the Ladybug   no jerk samples → mean jerk 0        → smoothness 100
 *                        totalMs floored to 1ms               → speed      100
 *                        no drops                             → grip       100
 *                        → OT 60 next to "0 score, 0% path accuracy"
 *
 *   Pinch the Coin       fewer than 2 aperture samples → no
 *                        wobble → steadiness 1                → stability   40
 *                        → OT 10 under the heading "All coins banked!"
 *
 *   Trace → Find → Type  every component defaulted high       → OT 100
 *                        → "100 / 100" next to "0 letters"
 *
 * These reports are read by therapists. A fabricated score is worse than no
 * score, so an unmeasured component must be `null`, must render as "—" rather
 * than 0% (which reads as a failure the child did not earn) or 100%, and must
 * be left out of the composite entirely.
 *
 * Usage:
 *   const composite = otComposite([
 *     [accuracy,   0.40],
 *     [smoothness, 0.25],   // null when there were no samples
 *     [speedScore, 0.20],
 *     [grip,       0.15],
 *   ]);                     // → null if nothing was measured
 */

/**
 * Weighted mean over the measured components only, renormalised over their
 * weights so dropping one does not silently deflate the result.
 *
 * @param {Array<[number|null, number]>} parts  [value, weight] pairs
 * @returns {number|null} 0-100, or null when nothing was measured
 */
export function otComposite(parts) {
  const measured = parts.filter(([v]) => v != null && Number.isFinite(v));
  if (measured.length === 0) return null;
  const weight = measured.reduce((a, [, w]) => a + w, 0);
  if (weight <= 0) return null;
  return Math.round(measured.reduce((a, [v, w]) => a + v * w, 0) / weight);
}

/** Round, preserving null. Use for every sub-score in a results payload. */
export function otRound(v) {
  return v == null || !Number.isFinite(v) ? null : Math.round(v);
}

/** Render helper: a percentage, or an em dash when not measured. */
export function otPct(v) {
  return v == null ? '—' : `${v}%`;
}

/**
 * Was this round actually completed, or stopped early?
 * Games pass 'ended' to their finish routine when the learner used the
 * "End game" button, so the results screen can title itself honestly instead
 * of claiming "Level complete!" over an empty report.
 */
export const FINISH = {
  COMPLETE: 'complete',
  ENDED: 'ended',
};
