import { POSE } from './poseLandmarks';
import { frameFeatures, sessionFeatures, correlation, countCrossings } from './poseFeatures';
import { computeIndicators, poseScoreContribution, blendWithGameScore } from './reflexIndicators';
import { directionalCorrelationScore, GATES } from './indicatorModel.v1';

/* ═══════════════════════════════════════════════════════════════════════════
   Synthetic bodies with KNOWN properties.

   A detector that returns plausible numbers on real footage proves nothing —
   the whole difficulty is that a wrong formula also returns plausible numbers.
   So each fixture below is built to contain, or deliberately not contain, one
   specific pattern, and the test asserts the indicator finds exactly that.

   The negative cases matter more than the positive ones. An indicator that
   fires on a child who does not have the pattern is worse than one that never
   fires at all, because it puts a finding in a report that nothing supports.
   ═══════════════════════════════════════════════════════════════════════════ */

const P = (x, y, visibility = 1) => ({ x, y, z: 0, visibility });

/**
 * One frame of a seated upper body.
 * @param yaw     -1..1  head rotation, + = subject's right
 * @param extR    0..1   right arm extension
 * @param extL    0..1   left arm extension
 * @param pitch          nose height above the shoulder line, in shoulder-widths
 */
function body({ yaw = 0, extR = 0.5, extL = 0.5, pitch = 0.55, lean = 0 } = {}) {
  const lm = [];
  // Shoulders one unit apart, subject's left at greater x (non-mirrored frame).
  const shoulderY = 0.55;
  lm[POSE.LEFT_SHOULDER] = P(0.62, shoulderY);
  lm[POSE.RIGHT_SHOULDER] = P(0.38, shoulderY);
  const width = 0.24;
  const midX = 0.5;

  // Head: the nose slides off the ear midpoint as the head turns.
  const earHalf = 0.075;
  lm[POSE.LEFT_EAR] = P(midX + earHalf, shoulderY - pitch * width, 1 - Math.max(0, -yaw) * 0.7);
  lm[POSE.RIGHT_EAR] = P(midX - earHalf, shoulderY - pitch * width, 1 - Math.max(0, yaw) * 0.7);
  lm[POSE.NOSE] = P(midX + yaw * earHalf, shoulderY - pitch * width);

  /* Elbow angle straight from the requested extension, inverting the mapping
     the feature layer uses (30°..180° → 0..1), so a fixture asking for 0.8
     produces a frame the extractor reads back as 0.8. */
  const place = (shoulder, ext, dir) => {
    const deg = 30 + ext * 150;
    const rad = (deg * Math.PI) / 180;
    const upper = 0.14;
    const elbow = { x: shoulder.x + dir * upper * 0.4, y: shoulder.y + upper };
    // Rotate the forearm about the elbow so the interior angle equals `deg`.
    const base = Math.atan2(shoulder.y - elbow.y, shoulder.x - elbow.x);
    const wrist = {
      x: elbow.x + upper * Math.cos(base - dir * rad),
      y: elbow.y + upper * Math.sin(base - dir * rad),
    };
    return [P(elbow.x, elbow.y), P(wrist.x, wrist.y)];
  };
  const [le, lw] = place(lm[POSE.LEFT_SHOULDER], extL, 1);
  const [re, rw] = place(lm[POSE.RIGHT_SHOULDER], extR, -1);
  lm[POSE.LEFT_ELBOW] = le; lm[POSE.LEFT_WRIST] = lw;
  lm[POSE.RIGHT_ELBOW] = re; lm[POSE.RIGHT_WRIST] = rw;

  lm[POSE.LEFT_HIP] = P(0.58 + lean * 0.1, 0.95);
  lm[POSE.RIGHT_HIP] = P(0.42 + lean * 0.1, 0.95);
  return lm;
}

/** A session of `n` frames at 15Hz, each built by `shape(i)`. */
function session(n, shape) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push({ t: i * (1000 / 15), features: frameFeatures(body(shape(i))) });
  }
  return out;
}

// ── The feature layer reads back what the fixture put in ────────────────────

describe('feature extraction', () => {
  test('a neutral posture reads as neutral, not as missing', () => {
    const f = frameFeatures(body({ yaw: 0, extL: 0.5, extR: 0.5 }));
    expect(f).not.toBeNull();
    expect(Math.abs(f.headYaw)).toBeLessThan(0.15);
    expect(Math.abs(f.extensionAsymmetry)).toBeLessThan(0.1);
  });

  test('head rotation is signed toward the side the head turned', () => {
    expect(frameFeatures(body({ yaw: 0.8 })).headYaw).toBeGreaterThan(0.2);
    expect(frameFeatures(body({ yaw: -0.8 })).headYaw).toBeLessThan(-0.2);
  });

  test('arm extension is recovered from the elbow angle', () => {
    const f = frameFeatures(body({ extR: 0.9, extL: 0.2 }));
    expect(f.armExtensionRight).toBeGreaterThan(f.armExtensionLeft);
    expect(f.extensionAsymmetry).toBeGreaterThan(0.3);
  });

  test('a frame without shoulders yields null rather than zeros', () => {
    expect(frameFeatures([])).toBeNull();
    expect(frameFeatures(null)).toBeNull();
  });

  test('correlation refuses a flat series instead of returning 0', () => {
    const flat = new Array(50).fill(1);
    const ramp = flat.map((_, i) => i);
    expect(correlation(flat, ramp)).toBeNull();
  });

  test('a hand crossing the body midline is counted once per crossing', () => {
    const frames = [
      { wristOffsetLeft: 0.5 }, { wristOffsetLeft: 0.3 }, { wristOffsetLeft: -0.3 },
      { wristOffsetLeft: -0.4 }, { wristOffsetLeft: 0.4 }, { wristOffsetLeft: -0.5 },
    ];
    expect(countCrossings(frames)).toBe(2);
  });
});

// ── ATNR: the pattern, and the absence of it ────────────────────────────────

describe('ATNR indicator', () => {
  /** Head turns side to side; the arm on the side the head faces extends. */
  const withPattern = (i) => {
    const yaw = Math.sin(i / 10);
    return { yaw, extR: 0.5 + yaw * 0.35, extL: 0.5 - yaw * 0.35 };
  };
  /** Head turns just as much; the arms do their own unrelated thing. */
  const withoutPattern = (i) => ({
    yaw: Math.sin(i / 10),
    extR: 0.5 + Math.sin(i / 3.1) * 0.3,
    extL: 0.5 + Math.cos(i / 4.7) * 0.3,
  });

  const atnrOf = (samples) => {
    const result = computeIndicators(sessionFeatures(samples));
    return result.indicators.find((i) => i.key === 'ATNR');
  };

  test('finds the pattern when it is there', () => {
    const a = atnrOf(session(300, withPattern));
    expect(a.measured).toBe(true);
    expect(a.value).toBeGreaterThan(60);
    expect(a.confidence).toBeGreaterThan(0.3);
  });

  test('does NOT fire when the head moves but the arms are unrelated', () => {
    const a = atnrOf(session(300, withoutPattern));
    expect(a.value).toBeLessThan(40);
  });

  test('refuses to score a session where the head never turned', () => {
    const a = atnrOf(session(300, (i) => ({ yaw: 0, extR: 0.5 + Math.sin(i / 6) * 0.3 })));
    expect(a.measured).toBe(false);
    expect(a.notMeasuredReason).toMatch(/head/i);
    expect(a.value).toBeNull();      // never 0 — that would read as "settled"
  });

  test('an INVERTED relationship is not counted as evidence', () => {
    // Arms move opposite to what ATNR predicts. That is evidence against the
    // pattern; taking |r| here would have scored it as strongly present.
    const a = atnrOf(session(300, (i) => {
      const yaw = Math.sin(i / 10);
      return { yaw, extR: 0.5 - yaw * 0.35, extL: 0.5 + yaw * 0.35 };
    }));
    expect(a.value).toBe(0);
  });

  test('a session too short to mean anything is not scored', () => {
    const result = computeIndicators(sessionFeatures(session(30, withPattern)));
    expect(result.usable).toBe(false);
    expect(result.indicators).toHaveLength(0);
  });
});

// ── STNR ────────────────────────────────────────────────────────────────────

describe('STNR indicator', () => {
  const stnrOf = (samples) =>
    computeIndicators(sessionFeatures(samples)).indicators.find((i) => i.key === 'STNR');

  test('finds head-pitch coupled to symmetric arm extension', () => {
    const s = stnrOf(session(300, (i) => {
      const pitch = 0.55 + Math.sin(i / 12) * 0.25;
      const ext = 0.5 + Math.sin(i / 12) * 0.3;
      return { pitch, extR: ext, extL: ext };
    }));
    expect(s.measured).toBe(true);
    expect(s.value).toBeGreaterThan(60);
  });

  test('refuses a session where the head never moved vertically', () => {
    const s = stnrOf(session(300, (i) => ({ pitch: 0.55, extR: 0.5 + Math.sin(i / 8) * 0.3 })));
    expect(s.measured).toBe(false);
    expect(s.value).toBeNull();
  });
});

// ── The scoring rules ───────────────────────────────────────────────────────

describe('directional scoring', () => {
  test('only the hypothesised direction earns a score', () => {
    expect(directionalCorrelationScore(0.8, { expectSign: 1 })).toBeGreaterThan(80);
    expect(directionalCorrelationScore(-0.8, { expectSign: 1 })).toBe(0);
  });

  test('noise-level correlation scores zero, not "a little bit present"', () => {
    expect(directionalCorrelationScore(0.1, { expectSign: 1 })).toBe(0);
  });

  test('a missing correlation is null, never zero', () => {
    expect(directionalCorrelationScore(null)).toBeNull();
  });
});

describe('score contribution', () => {
  const usable = () => computeIndicators(sessionFeatures(session(300, (i) => ({
    yaw: Math.sin(i / 10), extR: 0.5, extL: 0.5,
  }))));

  test('reflex indicators contribute NOTHING to a game score in v1', () => {
    /* The indicators are unvalidated. Until they are calibrated, a child must
       not be marked down by one. This test is the guard on that decision: if
       someone raises a reflex weight, it fails and they have to mean it. */
    const c = poseScoreContribution(usable(), 'pinch-coin');
    const reflexKeys = ['ATNR', 'STNR', 'Moro', 'TLR'];
    expect(c.components.every((comp) => !reflexKeys.includes(comp.key))).toBe(true);
  });

  test('postural measures do contribute, and stay capped', () => {
    const c = poseScoreContribution(usable(), 'bubble');
    expect(c.components.length).toBeGreaterThan(0);
    expect(c.share).toBeLessThanOrEqual(0.2);
  });

  test('blending never lets pose dominate the game score', () => {
    const blended = blendWithGameScore(80, { value: 0, share: 0.15 });
    expect(blended).toBe(68);        // 80 * 0.85 — the game still leads
  });

  test('a game with no pose data keeps its own score untouched', () => {
    expect(blendWithGameScore(74, { value: null, share: 0.15 })).toBe(74);
    expect(blendWithGameScore(74, null)).toBe(74);
  });
});

describe('session gates', () => {
  test('a session with too few frames reports why, and scores nothing', () => {
    const r = computeIndicators(sessionFeatures(session(GATES.MIN_FRAMES - 10, () => ({}))));
    expect(r.usable).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  test('every result carries its model version and provisional flag', () => {
    const r = computeIndicators(sessionFeatures(session(300, (i) => ({ yaw: Math.sin(i / 10) }))));
    expect(r.modelVersion).toMatch(/provisional/);
    expect(r.isProvisional).toBe(true);
    r.indicators.forEach((i) => expect(i.disclaimer).toMatch(/not a clinical finding/i));
  });
});
