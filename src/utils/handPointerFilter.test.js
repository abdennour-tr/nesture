import { createHandPointerFilter, handDepthScale, STABLE_POINTER_OPTIONS } from './handPointerFilter';

function hand(x, y = 0.5, span = 0.14) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6 }));
  lm[8] = { x: 1 - x, y };
  lm[9] = { x: 0.5, y: 0.6 - span };
  return lm;
}

const mapped = (x) => Math.max(0, Math.min(1, 0.5 + (x - 0.5) * STABLE_POINTER_OPTIONS.fixedGain));
const rms = (values) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);

test('attenuates stationary camera jitter without biasing fingertip position', () => {
  const filter = createHandPointerFilter();
  const errors = [], noise = [];
  for (let frame = 0; frame < 240; frame++) {
    const jitter = 0.004 * Math.sin(frame * 2.17) + 0.002 * Math.sin(frame * 1.31);
    const p = filter.push(hand(0.62 + jitter), frame * 1000 / 30);
    if (frame > 30) {
      errors.push(p.x - mapped(0.62));
      noise.push(jitter * STABLE_POINTER_OPTIONS.fixedGain);
    }
  }
  expect(rms(errors)).toBeLessThan(rms(noise) * 0.4);
  expect(Math.abs(errors.reduce((sum, x) => sum + x, 0) / errors.length)).toBeLessThan(0.0005);
});

test('palm rotation/depth never moves a stationary index fingertip', () => {
  const filter = createHandPointerFilter();
  for (let frame = 0; frame < 180; frame++) {
    const p = filter.push(hand(0.68, 0.37, 0.08 + 0.08 * (1 + Math.sin(frame / 9))), frame * 1000 / 30);
    expect(p.x).toBeCloseTo(mapped(0.68), 10);
    expect(p.y).toBeCloseTo(mapped(0.37), 10);
    expect(Number.isFinite(p.span)).toBe(true);
  }
});

test.each([15, 30, 60])('follows reaches promptly without overshoot at %i camera fps', (fps) => {
  const filter = createHandPointerFilter();
  let p;
  for (let frame = 0; frame <= fps * 2; frame++) {
    const seconds = frame / fps;
    const x = 0.35 + Math.max(0, Math.min(0.3, (seconds - 0.5) * 0.6));
    p = filter.push(hand(x), seconds * 1000);
    expect(p.x).toBeLessThanOrEqual(mapped(x) + 1e-9);
    if (seconds >= 0.7 && seconds <= 1) {
      // Under 60ms of filter delay at a full-board-per-second reach.
      expect(mapped(x) - p.x).toBeLessThan(0.06);
    }
  }
  expect(p.x).toBeCloseTo(mapped(0.65), 4);
});

test('small deliberate corrections settle exactly instead of sticking in a dead zone', () => {
  const filter = createHandPointerFilter();
  filter.push(hand(0.6), 0);
  let p;
  for (let i = 1; i <= 60; i++) p = filter.push(hand(0.602), i * 1000 / 30);
  expect(p.x).toBeCloseTo(mapped(0.602), 6);
});

test('rejects an isolated teleport and confirms a real large move on the next frame', () => {
  const filter = createHandPointerFilter();
  const start = filter.push(hand(0.4), 0);
  expect(filter.push(hand(0.8), 33)).toMatchObject({ x: start.x, accepted: false });
  expect(filter.push(hand(0.4), 66)).toMatchObject({ x: start.x, accepted: true });
  expect(filter.push(hand(0.8), 99).accepted).toBe(false);
  const confirmed = filter.push(hand(0.81), 132);
  expect(confirmed.accepted).toBe(true);
  expect(confirmed.x).toBeGreaterThan(start.x);
  expect(confirmed.x).toBeLessThan(mapped(0.81));
});

test('bridges a blink but reacquires after a long absence without stale velocity', () => {
  const filter = createHandPointerFilter();
  filter.push(hand(0.45), 0);
  const previous = filter.push(hand(0.46), 33);
  filter.lost();
  const resumed = filter.push(hand(0.47), 100);
  expect(resumed.reacquired).toBe(false);
  expect(resumed.x).toBeGreaterThan(previous.x);
  expect(resumed.x).toBeLessThan(mapped(0.47));
  filter.lost();
  expect(filter.push(hand(0.72), 700)).toMatchObject({ x: mapped(0.72), reacquired: true, speed: 0 });
});

test('rejects an isolated backwards teleport during a fast reach', () => {
  const filter = createHandPointerFilter();
  filter.push(hand(0.35), 0);
  filter.push(hand(0.40), 33);
  const previous = filter.push(hand(0.45), 66);
  expect(filter.push(hand(0.26), 99)).toMatchObject({ x: previous.x, accepted: false });
  const resumed = filter.push(hand(0.55), 132);
  expect(resumed.accepted).toBe(true);
  expect(resumed.x).toBeGreaterThan(previous.x);
});

test('accepts normal direction changes without prediction bounce', () => {
  const filter = createHandPointerFilter();
  let p;
  for (let frame = 0; frame <= 30; frame++) p = filter.push(hand(0.3 + frame * 0.01), frame * 1000 / 30);
  const turn = p.x;
  for (let frame = 1; frame <= 30; frame++) {
    p = filter.push(hand(0.6 - frame * 0.01), (30 + frame) * 1000 / 30);
    expect(p.accepted).toBe(true);
    expect(p.x).toBeLessThanOrEqual(turn);
  }
});

test('ignores duplicate timestamps, rejects malformed frames, and resets completely', () => {
  const filter = createHandPointerFilter();
  const first = filter.push(hand(0.3), 0);
  expect(filter.push(hand(0.8), 0)).toBe(first);
  expect(filter.push(hand(0.8), -1)).toBe(first);
  expect(filter.push(hand(NaN), 20)).toBeNull();
  expect(filter.push(null, 30)).toBeNull();
  filter.reset();
  expect(filter.push(hand(0.7), 40)).toMatchObject({ x: mapped(0.7), reacquired: true });
  expect(handDepthScale(Infinity)).toBe(1);
});

test('mirrors index x exactly once and reaches all board edges', () => {
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.6, 0.4]]) {
    const p = createHandPointerFilter().push(hand(x, y), 0);
    expect(p.x).toBeCloseTo(mapped(x), 10);
    expect(p.y).toBeCloseTo(mapped(y), 10);
  }
});
