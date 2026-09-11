import { accuracyPercent, buildPlayerSummary, gameTrend, numberOrNull, performanceScore } from './playerData';

const session = (id, game, accuracy, day, extra = {}) => ({ id, game_name: game, accuracy_score: accuracy, start_time: `2026-09-${day}T10:00:00Z`, end_time: `2026-09-${day}T10:03:00Z`, duration_seconds: 180, difficulty: 'easy', ...extra });

test('keeps missing, invalid and zero scores distinct', () => {
  expect(accuracyPercent({})).toBeNull();
  expect(accuracyPercent({ accuracy_score: 0 })).toBe(0);
  expect(accuracyPercent({ accuracy_score: '0', accuracy_recorded: false })).toBeNull();
  expect(accuracyPercent({ accuracy_score: '0.84' })).toBe(84);
  expect(accuracyPercent({ accuracy_score: 84 })).toBe(84);
  expect(accuracyPercent({ accuracy_score: 150 })).toBeNull();
  expect(numberOrNull('bad')).toBeNull();
  expect(numberOrNull(false)).toBeNull();
  expect(performanceScore({ notes: '{bad' })).toBeNull();
  expect(performanceScore({ notes: { score: 900 } })).toBeNull();
  expect(performanceScore({ notes: '{"performanceScore":0}' })).toBe(0);
});

test('does not substitute a composite Ladybug score for accuracy', () => {
  expect(accuracyPercent({ game_name: 'Follow the Ladybug', accuracy_score: .6, notes: { performanceScore: 80 } })).toBe(60);
});

test('sorts sessions, isolates games and excludes unfinished sessions from progress', () => {
  const input = [session('old', 'LetterQuest', .5, '01'), session('new', 'LetterQuest', .9, '04'), session('coin', 'Pinch the Coin', 0, '03'), session('unfinished', 'Pop the Bubble', 1, '05', { end_time: null })];
  const summary = buildPlayerSummary(input);
  expect(summary.ordered[0].id).toBe('unfinished');
  expect(input[0].id).toBe('old');
  expect(summary.completed).toHaveLength(3);
  expect(summary.explored).toBe(2);
  expect(summary.averageAccuracy).toBe(47);
  expect(summary.minutes).toBe(9);
  expect(summary.byGame.letterquest.latest.id).toBe('new');
  expect(summary.byGame.bubble.latest).toBeNull();
  expect(summary.byGame['pinch-coin'].bestAccuracy).toBe(0);
  expect(summary.targets.find(x => x.key === 'Palmar Grasp').count).toBe(3);
  expect(summary.targets.find(x => x.key === 'ATNR').count).toBe(2);
});

test('compares the latest two valid results at the same difficulty', () => {
  const rows = [session('a', 'LetterQuest', .8, '04'), session('b', 'LetterQuest', 1, '03', { difficulty: 'hard' }), session('c', 'LetterQuest', .6, '02')];
  expect(gameTrend(rows)).toBe(20);
  expect(gameTrend(rows.slice(0, 2))).toBeNull();
  expect(gameTrend([{ ...rows[0], difficulty: null }, rows[2]])).toBeNull();
});

test('empty history never invents progress', () => {
  const summary = buildPlayerSummary([]);
  expect(summary.explored).toBe(0);
  expect(summary.averageAccuracy).toBeNull();
  expect(summary.targets).toEqual([]);
});
