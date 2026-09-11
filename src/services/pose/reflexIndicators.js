/**
 * reflexIndicators.js
 * ---------------------------------------------------------------------------
 * Applies the active indicator model to a session's features.
 *
 *   capture → features → [THIS] → score → export
 *
 * This file contains no thresholds and no formulas of its own. It reads them
 * from `indicatorModel.vN.js` and does the same three things for every
 * indicator: check the gate, compute, attach provenance. Swapping the model is
 * a one-line change at ACTIVE_MODEL, and nothing here needs touching.
 *
 * Every result carries the model version that produced it, so a session scored
 * under v1 stays interpretable after v2 exists.
 */

import * as MODEL from './indicatorModel.v1';

/** Change this line, and only this line, to move the platform to a new model. */
const ACTIVE_MODEL = MODEL;

export const activeModelVersion = () => ACTIVE_MODEL.MODEL_VERSION;

/**
 * @param {Object} sessionFeatures  output of poseFeatures.sessionFeatures()
 * @returns {Object} { modelVersion, notice, indicators[], postural[], usable }
 */
export function computeIndicators(sessionFeatures) {
  const s = sessionFeatures;
  const base = {
    modelVersion: ACTIVE_MODEL.MODEL_VERSION,
    notice: ACTIVE_MODEL.MODEL_NOTICE,
    isProvisional: true,
  };

  /* Two reasons to refuse the whole session before looking at any single
     indicator: not enough frames, or frames too poor to trust. Returning
     zeros here would put a full set of "settled" findings on a session where
     the child was barely in shot. */
  if (!s || !s.usable || s.frameCount < ACTIVE_MODEL.GATES.MIN_FRAMES) {
    return {
      ...base,
      usable: false,
      reason: s?.reason
        || `Only ${s?.frameCount ?? 0} usable frames — too few to describe a session.`,
      indicators: [],
      postural: [],
    };
  }
  if ((s.meanQuality ?? 0) < ACTIVE_MODEL.GATES.MIN_QUALITY) {
    return {
      ...base,
      usable: false,
      reason: 'The camera did not see the upper body clearly enough this round.',
      indicators: [],
      postural: [],
    };
  }

  const indicators = ACTIVE_MODEL.INDICATORS.map((def) => {
    const blocked = def.gate(s);
    const common = {
      key: def.key,
      label: def.label,
      group: def.group,
      evidence: def.evidence,
      describes: def.describes,
      measuredAs: def.measuredAs,
      caveat: def.caveat,
      features: def.features,
      modelVersion: ACTIVE_MODEL.MODEL_VERSION,
      /* Travels with the number so no screen can show one without the other. */
      disclaimer: 'Research indicator from movement observation. Not a clinical finding.',
    };

    if (blocked) {
      return { ...common, measured: false, value: null, confidence: 0, notMeasuredReason: blocked };
    }

    const value = def.compute(s);
    if (value == null) {
      return {
        ...common,
        measured: false,
        value: null,
        confidence: 0,
        notMeasuredReason: 'The movement needed for this pattern did not occur this round.',
      };
    }

    return {
      ...common,
      measured: true,
      value,                                   // 0..100, high = more consistent
      confidence: Number((def.confidence(s) ?? 0).toFixed(3)),
    };
  });

  const postural = ACTIVE_MODEL.POSTURAL_MEASURES.map((def) => {
    const raw = def.from(s);
    return {
      key: def.key,
      label: def.label,
      describes: def.describes,
      raw: raw == null ? null : Number(raw.toFixed(4)),
      value: def.normalise(raw),               // 0..100, high = better
      betterWhenLow: def.betterWhenLow,
      measured: raw != null,
    };
  });

  return { ...base, usable: true, indicators, postural };
}

/**
 * The pose pipeline's contribution to a game score.
 *
 * Only the POSTURAL measures carry weight in v1 — see the long note on
 * SCORE_CONTRIBUTION in the model. The reflex weights are read here too, so
 * turning them on later is a config change rather than a code change.
 *
 * @returns {{ value, weightUsed, share, components }} value is 0..100 or null
 */
export function poseScoreContribution(result, gameId) {
  if (!result?.usable) return { value: null, weightUsed: 0, share: 0, components: [] };
  const cfg = ACTIVE_MODEL.scoreContributionFor(gameId);
  const components = [];

  for (const [key, weight] of Object.entries(cfg.postural || {})) {
    const m = result.postural.find((p) => p.key === key);
    if (m && m.value != null && weight > 0) {
      components.push({ key, label: m.label, value: m.value, weight });
    }
  }
  for (const [key, weight] of Object.entries(cfg.reflex || {})) {
    const ind = result.indicators.find((i) => i.key === key);
    if (ind && ind.measured && weight > 0) {
      // A retention indicator is inverted before it can credit a score: more
      // pattern means less credit, not more.
      components.push({ key, label: ind.label, value: 100 - ind.value, weight });
    }
  }

  if (components.length === 0) return { value: null, weightUsed: 0, share: 0, components: [] };

  /* Renormalised over what was actually measured, so a missing component
     does not quietly deflate the result — the same rule as utils/otScore.js. */
  const weightUsed = components.reduce((a, c) => a + c.weight, 0);
  const value = Math.round(components.reduce((a, c) => a + c.value * c.weight, 0) / weightUsed);

  return { value, weightUsed, share: cfg.maxShareOfGameScore, components };
}

/**
 * Blend the pose contribution into a game's own composite.
 *
 * Capped at the model's `maxShareOfGameScore` so the pipeline can never
 * dominate a score built from what the child actually did in the game.
 * A game with no pose data is returned untouched.
 */
export function blendWithGameScore(gameComposite, contribution) {
  if (gameComposite == null || contribution?.value == null) return gameComposite ?? null;
  const share = Math.max(0, Math.min(0.5, contribution.share || 0));
  return Math.round(gameComposite * (1 - share) + contribution.value * share);
}

export default { computeIndicators, poseScoreContribution, blendWithGameScore };
