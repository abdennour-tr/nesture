import createActiveHandSelector from './activeHandSelector';

function hand(x, tipOffset = 0) {
  const landmarks = Array.from({ length: 21 }, () => ({ x, y: 0.55, z: 0 }));
  landmarks[0] = { x, y: 0.65, z: 0 };
  landmarks[5] = { x: x - 0.02, y: 0.56, z: 0 };
  landmarks[8] = { x: x + tipOffset, y: 0.40, z: 0 };
  landmarks[17] = { x: x + 0.09, y: 0.60, z: 0 };
  return landmarks;
}

const labels = [{ label: 'Right' }, { label: 'Left' }];
const pointerSelector = (options = {}) => createActiveHandSelector({
  stableSelection: true, requireMotion: false, ...options,
});

test('slow valid camera results retain the same hand identity', () => {
  const selector = pointerSelector();
  const initial = selector.select([hand(0.3)], labels, 0);
  for (let time = 500; time <= 10000; time += 500) {
    expect(selector.select([hand(0.3)], labels, time).key).toBe(initial.key);
  }
  // Explicit loss still expires on the normal grace, independently of cadence.
  expect(selector.select([], [], 10500).key).toBeNull();
});

test('a held playing hand stays active even after its motion history expires', () => {
  const selector = pointerSelector({ requireMotion: true });
  expect(selector.select([hand(0.3)], labels, 0).reason).toBe('idle');
  const acquired = selector.select([hand(0.3, 0.06)], labels, 30);
  expect(acquired.reason).toBe('ok');
  for (let time = 60; time <= 1200; time += 30) {
    const held = selector.select([hand(0.3, 0.06)], labels, time);
    expect(held.key).toBe(acquired.key);
    expect(held.reason).toBe('ok');
    expect(held.landmarks).not.toBeNull();
  }
});

test('a second moving hand needs a sustained score advantage to take control', () => {
  const selector = pointerSelector();
  const initial = selector.select([hand(0.3), hand(0.75)], labels, 0);
  const contender = selector.select([hand(0.3), hand(0.75, 0.08)], labels, 30);
  expect(contender.key).toBe(initial.key);
  expect(selector.select([hand(0.3), hand(0.75, 0.10)], labels, 200).key).toBe(initial.key);
  const switched = selector.select([hand(0.3), hand(0.75, 0.12)], labels, 290);
  expect(switched.index).toBe(1);
  expect(switched.key).not.toBe(initial.key);
});

test('an interrupted contender advantage cannot trigger a delayed switch', () => {
  const selector = pointerSelector();
  const initial = selector.select([hand(0.3), hand(0.75)], labels, 0);
  selector.select([hand(0.3), hand(0.75, 0.08)], labels, 30);
  selector.select([hand(0.3, 0.08), hand(0.75, 0.08)], labels, 150);
  expect(selector.select([hand(0.3, 0.10), hand(0.75, 0.12)], labels, 300).key).toBe(initial.key);
});

test('losing the active hand keeps its identity through grace instead of jumping to the resting hand', () => {
  const selector = pointerSelector();
  const initial = selector.select([hand(0.3), hand(0.75)], labels, 0);
  const missing = selector.select([hand(0.75)], [labels[1]], 50);
  expect(missing).toMatchObject({ key: initial.key, index: -1, landmarks: null, reason: 'blink' });
  const returned = selector.select([hand(0.75), hand(0.32)], [labels[1], labels[0]], 300);
  expect(returned).toMatchObject({ key: initial.key, index: 1, reason: 'ok' });
  const expired = selector.select([hand(0.75)], [labels[1]], 750);
  expect(expired.index).toBe(0);
  expect(expired.key).not.toBe(initial.key);
});

test('identity survives reordered results, missing labels, and brief handedness noise', () => {
  const selector = pointerSelector();
  const initial = selector.select([hand(0.3), hand(0.75)], labels, 0);
  const reordered = selector.select([hand(0.75), hand(0.31)], [labels[1], labels[0]], 30);
  expect(reordered).toMatchObject({ key: initial.key, index: 1 });
  const mislabeled = selector.select([hand(0.32), hand(0.75)], [labels[1], labels[0]], 60);
  expect(mislabeled).toMatchObject({ key: initial.key, index: 0 });
  const unlabeled = selector.select([hand(0.75), hand(0.33)], [], 90);
  expect(unlabeled).toMatchObject({ key: initial.key, index: 1 });
});

test('total tracking loss clears control after grace and reset creates a fresh identity', () => {
  const selector = pointerSelector();
  const initial = selector.select([hand(0.3)], labels, 0);
  expect(selector.select([], [], 100)).toMatchObject({ key: initial.key, reason: 'blink', landmarks: null });
  expect(selector.select([], [], 450)).toMatchObject({ key: null, reason: 'no-hand', landmarks: null });
  const reacquired = selector.select([hand(0.3)], labels, 500);
  expect(reacquired.key).not.toBe(initial.key);
  selector.reset();
  expect(selector.select([hand(0.3)], labels, 530).key).not.toBe(reacquired.key);
});

test('default selection preserves the existing motion requirement and handedness keys', () => {
  const selector = createActiveHandSelector();
  expect(selector.select([hand(0.3)], labels, 0).reason).toBe('idle');
  expect(selector.select([hand(0.3, 0.06)], labels, 30)).toMatchObject({ key: 'Right', reason: 'ok' });
});

/* ── Single-hand lock ───────────────────────────────────────────────────────
   Client feedback: with two hands in frame the pointer became unstable. The
   lock answers it by removing the per-frame comparison entirely: one hand is
   chosen once, and nothing else can take the pointer while it is on screen. */
const lockedSelector = (options = {}) => createActiveHandSelector({
  singleHandLock: true, requireMotion: true, ...options,
});

/** Sweep a hand across the frame so it reads as "playing". */
function acquire(selector, x = 0.3, start = 0) {
  let result = null;
  for (let i = 0; i < 20; i += 1) {
    result = selector.select([hand(x + i * 0.012, 0.06)], labels, start + i * 33);
  }
  return result;
}

test('the lock acquires the moving hand, not a resting one', () => {
  const selector = lockedSelector();
  let result = null;
  for (let i = 0; i < 20; i += 1) {
    // index 0 is parked, index 1 sweeps across the frame
    result = selector.select([hand(0.2), hand(0.5 + i * 0.012, 0.06)], labels, i * 33);
  }
  expect(result.index).toBe(1);
  expect(result.reason).toBe('ok');
});

test('a livelier second hand can never take the pointer from the locked hand', () => {
  const selector = lockedSelector();
  const locked = acquire(selector);
  expect(locked.landmarks).not.toBeNull();

  for (let i = 0; i < 90; i += 1) {
    // The locked hand holds still while a second hand sweeps twice as fast.
    const result = selector.select(
      [hand(0.3 + 20 * 0.012, 0.06), hand(0.95 - i * 0.02, 0.06)],
      labels,
      700 + i * 33,
    );
    expect(result.key).toBe(locked.key);
  }
});

test('a brief dropout holds the pointer instead of handing it to the other hand', () => {
  const selector = lockedSelector();
  const locked = acquire(selector);

  for (let i = 0; i < 9; i += 1) {   // ~300ms, under the release window
    const result = selector.select([hand(0.95 - i * 0.02, 0.06)], labels, 700 + i * 33);
    expect(result.landmarks).toBeNull();
    expect(result.reason).toBe('blink');
    expect(result.key).toBe(locked.key);
  }
});

test('the lock releases after a sustained absence and re-acquires cleanly', () => {
  const selector = lockedSelector();
  acquire(selector);
  for (let t = 700; t < 2400; t += 33) selector.select([], [], t);   // hand put down

  const reacquired = acquire(selector, 0.8, 2400);
  expect(reacquired.reason).toBe('ok');
  expect(reacquired.landmarks).not.toBeNull();
});

test('releaseActiveHand lets the child swap hands without waiting for the timer', () => {
  const selector = lockedSelector();
  const first = acquire(selector);

  // While locked, the other hand cannot take over however much it moves.
  let result = selector.select(
    [hand(0.3 + 20 * 0.012, 0.06), hand(0.9, 0.06)], labels, 700,
  );
  expect(result.key).toBe(first.key);

  // The child lowers the first hand and holds still for a moment.
  for (let i = 0; i < 20; i += 1) {
    result = selector.select(
      [hand(0.3 + 20 * 0.012), hand(0.9)], labels, 740 + i * 33,
    );
  }

  // Releasing re-opens acquisition immediately — without it the first hand
  // would keep the pointer — and the hand that is now moving wins.
  selector.releaseActiveHand();
  for (let i = 0; i < 20; i += 1) {
    result = selector.select(
      [hand(0.3 + 20 * 0.012), hand(0.9 - i * 0.02, 0.06)], labels, 1400 + i * 33,
    );
  }
  expect(result.index).toBe(1);
  expect(result.reason).toBe('ok');
});

/* ── Hand-side lock (Pinch the Coin) ────────────────────────────────────────
   Client feedback: a learner shaking her other hand (excited / nervous) kept
   losing the coin, because the picker jumped to the hand that moved most.
   With `handSideLock` the side of the first hand seen owns the round. */
const sideSelector = (options = {}) => createActiveHandSelector({
  handSideLock: true, ...options,
});
const R = { label: 'Right' };
const L = { label: 'Left' };

test('side lock: the first hand seen keeps the game while the other hand shakes hard', () => {
  const selector = sideSelector();
  // The playing hand appears first, alone.
  const first = selector.select([hand(0.3)], [R], 0);
  expect(first).toMatchObject({ key: 'side:Right', reason: 'ok', index: 0 });

  // The other hand now enters and shakes violently for 3s while the playing
  // hand is almost still (pinching). MediaPipe's result order also flips.
  for (let i = 0; i < 90; i += 1) {
    const shake = 0.7 + (i % 2 ? 0.12 : -0.12);
    const flipOrder = i % 3 === 0;
    const hands = flipOrder ? [hand(shake, 0.1), hand(0.3 + (i % 2) * 0.002)] : [hand(0.3), hand(shake, 0.1)];
    const labelsNow = flipOrder ? [L, R] : [R, L];
    const result = selector.select(hands, labelsNow, 33 + i * 33);
    expect(result.key).toBe('side:Right');
    expect(result.landmarks[0].x).toBeCloseTo(0.3, 1);   // always the playing hand
  }
});

test('side lock: acquisition with two hands ignores motion (shaking hand cannot win)', () => {
  const selector = sideSelector();
  // Both hands appear together; the shaking one is further out at the edge.
  const r = selector.select([hand(0.92, 0.12), hand(0.45)], [L, R], 0);
  expect(r.key).toBe('side:Right');
  expect(r.index).toBe(1);
});

test('side lock: the locked hand disappearing never hands the game to the other hand', () => {
  const selector = sideSelector();
  selector.select([hand(0.3)], [R], 0);
  for (let t = 33; t < 3500; t += 33) {
    const result = selector.select([hand(0.8, 0.1)], [L], t);   // only the other hand visible
    expect(result.landmarks).toBeNull();
    expect(result.reason).toBe('blink');
  }
  // It comes back → same side, straight away.
  expect(selector.select([hand(0.8, 0.1), hand(0.32)], [L, R], 3600))
    .toMatchObject({ key: 'side:Right', index: 1, reason: 'ok' });
});

test('side lock: a one-frame label swap does not jump to the other hand', () => {
  const selector = sideSelector();
  selector.select([hand(0.3), hand(0.75)], [R, L], 0);
  // MediaPipe swaps the labels for one frame.
  const swapped = selector.select([hand(0.3), hand(0.75)], [L, R], 33);
  expect(swapped.landmarks[0].x).toBeCloseTo(0.3, 2);
  // A single mislabelled frame while alone is also still the same hand.
  const alone = selector.select([hand(0.31)], [L], 66);
  expect(alone.landmarks[0].x).toBeCloseTo(0.31, 2);
});

test('side lock: released only after a long absence or reset, then the new first hand wins', () => {
  const selector = sideSelector();
  selector.select([hand(0.3)], [R], 0);
  for (let t = 33; t <= 4100; t += 33) selector.select([hand(0.8)], [L], t);
  expect(selector.select([hand(0.8)], [L], 4200)).toMatchObject({ key: 'side:Left', reason: 'ok' });

  selector.reset();
  expect(selector.select([hand(0.3)], [R], 5000).key).toBe('side:Right');
});
