/** Camera samples are filtered once, in mirrored, normalized board coordinates. */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const isPoint = (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y);

export const DEFAULTS = {
  refSpan: 0.14,
  // Fixed camera reach keeps the edges accessible without learning a new
  // origin/gain under a held finger. Palm size only affects the hand art.
  fixedGain: 1.65,
  minCutoff: 1.6,
  beta: 12,
  dCutoff: 2.5,
  noiseSpeed: 0.035,
  spanTau: 0.22,
  reacquireMs: 350,
  spikeDistance: 0.12,
  spikeConfirmDistance: 0.055,
};

export const STABLE_POINTER_OPTIONS = Object.freeze({ ...DEFAULTS });

export function handSpan(landmarks) {
  const wrist = landmarks?.[0];
  const middle = landmarks?.[9];
  const index = landmarks?.[5];
  const pinky = landmarks?.[17];
  if (![wrist, middle, index, pinky].every(isPoint)) return DEFAULTS.refSpan;
  const length = Math.hypot(wrist.x - middle.x, wrist.y - middle.y);
  const width = Math.hypot(index.x - pinky.x, index.y - pinky.y) * 1.15;
  const span = Math.max(length, width);
  return span > 0.02 ? span : DEFAULTS.refSpan;
}

function alphaFor(dt, cutoff) {
  return 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
}

/**
 * Adaptive One-Euro filtering: quiet at rest, open during a deliberate reach.
 * No position dead zone, prediction, moving anchor or depth-dependent gain:
 * a held fingertip converges to its mapped location without drift/overshoot.
 * x is mirrored once; both axes use the same fixed reach gain.
 *
 * push(landmarks, cameraTimestamp) -> { x, y, span, accepted, reacquired, ... }
 * lost() clears velocity but retains position across short detection gaps.
 * reset() starts a new round/hand without inheriting another hand's history.
 */
export function createHandPointerFilter(options = {}) {
  const o = { ...DEFAULTS, ...options };
  let lastT = null;
  let lastInputT = null;
  let raw = null;
  let output = null;
  let velocity = { x: 0, y: 0 };
  let rawVelocity = { x: 0, y: 0 };
  let span = o.refSpan;
  let candidate = null;
  let lastResult = null;
  let interrupted = false;

  function reset() {
    lastT = lastInputT = null;
    raw = output = candidate = lastResult = null;
    velocity = { x: 0, y: 0 };
    rawVelocity = { x: 0, y: 0 };
    span = o.refSpan;
    interrupted = false;
  }

  function lost() {
    velocity = { x: 0, y: 0 };
    rawVelocity = { x: 0, y: 0 };
    candidate = null;
    interrupted = true;
  }

  function result(t, accepted, reacquired = false) {
    lastResult = {
      ...output, span, speed: Math.hypot(velocity.x, velocity.y),
      gain: o.fixedGain, gainX: o.fixedGain, gainY: o.fixedGain,
      timestamp: t, accepted, reacquired,
    };
    return lastResult;
  }

  function push(landmarks, now = performance.now()) {
    const tip = landmarks?.[8];
    if (!isPoint(tip) || !Number.isFinite(now) || landmarks.length < 18 ||
        tip.x < -0.2 || tip.x > 1.2 || tip.y < -0.2 || tip.y > 1.2) {
      lost();
      return null;
    }
    // Duplicate/out-of-order results must not advance the filter a second time.
    if (lastInputT !== null && now <= lastInputT) return lastResult;
    lastInputT = now;
    const point = { x: 1 - tip.x, y: tip.y };
    const mapped = {
      x: clamp(0.5 + (point.x - 0.5) * o.fixedGain, 0, 1),
      y: clamp(0.5 + (point.y - 0.5) * o.fixedGain, 0, 1),
    };
    const measuredSpan = handSpan(landmarks);

    if (lastT === null || now - lastT > o.reacquireMs) {
      raw = point;
      output = mapped;
      lastT = now;
      span = measuredSpan;
      velocity = { x: 0, y: 0 };
      rawVelocity = { x: 0, y: 0 };
      candidate = null;
      interrupted = false;
      return result(now, true, true);
    }

    const elapsed = (now - lastT) / 1000;
    const distance = Math.hypot(point.x - raw.x, point.y - raw.y);
    // A single implausible teleport waits for one confirming camera frame.
    // The allowance grows with established motion so fast sweeps pass through.
    const allowance = o.spikeDistance + Math.hypot(rawVelocity.x, rawVelocity.y) * elapsed * 2;
    const direction = (point.x - raw.x) * rawVelocity.x + (point.y - raw.y) * rawVelocity.y;
    const abruptReversal = distance > o.spikeDistance && direction < 0;
    if (distance > allowance || abruptReversal) {
      const confirmed = candidate && now - candidate.t <= 150 &&
        Math.hypot(point.x - candidate.x, point.y - candidate.y) <
          Math.max(o.spikeConfirmDistance, distance * 0.4);
      if (!confirmed) {
        candidate = { ...point, t: now };
        return result(now, false);
      }
    }
    candidate = null;

    // Preserve a short gap's position without inferring a fling from missing
    // frames or letting a delayed callback remove all smoothing at once.
    const dt = clamp(elapsed, 0.001, interrupted ? 1 / 30 : 0.1);
    const derivativeAlpha = alphaFor(dt, o.dCutoff);
    const dx = (point.x - raw.x) / elapsed;
    const dy = (point.y - raw.y) / elapsed;
    velocity.x += (dx * o.fixedGain - velocity.x) * derivativeAlpha;
    velocity.y += (dy * o.fixedGain - velocity.y) * derivativeAlpha;
    const speed = Math.max(0, Math.hypot(velocity.x, velocity.y) - o.noiseSpeed);
    const alpha = alphaFor(dt, o.minCutoff + o.beta * speed);
    output.x += (mapped.x - output.x) * alpha;
    output.y += (mapped.y - output.y) * alpha;
    span += (measuredSpan - span) * (1 - Math.exp(-dt / o.spanTau));
    rawVelocity = { x: dx, y: dy };
    raw = point;
    lastT = now;
    interrupted = false;
    return result(now, true);
  }

  return {
    push, lost, reset,
    get gain() { return o.fixedGain; },
    get anchor() { return { x: 0.5, y: 0.5 }; },
  };
}

export function handDepthScale(span, { min = 0.72, max = 1.38, ref = DEFAULTS.refSpan } = {}) {
  return Number.isFinite(span) && span > 0 ? clamp(span / ref, min, max) : 1;
}

export default createHandPointerFilter;
