/**
 * fingerPianoLevels.js
 * ---------------------------------------------------------------------------
 * Single source of truth for Finger Piano's level tuning.
 *
 * The level-select cards used to be written by hand, separately from the game,
 * and had drifted into describing things the game does not do: "some visual
 * cues are hidden", "fast sequences and rhythm challenges", "time bonuses".
 * None of those exist. What actually changes between levels is the number of
 * fingers, the number of keys, how many notes the piece is, and how long the
 * child has to reach each one.
 *
 * Both the game and the level screen now read THESE numbers, so a card can no
 * longer promise something the round will not deliver. (Same reason
 * pinchCoinLevels.js exists: the coin-size cards had the same problem.)
 *
 * It is a separate module rather than an export from FingerPianoGame.jsx on
 * purpose — importing the game would pull MediaPipe and the whole 60KB engine
 * into the level screen's bundle just to read four numbers.
 */
/* ── The five fingers, exactly as the round shows them ─────────────────────
   In-game, a finger is a NUMBERED COLOURED DOT (1–5) — the same dot appears in
   the "Use these fingers" legend, on the lit key and in the end-of-round table.
   The level cards used to show emoji instead (👍 ✌️ 💍 🤙), which read as hand
   SHAPES to make — that is Magic Finger Copy's rule, not this game's. Finger
   Piano asks the child to bend ONE finger while the others stay lifted, so the
   card now shows the very dot the child will look for on screen.
   The landmark indices (tip/pip/mcp) stay in the game file: they are detection
   detail, and the level screen must not pull them in. */
export const PIANO_FINGERS = [
  { key: 'thumb',  n: 1, label: 'Thumb',  color: '#4ADE80' },
  { key: 'index',  n: 2, label: 'Index',  color: '#38BDF8' },
  { key: 'middle', n: 3, label: 'Middle', color: '#FB923C' },
  { key: 'ring',   n: 4, label: 'Ring',   color: '#F472B6' },
  { key: 'little', n: 5, label: 'Little', color: '#A78BFA' },
];

export const PIANO_FINGER_BY_KEY = Object.fromEntries(
  PIANO_FINGERS.map((f) => [f.key, f])
);

export const PIANO_LEVELS = {
  1: {
    id: 1, key: 'easy', label: 'Beginner', emoji: '🌱', color: '#10B981',
    fingers: ['thumb', 'index', 'middle'],
    whiteKeys: 5,
    notes: 20,
    timeoutMs: 6000,   // time allowed to reach each lit key
    restMs: 550,       // pause between notes
  },
  2: {
    id: 2, key: 'medium', label: 'Intermediate', emoji: '⚡', color: '#E8841A',
    fingers: ['thumb', 'index', 'middle', 'ring', 'little'],
    whiteKeys: 7,
    notes: 30,
    timeoutMs: 4500,
    restMs: 420,
  },
  3: {
    id: 3, key: 'hard', label: 'Expert', emoji: '🔥', color: '#EF4444',
    fingers: ['thumb', 'index', 'middle', 'ring', 'little'],
    whiteKeys: 10,
    notes: 40,
    timeoutMs: 3200,
    restMs: 300,
  },
};

export const PIANO_LEVEL_BY_KEY = {
  easy: PIANO_LEVELS[1],
  medium: PIANO_LEVELS[2],
  hard: PIANO_LEVELS[3],
};

/* NOTE on `whiteKeys`: the keyboard also draws the black keys that fall between
   them, but the round only ever asks for a WHITE key (see buildQueue in
   FingerPianoGame.jsx). The cards say "white keys" for that reason — saying
   "5 keys" under a keyboard showing 8 was the kind of small untruth this file
   exists to prevent. */

/** Seconds allowed to reach each lit key, for display. */
export function secondsPerNote(levelKey) {
  const lvl = PIANO_LEVEL_BY_KEY[levelKey] || PIANO_LEVELS[1];
  return (lvl.timeoutMs / 1000).toFixed(1).replace(/\.0$/, '');
}
