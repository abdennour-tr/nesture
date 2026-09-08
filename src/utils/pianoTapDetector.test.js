import { FINGER_TAP_PROFILES, makePianoTapDetector } from './pianoTapDetector';

const LONGS = {
  index: [8, 6, 5, 0.40], middle: [12, 10, 9, 0.47],
  ring: [16, 14, 13, 0.54], little: [20, 18, 17, 0.60],
};

function landmarks(ratios = {}, z = 0) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.7, z }));
  for (const [finger, [tip, pip, mcp, x]] of Object.entries(LONGS)) {
    const normalized = ratios[finger] ?? 1;
    lm[mcp] = { x, y: 0.7, z };
    lm[pip] = { x, y: 0.6, z };
    lm[tip] = { x, y: 0.7 - 0.2 * normalized, z };
  }
  // Open thumb ratio is 0.8 relative to palm width. Keep its joint bend cue
  // straight so tests can vary adduction independently.
  const thumbTipX = 0.40 + 0.16 * (ratios.thumb ?? 1);
  lm[4] = { x: thumbTipX, y: 0.7, z };
  lm[3] = { x: thumbTipX - 0.06, y: 0.7, z };
  lm[2] = { x: thumbTipX - 0.12, y: 0.7, z };
  return lm;
}

function feed(detector, from, count, ratios = {}, zOf = () => 0) {
  const taps = [];
  for (let i = 0; i < count; i++) {
    const at = from + i * 33;
    const reading = detector.update(landmarks(ratios, zOf(i)), at);
    if (reading.tap) taps.push(reading.tap);
  }
  return { taps, next: from + count * 33 };
}

function calibrated() {
  const detector = makePianoTapDetector();
  const { next } = feed(detector, 0, 11);
  return { detector, at: next };
}

test('thumb profile is deliberately less sensitive than the long fingers', () => {
  expect(FINGER_TAP_PROFILES.thumb.bend).toBeGreaterThan(FINGER_TAP_PROFILES.index.bend);
  expect(FINGER_TAP_PROFILES.thumb.frames).toBeGreaterThan(FINGER_TAP_PROFILES.index.frames);
  expect(FINGER_TAP_PROFILES.thumb.holdMs).toBeGreaterThan(FINGER_TAP_PROFILES.index.holdMs);
  expect(FINGER_TAP_PROFILES.thumb.cooldownMs).toBeGreaterThan(FINGER_TAP_PROFILES.index.cooldownMs);
});

test('small thumb motion does not trigger keys 1 or 6', () => {
  const { detector, at } = calibrated();
  const result = feed(detector, at, 14, { thumb: 0.94 });
  expect(result.taps).toEqual([]);
});

test('a sustained deliberate thumb bend triggers exactly once', () => {
  const { detector, at } = calibrated();
  const result = feed(detector, at, 14, { thumb: 0.76 });
  expect(result.taps).toHaveLength(1);
  expect(result.taps[0]).toMatchObject({ finger: 'thumb', ambiguous: false });
});

test.each([
  ['index', 0.82],
  ['middle', 0.82],
  ['ring', 0.84],
  ['little', 0.84],
])('%s uses its own profile and recognizes a deliberate bend', (finger, ratio) => {
  const { detector, at } = calibrated();
  const result = feed(detector, at, 14, { [finger]: ratio });
  expect(result.taps).toHaveLength(1);
  expect(result.taps[0]).toMatchObject({ finger, ambiguous: false });
});

test('little-finger landmark noise needs sustained confirming frames', () => {
  const { detector, at } = calibrated();
  const taps = [];
  let time = at;
  for (let i = 0; i < 15; i++, time += 33) {
    const ratio = i % 2 ? 0.91 : 1;
    const tap = detector.update(landmarks({ little: ratio }), time).tap;
    if (tap) taps.push(tap);
  }
  expect(taps).toEqual([]);
});

test('depth jitter and palm movement in z cannot create a phantom thumb tap', () => {
  const { detector, at } = calibrated();
  const result = feed(detector, at, 20, {}, i => (i % 2 ? 0.25 : -0.25));
  expect(result.taps).toEqual([]);
});

test('a whole-hand bend is reported as ambiguous', () => {
  const { detector, at } = calibrated();
  const result = feed(detector, at, 14, { index: 0.75, middle: 0.75, ring: 0.75, little: 0.75 });
  expect(result.taps).toHaveLength(1);
  expect(result.taps[0].ambiguous).toBe(true);
});
