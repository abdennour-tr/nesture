/**
 * poseFeatures.js
 * ---------------------------------------------------------------------------
 * LAYER 2 of the touch-mode pipeline: raw landmarks → movement features.
 *
 *   capture → [FEATURES] → indicators → score → export
 *
 * Everything in this file is a DESCRIPTION OF MOVEMENT. No function here knows
 * what a primitive reflex is, and none of them should ever be given a reflex
 * name. That separation is the point: features are objective geometry that will
 * still be correct after the indicator formulas are recalibrated, so a dataset
 * exported today stays usable against a model written next year.
 *
 * SCALE INVARIANCE
 * ----------------
 * A child sitting closer to the camera is bigger in frame. Every length here is
 * therefore divided by a body-scale reference — shoulder width, or inter-ear
 * distance for head measures — so the same posture gives the same number at any
 * distance. Angles need no such treatment.
 *
 * SIGN CONVENTIONS (fixed once; the indicator layer depends on them)
 *   headYaw          + = head rotated toward the subject's RIGHT
 *   headRoll         + = head tilted toward the subject's RIGHT shoulder
 *   headPitch        + = head raised (extension), − = chin toward chest
 *   armExtension     0 = fully folded elbow, 1 = fully straight arm
 *   extensionAsym    + = RIGHT arm more extended than the left
 *   shoulderTilt     + = RIGHT shoulder higher than the left
 *   trunkLeanLateral + = shoulders displaced to the subject's RIGHT of the hips
 *   wristOffset      + = wrist on its OWN side, − = crossed over the midline
 *
 * A note on `null`: a feature that could not be computed from a frame is null,
 * never 0. Zero is a real posture — head straight ahead — and a frame where the
 * ears were not visible is not that.
 */

import { POSE, allVisible, MIN_VISIBILITY } from './poseLandmarks';

// ── Small geometry helpers ───────────────────────────────────────────────────

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Interior angle at `b` in the chain a–b–c, in degrees (0..180). */
export function angleAt(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const n1 = Math.hypot(v1x, v1y), n2 = Math.hypot(v2x, v2y);
  if (n1 < 1e-6 || n2 < 1e-6) return null;
  const cos = clamp((v1x * v2x + v1y * v2y) / (n1 * n2), -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

const vis = (p) => (p && p.visibility != null ? p.visibility : 1);

// ── Per-frame features ───────────────────────────────────────────────────────

/**
 * Turn one frame of landmarks into a feature record.
 * @param {Array} lm  landmarks indexed by POSE.*
 * @returns {Object|null} null when the frame lacks the core landmarks entirely
 */
export function frameFeatures(lm) {
  if (!allVisible(lm, [POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER])) return null;

  const ls = lm[POSE.LEFT_SHOULDER];
  const rs = lm[POSE.RIGHT_SHOULDER];
  const shoulderMid = mid(ls, rs);
  const shoulderWidth = dist(ls, rs);
  if (!(shoulderWidth > 1e-4)) return null;

  const f = {
    shoulderWidth,
    // Where the body midline sits in the image, for the crossing measures.
    midlineX: shoulderMid.x,
    headYaw: null, headRoll: null, headPitch: null,
    elbowAngleLeft: null, elbowAngleRight: null,
    armExtensionLeft: null, armExtensionRight: null,
    extensionAsymmetry: null,
    shoulderTilt: null,
    trunkLeanLateral: null,
    wristOffsetLeft: null, wristOffsetRight: null,
    wristSpreadFromMidline: null,
    quality: 0,
  };

  /* ── Head rotation ──────────────────────────────────────────────────────
     Two independent cues, because either alone is fragile:

       geometric — the nose sits off the ear-midpoint as the head turns.
       occlusion — the far ear's confidence falls away as it hides.

     They are averaged only when both are available. The geometric cue is
     normalised by inter-ear distance so it does not change with camera
     distance. This is a PROXY for yaw, not a calibrated head-pose angle: a
     single webcam without a 3D face model cannot give a true one, and pretending
     otherwise would put a spurious precision into the dataset. */
  const le = lm[POSE.LEFT_EAR];
  const re = lm[POSE.RIGHT_EAR];
  const nose = lm[POSE.NOSE];
  if (nose && le && re) {
    const earDist = dist(le, re);
    if (earDist > 1e-4) {
      const earMid = mid(le, re);
      // Image x grows to the right; the subject's right ear is at smaller x
      // in a non-mirrored frame, so the sign is taken from the ear order.
      const facing = Math.sign(le.x - re.x) || 1;
      const geometric = clamp(((nose.x - earMid.x) / earDist) * 2 * facing, -1, 1);

      let yaw = geometric;
      const visL = vis(le), visR = vis(re);
      if (visL != null && visR != null && (visL + visR) > 0.2) {
        // Turning right hides the right ear → visR falls → positive.
        const occlusion = clamp(((visL - visR) / Math.max(visL + visR, 0.2)) * facing, -1, 1);
        yaw = (geometric + occlusion) / 2;
      }
      f.headYaw = clamp(yaw, -1, 1);
      f.headRoll = Math.atan2((le.y - re.y) * facing, earDist) * (180 / Math.PI);
    }
  }

  /* ── Head flexion / extension ───────────────────────────────────────────
     How far the nose sits above the shoulder line, in shoulder-widths. A chin
     tucked to the chest brings it down; looking up lifts it. Also a proxy: it
     moves with true pitch but is not an angle. */
  if (nose) {
    f.headPitch = clamp((shoulderMid.y - nose.y) / shoulderWidth, -2, 3);
  }

  /* ── Arm extension ──────────────────────────────────────────────────────
     The elbow angle is the honest measure — it needs no scale reference and is
     robust to the arm pointing at the camera, which wrist-to-shoulder distance
     is not. Mapped to 0..1 across the usable range: a fully folded elbow is
     about 30°, a straight arm 180°. */
  const toExtension = (deg) => (deg == null ? null : clamp((deg - 30) / 150, 0, 1));

  if (allVisible(lm, [POSE.LEFT_SHOULDER, POSE.LEFT_ELBOW, POSE.LEFT_WRIST])) {
    f.elbowAngleLeft = angleAt(lm[POSE.LEFT_SHOULDER], lm[POSE.LEFT_ELBOW], lm[POSE.LEFT_WRIST]);
    f.armExtensionLeft = toExtension(f.elbowAngleLeft);
  }
  if (allVisible(lm, [POSE.RIGHT_SHOULDER, POSE.RIGHT_ELBOW, POSE.RIGHT_WRIST])) {
    f.elbowAngleRight = angleAt(lm[POSE.RIGHT_SHOULDER], lm[POSE.RIGHT_ELBOW], lm[POSE.RIGHT_WRIST]);
    f.armExtensionRight = toExtension(f.elbowAngleRight);
  }
  if (f.armExtensionLeft != null && f.armExtensionRight != null) {
    f.extensionAsymmetry = f.armExtensionRight - f.armExtensionLeft;
  }

  // ── Shoulder line: + when the subject's right shoulder rides higher ──────
  f.shoulderTilt = Math.atan2((ls.y - rs.y) * (Math.sign(ls.x - rs.x) || 1), shoulderWidth)
    * (180 / Math.PI);

  // ── Trunk: shoulders displaced sideways from the hips ────────────────────
  if (allVisible(lm, [POSE.LEFT_HIP, POSE.RIGHT_HIP], 0.3)) {
    const hipMid = mid(lm[POSE.LEFT_HIP], lm[POSE.RIGHT_HIP]);
    const facing = Math.sign(ls.x - rs.x) || 1;
    f.trunkLeanLateral = clamp(((shoulderMid.x - hipMid.x) / shoulderWidth) * -facing, -2, 2);
  }

  /* ── Hands relative to the body midline ─────────────────────────────────
     Negative means the hand has crossed to the other side of the body, which
     is the measurable half of "crossing the midline". */
  const facingSign = Math.sign(ls.x - rs.x) || 1;
  const lw = lm[POSE.LEFT_WRIST];
  const rw = lm[POSE.RIGHT_WRIST];
  if (lw && vis(lw) >= MIN_VISIBILITY) {
    f.wristOffsetLeft = ((lw.x - shoulderMid.x) / shoulderWidth) * facingSign;
  }
  if (rw && vis(rw) >= MIN_VISIBILITY) {
    f.wristOffsetRight = ((rw.x - shoulderMid.x) / shoulderWidth) * -facingSign;
  }
  if (f.wristOffsetLeft != null && f.wristOffsetRight != null) {
    // How far apart the hands are, in shoulder-widths — the quantity a startle
    // abduction moves sharply.
    f.wristSpreadFromMidline = f.wristOffsetLeft + f.wristOffsetRight;
  }

  /* How much of this frame is trustworthy, for weighting later. */
  const tracked = [nose, le, re, ls, rs, lm[POSE.LEFT_ELBOW], lm[POSE.RIGHT_ELBOW], lw, rw]
    .filter(Boolean);
  f.quality = tracked.length
    ? tracked.reduce((a, p) => a + vis(p), 0) / 9
    : 0;

  return f;
}

// ── Series statistics ────────────────────────────────────────────────────────

/** Pairs where BOTH series have a value, so a gap never shifts the alignment. */
function pairedSeries(frames, keyA, keyB) {
  const a = [], b = [];
  for (const f of frames) {
    if (!f) continue;
    if (f[keyA] == null || f[keyB] == null) continue;
    a.push(f[keyA]); b.push(f[keyB]);
  }
  return [a, b];
}

export function mean(xs) {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
}

export function stddev(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length);
}

/** Pearson r, or null when either series is flat or too short to mean anything. */
export function correlation(xs, ys, minN = 20) {
  if (xs.length !== ys.length || xs.length < minN) return null;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx < 1e-9 || dy < 1e-9) return null;   // no variation → r is undefined
  return num / Math.sqrt(dx * dy);
}

/** Peak-to-peak range, ignoring the extreme 5% at each end so one bad frame
 *  cannot decide whether a session counts as "the head moved". */
export function robustRange(xs) {
  if (xs.length < 5) return null;
  const s = [...xs].sort((a, b) => a - b);
  const lo = s[Math.floor(s.length * 0.05)];
  const hi = s[Math.ceil(s.length * 0.95) - 1];
  return hi - lo;
}

const valuesOf = (frames, key) =>
  frames.filter((f) => f && f[key] != null).map((f) => f[key]);

/**
 * Reduce a session's frames to the summary every indicator reads.
 *
 * Correlations are reported RAW and signed. Deciding which sign supports which
 * reflex is the indicator layer's job — doing it here would bake a hypothesis
 * into the dataset.
 *
 * @param {Array<{t:number, features:Object}>} samples  in capture order
 */
export function sessionFeatures(samples) {
  const frames = samples.map((s) => s.features).filter(Boolean);
  const n = frames.length;
  if (n === 0) {
    return { frameCount: 0, durationSec: 0, usable: false, reason: 'No frame carried a visible upper body' };
  }

  const t0 = samples[0]?.t ?? 0;
  const t1 = samples[samples.length - 1]?.t ?? t0;
  const durationSec = Math.max(0, (t1 - t0) / 1000);

  const yaw = valuesOf(frames, 'headYaw');
  const pitch = valuesOf(frames, 'headPitch');
  const asym = valuesOf(frames, 'extensionAsymmetry');
  const extL = valuesOf(frames, 'armExtensionLeft');
  const extR = valuesOf(frames, 'armExtensionRight');
  const tilt = valuesOf(frames, 'shoulderTilt');
  const lean = valuesOf(frames, 'trunkLeanLateral');
  const spread = valuesOf(frames, 'wristSpreadFromMidline');
  const quality = valuesOf(frames, 'quality');

  // Mean arm extension per frame, for the symmetric (STNR-shaped) relationship.
  const meanExtFrames = frames.map((f) => {
    if (f.armExtensionLeft == null && f.armExtensionRight == null) return { ...f, meanExtension: null };
    const parts = [f.armExtensionLeft, f.armExtensionRight].filter((v) => v != null);
    return { ...f, meanExtension: parts.reduce((a, v) => a + v, 0) / parts.length };
  });

  const [yawS, asymS] = pairedSeries(frames, 'headYaw', 'extensionAsymmetry');
  const [pitchS, extS] = pairedSeries(meanExtFrames, 'headPitch', 'meanExtension');
  const [pitchL, leanL] = pairedSeries(frames, 'headPitch', 'trunkLeanLateral');

  return {
    frameCount: n,
    durationSec,
    usable: true,
    sampleRateHz: durationSec > 0 ? n / durationSec : null,
    meanQuality: mean(quality),

    // Head movement — also the gate on whether a head-linked reflex is
    // observable at all this session.
    headYawRange: robustRange(yaw),
    headYawSd: stddev(yaw),
    headPitchRange: robustRange(pitch),
    headPitchSd: stddev(pitch),

    // Arms
    meanExtensionLeft: mean(extL),
    meanExtensionRight: mean(extR),
    extensionAsymmetryMean: mean(asym),
    extensionAsymmetrySd: stddev(asym),

    // Posture
    shoulderTiltMean: mean(tilt),
    shoulderTiltSd: stddev(tilt),
    trunkLeanSd: stddev(lean),
    posturalSwaySd: stddev(valuesOf(frames, 'midlineX')),

    // Midline
    midlineCrossings: countCrossings(frames),
    wristSpreadSd: stddev(spread),

    // Raw, signed relationships. Direction is interpreted downstream.
    corrYawVsExtensionAsymmetry: correlation(yawS, asymS),
    corrYawSampleN: yawS.length,
    corrPitchVsMeanExtension: correlation(pitchS, extS),
    corrPitchSampleN: pitchS.length,
    corrPitchVsTrunkLean: correlation(pitchL, leanL),

    bilateralAbductionEvents: countAbductionEvents(samples),
  };
}

/** How many times a hand travelled from its own side across to the other. */
export function countCrossings(frames) {
  let crossings = 0;
  for (const side of ['wristOffsetLeft', 'wristOffsetRight']) {
    let wasCrossed = null;
    for (const f of frames) {
      if (!f || f[side] == null) continue;
      // A dead band, so a hand resting on the midline does not tick constantly.
      const crossed = f[side] < -0.05 ? true : f[side] > 0.05 ? false : wasCrossed;
      if (wasCrossed === false && crossed === true) crossings += 1;
      wasCrossed = crossed;
    }
  }
  return crossings;
}

/**
 * Count startle-SHAPED movements: both hands sweeping away from the midline
 * together, then returning, inside a short window.
 *
 * This counts a MOVEMENT SHAPE. It is not a claim that a startle occurred —
 * a child reaching wide for a target with both hands makes the same shape.
 * The indicator layer is where that caveat is attached to a number.
 */
export function countAbductionEvents(samples, {
  openRate = 1.2,        // shoulder-widths per second, outward
  closeRate = 0.8,       // and back in
  windowMs = 1200,
} = {}) {
  let events = 0;
  let openedAt = null;
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1], b = samples[i];
    const fa = a?.features, fb = b?.features;
    if (!fa || !fb || fa.wristSpreadFromMidline == null || fb.wristSpreadFromMidline == null) continue;
    const dt = (b.t - a.t) / 1000;
    if (!(dt > 0) || dt > 0.5) { openedAt = null; continue; }
    const rate = (fb.wristSpreadFromMidline - fa.wristSpreadFromMidline) / dt;

    if (rate > openRate) {
      openedAt = b.t;
    } else if (openedAt != null && rate < -closeRate) {
      if (b.t - openedAt <= windowMs) events += 1;
      openedAt = null;
    } else if (openedAt != null && b.t - openedAt > windowMs) {
      openedAt = null;
    }
  }
  return events;
}

export default { frameFeatures, sessionFeatures };
