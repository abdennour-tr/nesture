/**
 * handPointerFilter.js
 * ─────────────────────────────────────────────────────────────────────────
 * One pointer filter, shared by every camera-driven game.
 *
 * THE PROBLEM IT SOLVES
 *
 * MediaPipe reports the fingertip as a fraction of the camera frame, and the
 * games mapped that fraction straight onto the board. That mapping is only
 * honest at one distance. Sit the child back twenty centimetres and the same
 * arm sweep covers a much smaller slice of the frame: the pointer moves less
 * for the same effort — it feels slow and heavy — and the corners of the
 * board stop being reachable at all.
 *
 * A fixed EMA on top of that ate what movement was left. `α = 0.35 per frame`
 * is a different amount of smoothing at 30fps than at 12fps, and a far hand
 * runs at the low end precisely because a small hand is harder to detect. So
 * the further back the child sat, the heavier the pointer got — twice over.
 *
 * THREE THINGS FIX IT, in order of how much they matter:
 *
 *  1. Distance-normalised gain. The apparent size of the palm says how far
 *     away the hand is. Dividing a reference size by it recovers the factor
 *     that turns "fraction of frame" back into "how far the hand actually
 *     moved", so a 30cm arm sweep covers the same amount of board whether
 *     the child is leaning in or sitting back.
 *
 *  2. A One-Euro filter instead of the fixed EMA. Its cutoff opens up with
 *     speed: nearly still means heavy filtering, so the pointer holds steady
 *     on a target; moving fast means almost none, so a reach does not lag.
 *     It is written in seconds rather than frames, so a slow laptop gets the
 *     same feel as a fast one.
 *
 *  3. Prediction. Tracking reports where the hand was 60–100ms ago.
 *     Extrapolating along the filtered velocity gives most of that back,
 *     which is what removes the last of the "heavy" feeling.
 *
 * Plus a quiet fourth: the anchor. The mapping is centred on the middle of
 * the child's OBSERVED reach rather than the middle of the camera frame, and
 * that centre is learnt over the first few seconds and then re-learnt slowly
 * as the child shifts in their chair. A child sitting off to one side no
 * longer loses half the board. It starts at the frame centre, so the very
 * first second behaves exactly like the old mapping and then quietly gets
 * better — there is no calibration step for the child to sit through.
 *
 * Everything here is in normalised 0..1 board space with x already mirrored.
 * Multiply by the board's own width/height at the call site.
 *
 * TUNING: everything worth changing is in DEFAULTS below, and every field can
 * be overridden per game by passing it to createHandPointerFilter().
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* ── Apparent hand size: the depth proxy ──────────────────────────────────
   Two measurements of the palm, because either one alone lies. Wrist to
   middle knuckle collapses when the palm tilts towards the camera; palm
   width collapses when the hand turns edge-on. They never collapse at the
   same time, so the larger of the two is a usable estimate of how big the
   hand really appears. The 1.15 puts palm width on the same scale as palm
   length for a typical hand. */
export function handSpan(lm) {
  if (!lm || lm.length < 18) return DEFAULTS.refSpan;
  const wrist = lm[0], midMcp = lm[9], idxMcp = lm[5], pkyMcp = lm[17];
  if (!wrist || !midMcp || !idxMcp || !pkyMcp) return DEFAULTS.refSpan;
  const palmLen  = Math.hypot(wrist.x - midMcp.x, wrist.y - midMcp.y);
  const palmWide = Math.hypot(idxMcp.x - pkyMcp.x, idxMcp.y - pkyMcp.y) * 1.15;
  const span = Math.max(palmLen, palmWide);
  /* A degenerate frame (landmarks momentarily on top of each other) must not
     be read as "infinitely far away" — that would send the gain to its cap. */
  return span > 0.02 ? span : DEFAULTS.refSpan;
}

export const DEFAULTS = {
  /* Apparent palm size at a comfortable working distance — roughly an arm's
     length from a laptop camera. Gain is 1.0 here, so this is the distance at
     which the pointer behaves as it always did. A child's hand is smaller
     than an adult's, so a child sitting at this distance gets a slightly
     quicker pointer, which is the direction we want to err in. */
  refSpan: 0.14,
  /* How far the gain may travel. The ceiling matters: it is what lets a child
     sitting well back still reach the corners. The floor is just below 1 so
     leaning right into the camera does not make the pointer twitchy. */
  minGain: 0.90,
  maxGain: 2.40,
  /* Seconds. The gain must not change while a child is mid-reach or the
     pointer swims under their hand; distance changes far more slowly than
     this, so half a second of lag on it costs nothing. */
  gainTau: 0.50,

  /* One-Euro. `minCutoff` is the filtering when the hand is still (lower =
     steadier, but a stationary target takes longer to settle on); `beta` is
     how fast that opens up as the hand speeds up (higher = snappier reaches,
     but jitter starts to come through mid-movement). */
  minCutoff: 1.4,
  beta: 2.0,
  dCutoff: 1.0,

  /* Latency compensation. Tracking is always behind the hand; this puts the
     pointer back where the hand is now. Raise it and the pointer starts to
     overshoot on direction changes, which reads as nervous. */
  predictMs: 55,
  maxPredict: 0.07,
  /* Below this speed there is nothing worth predicting and the derivative is
     mostly noise, so prediction fades out rather than switching off. */
  predictFloor: 0.05,
  predictFull: 0.25,

  /* The anchor: the centre of the child's reach.
     `decay` expires old extremes (per second, so ~11s half-life at 0.07);
     `tau` is how slowly the anchor follows them; `deadband` stops it moving
     at all for anything small, which is what keeps a held pointer from
     drifting; `range` refuses to believe the reach centre is far out at the
     edge of the frame, which would be a tracking artefact rather than a
     child. */
  anchorDecay: 0.07,
  anchorTau: 4.0,
  anchorDeadband: 0.05,
  anchorRange: 0.22,

  /* Softness of the board edges. Instead of a hard clamp — which makes the
     pointer stick to the rim and stop answering the hand — the last 10% is
     compressed, so pushing further still moves it, just less. */
  edgeKnee: 0.10,

  /* A gap longer than this means the hand left and came back. The pointer
     jumps to it rather than sliding across the board. */
  reacquireMs: 500,
};

/* One-Euro's frame-rate-independent smoothing factor. */
function alphaFor(dt, cutoff) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/* Compress the outer `k` of the range instead of walling it off. Continuous
   and slope-1 at the knee, so there is no visible kink where it starts. */
function softEdge(v, k) {
  if (v > 1 - k) { const e = v - (1 - k); return (1 - k) + k * (e / (e + k)); }
  if (v < k)     { const e = k - v;       return k - k * (e / (e + k)); }
  return v;
}

/**
 * Create a pointer filter. One per game screen; call `push` with the raw
 * MediaPipe landmarks each time a frame arrives.
 *
 *   const filter = useRef(createHandPointerFilter()).current;
 *   const p = filter.push(landmarks);          // → { x, y, gain, span, speed }
 *   if (p) pushPointer({ x: p.x * VW, y: p.y * VH });
 *
 * Returns null when there is nothing usable in the frame.
 */
export function createHandPointerFilter(options = {}) {
  const o = { ...DEFAULTS, ...options };

  let lastT = 0;
  let gain = 1;
  /* The anchor starts at the frame centre, which reproduces the old mapping
     exactly, and walks to the child's real reach centre over a few seconds. */
  let anchorX = 0.5, anchorY = 0.5;
  let loX = 0.5, hiX = 0.5, loY = 0.5, hiY = 0.5;
  let outX = 0.5, outY = 0.5;      // filtered position
  let velX = 0,   velY = 0;        // filtered velocity, board units / second
  let prevMX = 0.5, prevMY = 0.5;  // previous mapped (pre-filter) position
  let started = false;

  function reset() {
    lastT = 0; gain = 1;
    anchorX = 0.5; anchorY = 0.5;
    loX = hiX = loY = hiY = 0.5;
    outX = outY = 0.5;
    velX = velY = 0;
    prevMX = prevMY = 0.5;
    started = false;
  }

  /* Called when the hand disappears. The anchor and the learnt gain survive —
     the child has not moved their chair — but the motion state does not, so
     the pointer does not resume with a stale velocity. */
  function lost() {
    lastT = 0;
    velX = velY = 0;
  }

  function push(lm, now) {
    if (!lm || lm.length < 18) return null;
    const tip = lm[8];
    if (!tip) return null;

    const t  = now === undefined ? performance.now() : now;
    const rx = 1 - tip.x;          // mirrored: the child's right is screen right
    const ry = tip.y;
    const span = handSpan(lm);
    const rawGain = clamp(o.refSpan / span, o.minGain, o.maxGain);

    /* First frame, or the hand has been away: adopt the current reading whole
       instead of easing towards it from wherever the pointer was left. */
    if (!started || !lastT || t - lastT > o.reacquireMs) {
      started = true;
      lastT = t;
      gain = rawGain;
      if (loX === hiX) { loX = hiX = rx; loY = hiY = ry; }
      const mx = softEdge(0.5 + (rx - anchorX) * gain, o.edgeKnee);
      const my = softEdge(0.5 + (ry - anchorY) * gain, o.edgeKnee);
      outX = prevMX = clamp(mx, 0, 1);
      outY = prevMY = clamp(my, 0, 1);
      velX = velY = 0;
      return { x: outX, y: outY, gain, span, speed: 0, reacquired: true };
    }

    /* Clamped: a stalled tab can report a two-second gap, and a filter fed a
       two-second dt snaps straight to the raw sample, jitter and all. */
    const dt = clamp((t - lastT) / 1000, 1 / 120, 1 / 6);
    lastT = t;

    // ── 1. Distance-normalised gain ──────────────────────────────────────
    gain += (rawGain - gain) * (1 - Math.exp(-dt / o.gainTau));

    // ── The anchor: where the middle of this child's reach actually is ────
    loX = Math.min(loX, rx); hiX = Math.max(hiX, rx);
    loY = Math.min(loY, ry); hiY = Math.max(hiY, ry);
    /* Old extremes expire, so a single stretch to the far corner does not
       define the reach centre for the rest of the session. */
    const decay = o.anchorDecay * dt;
    loX += (rx - loX) * decay; hiX += (rx - hiX) * decay;
    loY += (ry - loY) * decay; hiY += (ry - hiY) * decay;

    const wantX = clamp((loX + hiX) / 2, 0.5 - o.anchorRange, 0.5 + o.anchorRange);
    const wantY = clamp((loY + hiY) / 2, 0.5 - o.anchorRange, 0.5 + o.anchorRange);
    const aStep = 1 - Math.exp(-dt / o.anchorTau);
    /* The deadband is what makes a held pointer hold: without it the anchor
       creeps towards a stationary hand and the pointer slides off the target
       the child is trying to sit on. */
    if (Math.abs(wantX - anchorX) > o.anchorDeadband) anchorX += (wantX - anchorX) * aStep;
    if (Math.abs(wantY - anchorY) > o.anchorDeadband) anchorY += (wantY - anchorY) * aStep;

    // ── The mapping itself ───────────────────────────────────────────────
    const mx = softEdge(0.5 + (rx - anchorX) * gain, o.edgeKnee);
    const my = softEdge(0.5 + (ry - anchorY) * gain, o.edgeKnee);

    // ── 2. One-Euro ──────────────────────────────────────────────────────
    const dAlpha = alphaFor(dt, o.dCutoff);
    velX += ((mx - prevMX) / dt - velX) * dAlpha;
    velY += ((my - prevMY) / dt - velY) * dAlpha;
    prevMX = mx; prevMY = my;

    const speed  = Math.hypot(velX, velY);
    const alpha  = alphaFor(dt, o.minCutoff + o.beta * speed);
    outX += (mx - outX) * alpha;
    outY += (my - outY) * alpha;

    // ── 3. Prediction ────────────────────────────────────────────────────
    const lead = clamp((speed - o.predictFloor) / (o.predictFull - o.predictFloor), 0, 1);
    const ps   = (o.predictMs / 1000) * lead;
    const px   = outX + clamp(velX * ps, -o.maxPredict, o.maxPredict);
    const py   = outY + clamp(velY * ps, -o.maxPredict, o.maxPredict);

    return {
      x: clamp(px, 0, 1),
      y: clamp(py, 0, 1),
      gain,
      span,
      speed,
      reacquired: false,
    };
  }

  return {
    push,
    reset,
    lost,
    get gain() { return gain; },
    get anchor() { return { x: anchorX, y: anchorY }; },
  };
}

/**
 * How large to draw the hand art, from the same span measurement the gain
 * uses. The games each did their own version of this from a raw wrist→knuckle
 * distance in board pixels, which changed meaning with the board's aspect
 * ratio; this one does not.
 *
 *   scale = base * handDepthScale(p.span)
 */
export function handDepthScale(span, { min = 0.72, max = 1.38, ref = DEFAULTS.refSpan } = {}) {
  if (!span || span <= 0) return 1;
  return clamp(span / ref, min, max);
}

export default createHandPointerFilter;
