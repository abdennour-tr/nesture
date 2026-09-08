import { advanceHandMotion } from './pointerMotion';

const state = (x = 0) => ({ x, y: 0, scale: 0.5, on: 1, updatedAt: 0 });

test('render interpolation is invariant across display refresh rates', () => {
  const positions = [30, 60, 120].map((fps) => {
    const shown = state();
    const target = state(100);
    for (let frame = 1; frame <= fps / 10; frame++) advanceHandMotion(target, shown, frame * 1000 / fps);
    return shown.x;
  });
  expect(positions[0]).toBeCloseTo(positions[1], 8);
  expect(positions[1]).toBeCloseTo(positions[2], 8);
  expect(positions[0]).toBeGreaterThan(99);
});

test('interpolates between camera frames without overshooting at direction changes', () => {
  const shown = state();
  const target = state(100);
  advanceHandMotion(target, shown, 16);
  const first = shown.x;
  advanceHandMotion(target, shown, 32);
  expect(shown.x).toBeGreaterThan(first);
  expect(shown.x).toBeLessThan(100);
  target.x = 0;
  advanceHandMotion(target, shown, 48);
  expect(shown.x).toBeGreaterThan(0);
  expect(shown.x).toBeLessThan(first);
});

test('new/hidden hands appear at their fingertip, without travelling across targets', () => {
  const shown = { ...state(0), on: 0 };
  const target = state(400);
  expect(advanceHandMotion(target, shown, 16).x).toBe(400);
  target.x = 200;
  target.snap = true;
  expect(advanceHandMotion(target, shown, 32).x).toBe(200);
  expect(target.snap).toBe(false);
});
