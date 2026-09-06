/**
 * letterStrokes.js
 * ---------------------------------------------------------------------------
 * The letter-formation model for Trace → Find → Type.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The old model kept three things in sync BY HAND:
 *
 *   LETTER_DATA.path        the drawn outline
 *   LETTER_DATA.waypoints   the dots the child has to touch
 *   BAD_JUMPS = { A:[2,4] } which of those dots are pen lifts
 *
 * Two problems followed from that.
 *
 * 1. The waypoint lists were written by hand, and the straight-line letters
 *    only ever got their END POINTS. Measured on the 300x300 box:
 *
 *        X  4 points, largest gap 284px      C  7 points, largest gap  92px
 *        Z  4 points, largest gap 284px      O  9 points, largest gap  89px
 *        N  5 points, largest gap 272px      S  9 points, largest gap  89px
 *        H  6 points, largest gap 220px      G  9 points, largest gap 100px
 *
 *    A 284px gap in a 300px box means the child touches one corner, then the
 *    opposite corner, and the stroke counts as traced — they can travel by any
 *    route, or none. The curved letters were properly sampled; the straight
 *    ones were not. That is the "the letter finishes without touching the
 *    points" complaint.
 *
 * 2. `BAD_JUMPS` is a list of INDEXES into a separate array. Any edit to a
 *    letter's waypoints silently invalidates it.
 *
 * THE MODEL
 * ---------
 * The path string is now the single source of truth. Each letter is parsed
 * into STROKES (one per pen-down, i.e. per `M` command), each stroke is
 * resampled at a constant arc-length spacing, and the pen lifts are DERIVED
 * from where the strokes meet. The three used to be able to disagree; now they
 * cannot.
 *
 * STROKE ORDER
 * ------------
 * Formation follows the capital-letter sequence used in Handwriting Without
 * Tears, the curriculum most pediatric OT programmes teach from — which suits
 * an app that reports OT scores. Its rules, and how they show up here:
 *
 *   • Every capital starts at the top. The round letters (C, G, O, Q, S) start
 *     at "1 o'clock" and travel anti-clockwise — the "magic c" start.
 *   • "Frog jump" capitals (B D E F M N P R) are a big line down, then the pen
 *     jumps back to the top for the rest. Those are the strokes below.
 *   • Corner starters (H K L U V W X Y Z) start at the top-left corner.
 *   • Horizontal strokes always run left → right; vertical strokes top → bottom.
 *
 * Each stroke also carries the curriculum's own name for it ("big line down",
 * "little line across"), so the game can coach in the same words a therapist
 * uses instead of showing a bare number.
 */

/* ── The letters. One path per letter; `M` starts a new stroke. ───────────── */
export const LETTER_PATHS = {
  A: 'M150,40 L50,260 M150,40 L250,260 M100,170 L200,170',
  B: 'M70,40 L70,260 M70,40 Q230,40 230,100 Q230,150 70,150 Q240,150 240,210 Q240,260 70,260',
  C: 'M230,80 Q150,20 70,80 Q40,150 70,220 Q150,280 230,230',
  D: 'M70,40 L70,260 M70,40 Q260,40 260,150 Q260,260 70,260',
  E: 'M70,40 L70,260 M70,40 L210,40 M70,150 L180,150 M70,260 L210,260',
  F: 'M70,40 L70,260 M70,40 L210,40 M70,150 L180,150',
  G: 'M230,80 Q150,20 70,80 Q40,150 70,220 Q150,280 230,220 L230,160 L170,160',
  H: 'M70,40 L70,260 M230,40 L230,260 M70,150 L230,150',
  I: 'M150,40 L150,260 M100,40 L200,40 M100,260 L200,260',
  J: 'M190,40 L190,210 Q190,270 120,250 Q80,240 80,220',
  K: 'M70,40 L70,260 M220,40 L70,160 L220,260',
  L: 'M70,40 L70,260 L220,260',
  M: 'M50,40 L50,260 M50,40 L150,160 L250,40 L250,260',
  N: 'M70,40 L70,260 M70,40 L230,260 L230,40',
  O: 'M150,40 Q50,40 50,150 Q50,260 150,260 Q250,260 250,150 Q250,40 150,40',
  P: 'M70,40 L70,260 M70,40 Q240,40 240,100 Q240,160 70,160',
  /* The tail starts ON the ring (215,215), not inside it. It used to begin at
     (200,210), a point floating in the middle of the O, so the child was asked
     to lift the pen to a spot that is not on the letter. */
  Q: 'M150,40 Q50,40 50,150 Q50,260 150,260 Q250,260 250,150 Q250,40 150,40 M215,215 L265,270',
  R: 'M70,40 L70,260 M70,40 Q240,40 240,100 Q240,160 70,160 L230,260',
  S: 'M220,70 Q150,20 80,70 Q50,120 150,150 Q250,180 220,230 Q170,280 70,230',
  T: 'M150,40 L150,260 M50,40 L250,40',
  U: 'M70,40 L70,200 Q70,270 150,270 Q230,270 230,200 L230,40',
  V: 'M50,40 L150,260 L250,40',
  W: 'M30,40 L90,260 L150,120 L210,260 L270,40',
  X: 'M60,40 L240,260 M240,40 L60,260',
  Y: 'M50,40 L150,150 M250,40 L150,150 L150,260',
  Z: 'M60,40 L240,40 L60,260 L240,260',
};

/* ── Stroke names, in the curriculum's own vocabulary ─────────────────────
   One entry per stroke, in order, so the game can say "Big line down" rather
   than "waypoint 4". Lengths must match the number of `M` commands above —
   verified by assertStrokeNames() at the bottom of this file in development. */
export const STROKE_NAMES = {
  A: ['Big slant down to the left', 'Big slant down to the right', 'Little line across'],
  B: ['Big line down', 'Two little curves — top bump, then bottom bump'],
  C: ['Big curve — start at the top and go round to the left'],
  D: ['Big line down', 'Big curve round to the bottom'],
  E: ['Big line down', 'Little line across the top', 'Little line across the middle', 'Little line across the bottom'],
  F: ['Big line down', 'Little line across the top', 'Little line across the middle'],
  G: ['Big curve round, then up and a little line back to the left'],
  H: ['Big line down', 'Another big line down', 'Little line across the middle'],
  I: ['Big line down', 'Little line across the top', 'Little line across the bottom'],
  J: ['Big line down, then curve to the left'],
  K: ['Big line down', 'Slant in to the middle, then slant out to the corner'],
  L: ['Big line down, then a little line across'],
  M: ['Big line down', 'Slant down, slant up, then a big line down'],
  N: ['Big line down', 'Big slant down, then a big line up'],
  O: ['Big curve all the way round'],
  P: ['Big line down', 'Little curve round to the middle'],
  Q: ['Big curve all the way round', 'Little slant for the tail'],
  R: ['Big line down', 'Little curve to the middle, then a slant to the corner'],
  S: ['Curve back, round, and back again'],
  T: ['Big line down', 'Little line across the top'],
  U: ['Big line down, curve, then a big line up'],
  V: ['Big slant down, then a big slant up'],
  W: ['Slant down, up, down, up'],
  X: ['Big slant down to the right', 'Big slant down to the left'],
  Y: ['Slant down to the middle', 'Slant down to the middle, then a big line down'],
  Z: ['Little line across, big slant down, little line across'],
};

/* ═══════════════════════════════════════════════════════════════════════════
   Path parsing and arc-length resampling
   ═══════════════════════════════════════════════════════════════════════════ */

/** Parse an M/L/Q path into strokes: [{ segs: [{type,...}] }] */
function parsePath(d) {
  const tokens = d.match(/[MLQZ][^MLQZ]*/gi) || [];
  const strokes = [];
  let cur = null;
  let pen = { x: 0, y: 0 };

  for (const tok of tokens) {
    const cmd = tok[0].toUpperCase();
    const n = (tok.slice(1).match(/-?\d*\.?\d+/g) || []).map(Number);

    if (cmd === 'M') {
      pen = { x: n[0], y: n[1] };
      cur = { start: pen, segs: [] };
      strokes.push(cur);
    } else if (cmd === 'L') {
      for (let i = 0; i + 1 < n.length; i += 2) {
        const p = { x: n[i], y: n[i + 1] };
        cur.segs.push({ type: 'L', a: pen, b: p });
        pen = p;
      }
    } else if (cmd === 'Q') {
      for (let i = 0; i + 3 < n.length; i += 4) {
        const c = { x: n[i], y: n[i + 1] };
        const p = { x: n[i + 2], y: n[i + 3] };
        cur.segs.push({ type: 'Q', a: pen, c, b: p });
        pen = p;
      }
    }
    // Z is ignored: no letter here needs an implicit closing segment.
  }
  return strokes.filter((s) => s.segs.length > 0);
}

function pointAt(seg, t) {
  if (seg.type === 'L') {
    return { x: seg.a.x + (seg.b.x - seg.a.x) * t, y: seg.a.y + (seg.b.y - seg.a.y) * t };
  }
  const u = 1 - t;
  return {
    x: u * u * seg.a.x + 2 * u * t * seg.c.x + t * t * seg.b.x,
    y: u * u * seg.a.y + 2 * u * t * seg.c.y + t * t * seg.b.y,
  };
}

/** Flatten a stroke into a dense polyline, remembering where segments join. */
function flatten(stroke, steps = 60) {
  const pts = [];
  const joints = [];                 // indexes in `pts` where two segments meet
  for (const seg of stroke.segs) {
    const n = seg.type === 'L' ? 1 : steps;
    if (pts.length) joints.push(pts.length - 1);
    for (let i = pts.length === 0 ? 0 : 1; i <= n; i++) pts.push(pointAt(seg, i / n));
  }
  return { pts, joints };
}

function arcLengths(pts) {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return acc;
}

/** Turn angle (degrees) of the polyline at index i. */
function turnAt(pts, i) {
  if (i <= 0 || i >= pts.length - 1) return 0;
  const ax = pts[i].x - pts[i - 1].x, ay = pts[i].y - pts[i - 1].y;
  const bx = pts[i + 1].x - pts[i].x, by = pts[i + 1].y - pts[i].y;
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  if (la < 1e-6 || lb < 1e-6) return 0;
  const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Resample one polyline run at a constant arc-length spacing, ends included. */
function resampleRun(pts, spacing) {
  const acc = arcLengths(pts);
  const length = acc[acc.length - 1];
  if (length < 1) return [pts[0]];

  /* A whole number of equal steps, so the spacing stays uniform and the last
     point lands exactly on the end of the run (a short final hop would read as
     a stray dot). `ceil`, not `round`: rounding DOWN on a short run stretches
     its step past the target — A's 100px crossbar at 72px spacing became a
     single 100px hop — and the whole point of this file is that no gap is
     bigger than the child can be expected to trace. */
  let steps = Math.max(1, Math.ceil(length / spacing));

  /* ...but never SUBDIVIDE below 60% of the spacing either. The tolerance the
     game uses to accept a touch has to stay smaller than the smallest gap, or
     one touch claims two dots at once and part of the letter is skipped.
     Keeping every gap in [0.6 x spacing, spacing] lets the tolerance sit
     safely at ~0.55 x spacing and still feel forgiving. */
  const minStep = spacing * 0.6;
  while (steps > 1 && length / steps < minStep) steps--;

  const step = length / steps;
  const out = [];
  let j = 0;
  for (let i = 0; i <= steps; i++) {
    const target = i * step;
    while (j < acc.length - 2 && acc[j + 1] < target) j++;
    const span = acc[j + 1] - acc[j];
    const t = span > 0 ? (target - acc[j]) / span : 0;
    out.push({
      x: Math.round(pts[j].x + (pts[j + 1].x - pts[j].x) * t),
      y: Math.round(pts[j].y + (pts[j + 1].y - pts[j].y) * t),
    });
  }
  return out;
}

/**
 * Resample a whole stroke, forcing a waypoint exactly on every CORNER.
 *
 * Resampling a stroke as one continuous run puts no dot on a sharp corner —
 * the two nearest dots straddle it. On V that left them 28px apart in straight
 * line distance even though they were 69px apart along the path, so a single
 * touch satisfied both and the child never had to reach the point of the V at
 * all. Corners are exactly where letter formation has to be precise, so each
 * corner-to-corner run is resampled independently and the corner itself is
 * always a dot.
 *
 * Smooth joins (the curve-to-curve seams inside O, S, B) turn by only a few
 * degrees and are deliberately NOT treated as corners — forcing dots there
 * would bunch them up for no pedagogical gain.
 */
function resample(stroke, spacing) {
  const { pts, joints } = flatten(stroke);
  const CORNER_DEG = 25;
  const corners = joints.filter((i) => turnAt(pts, i) > CORNER_DEG);

  const bounds = [0, ...corners, pts.length - 1];
  const out = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const run = pts.slice(bounds[k], bounds[k + 1] + 1);
    const sampled = resampleRun(run, spacing);
    // The corner point is shared by the run that ends on it and the next one.
    out.push(...(k === 0 ? sampled : sampled.slice(1)));
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Public API
   ═══════════════════════════════════════════════════════════════════════════ */

const cache = new Map();

/**
 * Build a letter's tracing data at a given waypoint spacing.
 *
 * @param {string} letter    'A' … 'Z'
 * @param {number} spacing   px between waypoints along a stroke (300x300 box)
 * @returns {{
 *   waypoints: {x,y}[],   every dot, in the order they must be touched
 *   jumps: number[],      indexes where the pen LIFTS to start a new stroke
 *   strokeOf: number[],   which stroke each waypoint belongs to
 *   strokeNames: string[],
 *   path: string,
 * }}
 */
export function buildLetter(letter, spacing = 56) {
  const key = `${letter}@${spacing}`;
  if (cache.has(key)) return cache.get(key);

  const path = LETTER_PATHS[letter] || LETTER_PATHS.A;
  const strokes = parsePath(path);

  const waypoints = [];
  const jumps = [];
  const strokeOf = [];

  strokes.forEach((stroke, si) => {
    const pts = resample(stroke, spacing);
    /* Every stroke after the first begins with a pen lift, and its index is
       wherever it happens to land — derived, never hand-maintained, so it can
       no longer drift out of step with the waypoints. */
    if (si > 0) jumps.push(waypoints.length);
    pts.forEach((p) => { waypoints.push(p); strokeOf.push(si); });
  });

  const built = {
    waypoints,
    jumps,
    strokeOf,
    strokeNames: STROKE_NAMES[letter] || [],
    path,
  };
  cache.set(key, built);
  return built;
}

/* ── Development guard rails ─────────────────────────────────────────────
   These catch the two failure modes the old hand-maintained model allowed:
   a stroke-name list that no longer matches the strokes, and a letter whose
   waypoints are too far apart to represent tracing. */
if (process.env.NODE_ENV !== 'production') {
  Object.keys(LETTER_PATHS).forEach((L) => {
    const strokes = parsePath(LETTER_PATHS[L]);
    const names = STROKE_NAMES[L] || [];
    if (names.length !== strokes.length) {
      // eslint-disable-next-line no-console
      console.error(
        `[letterStrokes] ${L}: ${strokes.length} strokes but ${names.length} stroke names.`
      );
    }
    const { waypoints, jumps } = buildLetter(L, 56);
    const lift = new Set(jumps);
    waypoints.forEach((p, i) => {
      if (i === 0 || lift.has(i)) return;
      const d = Math.hypot(p.x - waypoints[i - 1].x, p.y - waypoints[i - 1].y);
      if (d > 56 * 1.6) {
        // eslint-disable-next-line no-console
        console.error(`[letterStrokes] ${L}: ${d.toFixed(0)}px gap at waypoint ${i}.`);
      }
    });
  });
}
