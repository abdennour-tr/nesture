/**
 * gameShell.js
 * ---------------------------------------------------------------------------
 * The canonical vocabulary shared by EVERY Nesture mini-game.
 *
 * Client feedback (round 1) called out that the games "look like screens from
 * 2 different products". The root cause was that each game invented its own
 * level names, colours, control-mode wording and instruction flow. Everything
 * that must stay identical across games now lives here.
 *
 * If you add a game, import from this file — do not re-invent the constants.
 */

/* ── Difficulty is ALWAYS easy | medium | hard ───────────────────────────
   Some games historically used numeric levels (1/2/3) in their URL and in
   their internal config. We keep the numeric value for backwards
   compatibility but the learner only ever sees Easy / Medium / Hard. */
export const DIFFICULTIES = [
  { key: 'easy',   n: 1, label: 'Easy',   emoji: '🌱', color: 'var(--gs-easy)',   soft: 'var(--gs-easy-soft)' },
  { key: 'medium', n: 2, label: 'Medium', emoji: '⚡', color: 'var(--gs-medium)', soft: 'var(--gs-medium-soft)' },
  { key: 'hard',   n: 3, label: 'Hard',   emoji: '🔥', color: 'var(--gs-hard)',   soft: 'var(--gs-hard-soft)' },
];

export const DIFFICULTY_BY_KEY = Object.fromEntries(DIFFICULTIES.map((d) => [d.key, d]));

/** Accepts 'easy' | 'medium' | 'hard' | 1 | 2 | 3 | '1' … and normalises. */
export function normaliseLevel(value, fallback = 'easy') {
  if (value == null) return fallback;
  const v = String(value).toLowerCase().trim();
  if (DIFFICULTY_BY_KEY[v]) return v;
  const byNumber = DIFFICULTIES.find((d) => String(d.n) === v);
  return byNumber ? byNumber.key : fallback;
}

/** Numeric level for games whose engines still switch on 1 / 2 / 3. */
export function levelNumber(value) {
  return DIFFICULTY_BY_KEY[normaliseLevel(value)].n;
}

/* ── Control modes: one wording for the whole product ─────────────────────
   Feedback: "if i choose 'touch action' over 'camera', does it expect
   pinching on screen?" — the labels are now explicit about the device. */
export const INPUT_MODES = {
  camera: {
    key: 'camera',
    label: 'Camera (hand)',
    hint: 'Move your hand in the air in front of the camera.',
  },
  touch: {
    key: 'touch',
    label: 'Touch / Mouse',
    hint: 'Use your mouse on a laptop, or your finger on a touch screen. Both work the same way.',
  },
};

/* ── localStorage keys ───────────────────────────────────────────────────
   Instructions are auto-shown once per game, then available forever behind
   the "How to play" button. */
const SEEN_PREFIX = 'nesture.instructionsSeen.';

export function hasSeenInstructions(gameId) {
  try { return localStorage.getItem(SEEN_PREFIX + gameId) === '1'; }
  catch { return false; }
}
export function markInstructionsSeen(gameId) {
  try { localStorage.setItem(SEEN_PREFIX + gameId, '1'); } catch { /* private mode */ }
}
/** Settings → "Reset tutorials": every game will greet the learner again. */
export function resetAllInstructions() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(SEEN_PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

/* ── Theme ────────────────────────────────────────────────────────────────
   ONE theme for the whole product, dark by default.

   It used to be three independent switches: Trace → Find → Type kept its own
   `isLightMode` state, GameHUD and GameLevelSelect each kept their own copy of
   this value, and `applyStoredGameTheme()` was exported but never called — so
   `<html>` never carried the attribute at all and anything rendered through a
   portal (the End-game confirm) ignored the learner's choice entirely.

   Now: the value lives here, `subscribeGameTheme` lets every component follow
   it, and `applyStoredGameTheme()` runs once at startup so the attribute is on
   `<html>` before the first paint. */
const THEME_KEY = 'nesture.gameTheme';
const listeners = new Set();

/* Dark is the default because the reference design (Trace → Find → Type) is a
   dark UI and every other screen now matches it. Light is the opt-in: only an
   explicit 'light' in storage turns it on, so a missing, corrupt or
   unreadable value lands on dark rather than on a surprise. */
export function getGameTheme() {
  try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}

export function setGameTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode */ }
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-game-theme', next);
  }
  listeners.forEach((fn) => { try { fn(next); } catch { /* ignore */ } });
  return next;
}

export function toggleGameTheme() {
  return setGameTheme(getGameTheme() === 'dark' ? 'light' : 'dark');
}

/** Subscribe to theme changes; returns an unsubscribe function. */
export function subscribeGameTheme(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React hook: current theme + a toggle, kept in sync across every component. */
export function useGameThemeState(React) {
  const [theme, setTheme] = React.useState(getGameTheme);
  React.useEffect(() => subscribeGameTheme(setTheme), []);
  return [theme, toggleGameTheme];
}

/** Call once, as early as possible, so `<html>` carries the attribute. */
export function applyStoredGameTheme() {
  setGameTheme(getGameTheme());
}

/* ── Registry: title, emoji, accent + instructions for every game ─────────
   One place to edit copy, so the tone stays the same everywhere. */
export const GAMES = {
  ladybug: {
    id: 'ladybug',
    emoji: '🐞',
    title: 'Follow the Ladybug',
    route: '/play/ladybug-game',
    /* `accent` is now used only for small identity touches (the title pill and
       the rules badge). The page background is the same for every game — see
       the palette note in GameShell.css. */
    accent: ['#F97316', '#EA580C'],
    subtitle: 'Trace the moving bug with your index finger — stay on the path all the way to the leaf!',
    modes: ['camera', 'touch'],
    steps: [
      'Point your index finger at the ladybug.',
      'Move your hand so the pointer stays on top of her as she walks.',
      'Stay on the path — the closer you follow, the more points you earn.',
      'Reach the leaf to finish the round.',
    ],
  },
  bubble: {
    id: 'bubble',
    emoji: '🫧',
    title: 'Pop the Bubble',
    route: '/play/bubble-game',
    accent: ['#0EA5E9', '#0284C7'],
    subtitle: 'Point at the middle of each bubble — the closer to the centre you aim, the more points you earn!',
    modes: ['camera', 'touch'],
    steps: [
      'Raise ONE hand in front of the camera — keep the other one down.',
      'Your index fingertip becomes the pointer.',
      'Move the pointer onto a bubble to pop it.',
      'Aim for the middle of the bubble for bonus points.',
    ],
  },
  'pinch-coin': {
    id: 'pinch-coin',
    emoji: '🪙',
    title: 'Pinch the Coin',
    route: '/play/pinch-coin-game',
    accent: ['#F59E0B', '#D97706'],
    subtitle: 'Practise your pinch grip — pick up the golden coin and feed the piggy bank!',
    modes: ['camera', 'touch'],
    steps: [
      'Camera mode: bring your thumb and index finger together in the air to pinch the coin.',
      'Touch / Mouse mode: click and hold the coin with the mouse, or press and hold it with one finger on a touch screen — no pinch gesture needed.',
      'Keep holding and drag the coin across to the piggy bank.',
      'Let go over the piggy bank to drop the coin in.',
    ],
  },
  'finger-copy': {
    id: 'finger-copy',
    emoji: '🖐️',
    title: 'Magic Finger Copy',
    route: '/play/finger-copy-game',
    accent: ['#8B5CF6', '#7C3AED'],
    subtitle: 'Copy the hand shape you see on screen with your own hand.',
    modes: ['camera'],
    steps: [
      'Look at the hand shape shown on screen.',
      'Make the same shape with your own hand in front of the camera.',
      'Hold it still until the ring fills up.',
      'On Hard you copy a short sequence of shapes in order.',
    ],
  },
  'finger-piano': {
    id: 'finger-piano',
    emoji: '🎹',
    title: 'Finger Piano',
    route: '/play/finger-piano-game',
    accent: ['#EC4899', '#DB2777'],
    subtitle: 'Tap the lit key with the matching finger and play the tune.',
    modes: ['camera', 'touch'],
    steps: [
      'Hold your hand open in front of the camera.',
      'A key lights up on the piano at the top of the screen.',
      'The drawn hand below shows which finger to use — tap that finger in the air.',
      'Move only that finger; finish the tune to complete the round.',
    ],
  },
  'trace-type': {
    id: 'trace-type',
    emoji: '✏️',
    title: 'Trace → Find → Type',
    route: '/play/trace-type-game',
    accent: ['#22D3EE', '#0891B2'],
    subtitle: 'Build a whole word — trace a letter, find it on the keyboard, then type it.',
    modes: ['camera', 'touch'],
    steps: [
      'You get a word, for example BUS.',
      'Trace the first letter (B) — follow the dotted line with your finger or the mouse.',
      'Find that same letter on the keyboard in the middle.',
      'Type it on the right — then move on to the next letter until the word is complete.',
    ],
  },
  'path-trace': {
    id: 'path-trace',
    emoji: '✒️',
    title: 'Trace the Shape',
    route: '/play/path-game',
    accent: ['#6366F1', '#4F46E5'],
    subtitle: 'Follow the dotted outline from start to finish without leaving the line.',
    modes: ['camera', 'touch'],
    steps: [
      'A shape appears with a dotted outline and a green starting dot.',
      'Put your finger (or the mouse) on the green dot.',
      'Follow the outline all the way round — stay inside the band.',
      'Finish on the red dot to complete the shape.',
    ],
  },
  /* LetterQuest is the spelling game (GamePage.jsx, route /play/game), set up
     from the NesturePlay Options screen. This entry used to describe a map to
     travel with stops to unlock — a game that does not exist. It was never
     rendered, which is exactly why the invention survived; it is corrected here
     so nothing downstream repeats it. */
  letterquest: {
    id: 'letterquest',
    emoji: '🔤',
    title: 'LetterQuest',
    route: '/play/difficulty',
    accent: ['#1A8FA0', '#0D5E6B'],
    subtitle: 'Spell the word by picking its letters out of the keyboard, one at a time.',
    modes: ['camera', 'touch'],
    steps: [
      'A word appears at the top of the screen.',
      'Point at the letter you need and hold still — the ring fills, then the key is pressed.',
      'Keep going until the whole word is spelled.',
      'Pick a longer word list, a bigger keyboard or Self Expression from the options screen.',
    ],
  },
};

export function getGame(id) {
  return GAMES[id] || GAMES.bubble;
}
