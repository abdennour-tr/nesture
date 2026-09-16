/**
 * A key's number, colour, note and finger never change.
 * Left-hand keys 1–5 (screen-left) are introduced first; right-hand keys 6–10
 * (screen-right) join later — so each hand plays the keys on its own side.
 */
export const PIANO_FINGERS = [
  { key: 'thumb', n: 1, label: 'Thumb', color: '#4ADE80' },
  { key: 'index', n: 2, label: 'Index', color: '#38BDF8' },
  { key: 'middle', n: 3, label: 'Middle', color: '#FB923C' },
  { key: 'ring', n: 4, label: 'Ring', color: '#F472B6' },
  { key: 'little', n: 5, label: 'Little', color: '#A78BFA' },
];
export const PIANO_FINGER_BY_KEY = Object.fromEntries(PIANO_FINGERS.map(f => [f.key, f]));

const NOTES = [
  ['C4', 60], ['D4', 62], ['E4', 64], ['F4', 65], ['G4', 67],
  ['A4', 69], ['B4', 71], ['C5', 72], ['D5', 74], ['E5', 76],
];
const COLORS = [...PIANO_FINGERS.map(f => f.color), '#2DD4BF', '#FACC15', '#FB7185', '#818CF8', '#E879F9'];
export const PIANO_KEYS = NOTES.map(([name, midi], i) => {
  const finger = PIANO_FINGERS[i % 5];
  const hand = i < 5 ? 'left' : 'right';
  return {
    id: hand + '-' + finger.key, i, n: i + 1, name, midi,
    fingerKey: finger.key, hand, color: COLORS[i],
    label: (hand === 'right' ? 'Right' : 'Left') + ' ' + finger.label.toLowerCase(),
    fingerLabel: finger.label,
  };
});
export const PIANO_EASY_STAGES = [
  { id: 1, keys: 3, notes: 9, title: 'Your first three', hint: 'Left thumb, index and middle finger.' },
  { id: 2, keys: 5, notes: 15, title: 'All five fingers', hint: 'Your left ring and little finger join in.' },
  { id: 3, keys: 10, notes: 20, title: 'Two hands, one tune', hint: 'Keep both hands in view. Right-hand keys 6–10 are ready.' },
];
export const PIANO_LEVELS = {
  1: {
    id: 1, key: 'easy', label: 'Easy', emoji: '🌱', color: '#10B981',
    stages: PIANO_EASY_STAGES, notes: PIANO_EASY_STAGES.reduce((n, s) => n + s.notes, 0), restMs: 500,
  },
  2: {
    id: 2, key: 'medium', label: 'Medium', emoji: '⚡', color: '#E8841A',
    stages: [{ id: 1, keys: 5, notes: 30, title: 'Five-finger melody', hint: 'Play with all five fingers of your left hand.' }],
    notes: 30, restMs: 380,
  },
  3: {
    id: 3, key: 'hard', label: 'Hard', emoji: '🔥', color: '#EF4444',
    stages: [{ id: 1, keys: 10, notes: 40, title: 'Two-hand melody', hint: 'Alternate between your right and left hand.' }],
    notes: 40, restMs: 300,
  },
};
export const PIANO_LEVEL_BY_KEY = { easy: PIANO_LEVELS[1], medium: PIANO_LEVELS[2], hard: PIANO_LEVELS[3] };

/** Shuffled bags cover every available finger before repeating the bag. */
export function buildPianoQueue(config) {
  const queue = [];
  config.stages.forEach((stage, stageIndex) => {
    const pool = PIANO_KEYS.slice(0, stage.keys);
    let bag = [], previous = -1;
    for (let note = 0; note < stage.notes; note++) {
      if (!bag.length) {
        bag = [...pool];
        // Let Easy introduce newly unlocked keys once in a predictable order.
        if (!(config.key === 'easy' && note === 0)) {
          for (let i = bag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [bag[i], bag[j]] = [bag[j], bag[i]];
          }
        } else if (stageIndex > 0) {
          const oldCount = config.stages[stageIndex - 1].keys;
          bag = [...pool.slice(oldCount), ...pool.slice(0, oldCount)];
        }
        if (bag.length > 1 && bag[0].i === previous) [bag[0], bag[1]] = [bag[1], bag[0]];
      }
      const key = bag.shift();
      previous = key.i;
      queue.push({ ...key, keyIdx: key.i, stageIndex });
    }
  });
  return queue;
}
