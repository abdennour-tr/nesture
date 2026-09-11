import { aggregateWindows } from './useGraspMeasure';

/* The aggregation is the part that can quietly invent a finding, so it is the
   part that is tested: an unobserved reflex must come back as "not measured",
   never as a score of zero (which reads as "settled" — a clean bill of health
   nobody earned). */

test('no windows at all is not measured, never a score of zero', () => {
  const r = aggregateWindows([]);
  expect(r.score).toBeNull();
  expect(r.measured).toBe(false);
  expect(r.label).toBe('not_measured');
});

test('windows that carried no usable data are not measured', () => {
  const r = aggregateWindows([{ score: null, confidence: 0 }, { score: null, confidence: 0 }]);
  expect(r.score).toBeNull();
  expect(r.measured).toBe(false);
});

test('a single clean window is reported as it stands', () => {
  const r = aggregateWindows([{ score: 72, confidence: 0.5 }]);
  expect(r.score).toBe(72);
  expect(r.label).toBe('strong');
  expect(r.measured).toBe(true);
});

test('windows are weighted by confidence rather than averaged flat', () => {
  // A flat mean would be 50; weighting by confidence gives 82.
  expect(aggregateWindows([
    { score: 90, confidence: 0.9 },
    { score: 10, confidence: 0.1 },
  ]).score).toBe(82);
});

test('a barely-visible window cannot drag a clean session', () => {
  expect(aggregateWindows([
    { score: 20, confidence: 0.9 },
    { score: 100, confidence: 0.02 },
  ]).score).toBeLessThanOrEqual(25);
});

test('label thresholds match the detectors', () => {
  const label = (s) => aggregateWindows([{ score: s, confidence: 1 }]).label;
  expect(label(70)).toBe('strong');
  expect(label(50)).toBe('moderate');
  expect(label(25)).toBe('weak');
  expect(label(5)).toBe('none');
});

test('unmeasured windows are skipped, not counted as zero', () => {
  const r = aggregateWindows([
    { score: 80, confidence: 0.8 },
    { score: null, confidence: 0 },
    { score: 80, confidence: 0.8 },
  ]);
  expect(r.score).toBe(80);
  expect(r.detail.windows_analyzed).toBe(2);
  expect(r.detail.windows_total).toBe(3);
});
