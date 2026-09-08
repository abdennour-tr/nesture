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
