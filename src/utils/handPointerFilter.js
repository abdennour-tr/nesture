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

  /* ── Reach fitting (opt-in: `fitReach: true`) ──────────────────────────
     Client feedback on Trace → Find → Type: "the hand pointer still can't roam
     the whole screen".

     Why the fixed gain is not enough: `rx`/`ry` are the fingertip's position
     in the CAMERA FRAME. A seated child's comfortable fingertip travel covers
     only about half that frame, so at gain 1.0 they can only ever reach the
     middle half of the screen — the corners are physically out of range no
     matter how far they stretch. It is worse on one axis than the other,
     because the camera is 4:3 and the screen is 16:9.

     Reach fitting measures how far the child ACTUALLY moves (the filter
     already tracks the lo/hi extremes for the anchor) and scales each axis
     independently so that their natural range covers `reachTarget` of the
     screen. A child who sits back and makes small movements gets a faster
     pointer; one who sweeps their whole arm gets a slower one. Both reach the
     corners.

     Left off by default so the games that were reported working — Pop the
     Bubble, Follow the Ladybug — keep the exact feel they have today. */
  fitReach: false,
  /* Fraction of the screen the child's observed reach should cover. Slightly
     under 1 because softEdge compresses the last 10% anyway. */
  reachTarget: 0.92,
  /* Never believe a reach smaller than this (per axis, in frame units). It is
     the guard that stops the gain running away when a child holds still and
     the observed extremes collapse towards each other. */
  minReach: 0.16,
  /* Where the fit STARTS, before the child has moved enough to measure them:
     a typical seated fingertip sweep. Starting from `minReach` instead would
     open at maximum gain and feel jumpy for the first second. */
  initialReach: 0.34,
  /* The measured reach grows immediately but shrinks very slowly (per second),
     so a moment of stillness does not make the pointer twitchy. */
  reachDecay: 0.02,
  /* Independent, wider gain limits for the fitted axes. */
  fitMinGain: 1.0,
  /* 4.2 is where the benefit plateaus in simulation: below it a child who
     makes only small movements cannot reach the edges, above it nothing
     further is gained (the reach floor and the soft edges bind first) and
     the pointer only gets more sensitive to tracking noise. */
  fitMaxGain: 4.2,

  /* ── Holding still ─────────────────────────────────────────────────────
     Client feedback: the pointer would not stay put when the hand was held
     steady on a target.

     Three separate things made a "still" hand drift:

       1. One-Euro at `minCutoff` still lets roughly a fifth of the raw
          landmark jitter through every frame. Small, but on a held pointer it
          reads as a permanent tremble.
       2. The reach ANCHOR kept adapting. While the hand is parked, the lo/hi
          extremes decay towards wherever it is parked, the anchor follows, and
          the mapping slides out from under a hand that never moved — the
          pointer creeps off the target on its own.
       3. With reach fitting on, that same decay shrinks the measured reach,
          which RAISES the gain, which makes the pointer progressively twitchier
          the longer the child holds still. Exactly backwards.

     `stillSpeed` is the speed below which the hand counts as still; while it
     is, the anchor and the reach measurement are frozen. `stillEps` is a
     micro-deadband: movement smaller than this does not move the pointer at
     all. It is applied as a soft ramp rather than a hard freeze, so there is
     no jump when the child starts moving again. */
  stillSpeed: 0.055,
  stillEps: 0.0045,
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
  /* Observed reach per axis, and the gain fitted to it (see `fitReach`). */
  let reachX = o.initialReach, reachY = o.initialReach;
  let gainX = clamp(o.reachTarget / o.initialReach, o.fitMinGain, o.fitMaxGain);
  let gainY = gainX;
  let outX = 0.5, outY = 0.5;      // filtered position
  let velX = 0,   velY = 0;        // filtered velocity, board units / second
  /* Last frame's speed. `speed` itself is not computed until after the
     mapping, but the anchor/reach freeze has to be decided BEFORE it — and
     the previous frame's speed is the right measure anyway: it describes the
     movement that has just happened. */
  let lastSpeed = 0;
  let prevMX = 0.5, prevMY = 0.5;  // previous mapped (pre-filter) position
  let started = false;

  function reset() {
    lastT = 0; gain = 1;
    anchorX = 0.5; anchorY = 0.5;
    reachX = reachY = o.initialReach;
    gainX = gainY = clamp(o.reachTarget / o.initialReach, o.fitMinGain, o.fitMaxGain);
    loX = hiX = loY = hiY = 0.5;
    outX = outY = 0.5;
    velX = velY = 0;
    lastSpeed = 0;
    prevMX = prevMY = 0.5;
    started = false;
  }

  /* Called when the hand disappears. The anchor and the learnt gain survive —
     the child has not moved their chair — but the motion state does not, so
     the pointer does not resume with a stale velocity. */
  function lost() {
    lastT = 0;
    velX = velY = 0;
    lastSpeed = 0;
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
      const gx0 = o.fitReach ? gainX : gain;
      const gy0 = o.fitReach ? gainY : gain;
      const mx = softEdge(0.5 + (rx - anchorX) * gx0, o.edgeKnee);
      const my = softEdge(0.5 + (ry - anchorY) * gy0, o.edgeKnee);
      outX = prevMX = clamp(mx, 0, 1);
      outY = prevMY = clamp(my, 0, 1);
      velX = velY = 0;
      lastSpeed = 0;
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
    /* Frozen while the hand is still (see `stillSpeed`): otherwise a parked
       hand pulls its own extremes together, which drifts the anchor and — with
       reach fitting — inflates the gain. `speed` here is last frame's, which is
       exactly what we want: it describes the movement that just happened. */
    const isStill = lastSpeed < o.stillSpeed;
    if (!isStill) {
      const decay = o.anchorDecay * dt;
      loX += (rx - loX) * decay; hiX += (rx - hiX) * decay;
      loY += (ry - loY) * decay; hiY += (ry - hiY) * decay;
    }

    const wantX = clamp((loX + hiX) / 2, 0.5 - o.anchorRange, 0.5 + o.anchorRange);
    const wantY = clamp((loY + hiY) / 2, 0.5 - o.anchorRange, 0.5 + o.anchorRange);
    const aStep = 1 - Math.exp(-dt / o.anchorTau);
    /* The deadband is what makes a held pointer hold: without it the anchor
       creeps towards a stationary hand and the pointer slides off the target
       the child is trying to sit on. */
    if (!isStill) {
      if (Math.abs(wantX - anchorX) > o.anchorDeadband) anchorX += (wantX - anchorX) * aStep;
      if (Math.abs(wantY - anchorY) > o.anchorDeadband) anchorY += (wantY - anchorY) * aStep;
    }

    /* ── Reach fitting ────────────────────────────────────────────────────
       Scale each axis so the child's OBSERVED range of motion covers
       `reachTarget` of the screen, instead of assuming their fingertip sweeps
       the whole camera frame (it never does). Per-axis, because the camera and
       the screen have different aspect ratios.

       The measured reach jumps up immediately when the child moves further
       than before, and decays only very slowly, so holding still never makes
       the pointer twitchy — and `minReach` is the hard floor that stops the
       gain running away entirely. */
    let gx = gain;
    let gy = gain;
    if (o.fitReach) {
      /* Also frozen while still, for the same reason. */
      const shrink = isStill ? 1 : 1 - o.reachDecay * dt;
      reachX = Math.max(reachX * shrink, hiX - loX, o.minReach);
      reachY = Math.max(reachY * shrink, hiY - loY, o.minReach);

      const wantGX = clamp(o.reachTarget / reachX, o.fitMinGain, o.fitMaxGain);
      const wantGY = clamp(o.reachTarget / reachY, o.fitMinGain, o.fitMaxGain);
      /* Ease on the same slow time constant as the distance gain, so the
         mapping never changes under the child mid-reach. */
      const gStep = 1 - Math.exp(-dt / o.gainTau);
      gainX += (wantGX - gainX) * gStep;
      gainY += (wantGY - gainY) * gStep;
      gx = gainX;
      gy = gainY;
    }

    // ── The mapping itself ───────────────────────────────────────────────
    const mx = softEdge(0.5 + (rx - anchorX) * gx, o.edgeKnee);
    const my = softEdge(0.5 + (ry - anchorY) * gy, o.edgeKnee);

    // ── 2. One-Euro ──────────────────────────────────────────────────────
    const dAlpha = alphaFor(dt, o.dCutoff);
    velX += ((mx - prevMX) / dt - velX) * dAlpha;
    velY += ((my - prevMY) / dt - velY) * dAlpha;
    prevMX = mx; prevMY = my;

    const speed  = Math.hypot(velX, velY);
    lastSpeed = speed;
    const alpha  = alphaFor(dt, o.minCutoff + o.beta * speed);

    /* Micro-deadband. One-Euro alone still passes roughly a fifth of the raw
       landmark jitter on a stationary hand, which on screen is a pointer that
       will not sit still. `hold` ramps the update from 0 to 1 across the
       deadband, so movement below `stillEps` moves the pointer not at all and
       anything larger is unaffected — a soft edge rather than a freeze, so the
       pointer never jumps when the child starts moving again. */
    /* The deadband is measured in BOARD units, but the jitter that has to fit
       inside it arrives in FRAME units and is then multiplied by the gain. A
       fixed deadband therefore stops working the moment reach fitting raises
       the gain — which is why a held pointer wobbled several times more with
       fitting on. Scaling it by the gain actually in use keeps the pointer
       equally steady at every distance and on every screen. */
    const eps = o.stillEps * Math.max(1, (gx + gy) / 2);
    const dist = Math.hypot(mx - outX, my - outY);
    const hold = dist <= eps ? 0
               : Math.min(1, (dist - eps) / eps);

    outX += (mx - outX) * alpha * hold;
    outY += (my - outY) * alpha * hold;

    // ── 3. Prediction ────────────────────────────────────────────────────
    /* Prediction has to obey the deadband too. `velX/velY` are measured from
       the PRE-deadband mapped position, so on a parked hand they still carry
       the raw jitter — and adding `vel * lead` back on top of a held `outX`
       reintroduced exactly the wobble the deadband had just removed. This was
       the dominant remaining source of movement on a still hand.

       Multiplying by `hold` (0 inside the deadband) and zeroing it outright
       while the hand is still means prediction only ever acts on real reaches,
       which is all it was ever for. */
    const lead = isStill ? 0
      : clamp((speed - o.predictFloor) / (o.predictFull - o.predictFloor), 0, 1) * hold;
    const ps   = (o.predictMs / 1000) * lead;
    const px   = outX + clamp(velX * ps, -o.maxPredict, o.maxPredict);
    const py   = outY + clamp(velY * ps, -o.maxPredict, o.maxPredict);

    return {
      x: clamp(px, 0, 1),
      y: clamp(py, 0, 1),
      gain,
      gainX, gainY,
      reachX, reachY,
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
