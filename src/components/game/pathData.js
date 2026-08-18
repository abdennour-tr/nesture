// ─────────────────────────────────────────────────────────────
// pathData.js — SVG path data for the PathTracer game
// ─────────────────────────────────────────────────────────────

// ========================  EASY PATHS  ========================
// Simple geometric shapes, centered in 400×400 viewBox

export const EASY_PATHS = [
  {
    id: 'circle',
    name: 'Cercle',
    icon: '⭕',
    svgPath:
      'M 200,50 ' +
      'A 150,150 0 1,1 199.99,50 Z',
    viewBox: { width: 400, height: 400 },
    estimatedTime: 8,
  },
  {
    id: 'square',
    name: 'Carré',
    icon: '⬜',
    svgPath:
      'M 75,75 L 325,75 L 325,325 L 75,325 Z',
    viewBox: { width: 400, height: 400 },
    estimatedTime: 7,
  },
  {
    id: 'triangle',
    name: 'Triangle',
    icon: '🔺',
    svgPath:
      'M 200,50 L 370,330 L 30,330 Z',
    viewBox: { width: 400, height: 400 },
    estimatedTime: 6,
  },
  {
    id: 'star',
    name: 'Étoile',
    icon: '⭐',
    // 5-pointed star outline (non-self-intersecting), traced clockwise
    svgPath:
      'M 200,40 ' +
      'L 224,150 L 338,150 L 246,214 ' +
      'L 278,330 L 200,260 ' +
      'L 122,330 L 154,214 ' +
      'L 62,150 L 176,150 Z',
    viewBox: { width: 400, height: 400 },
    estimatedTime: 12,
  },
  {
    id: 'heart',
    name: 'Cœur',
    icon: '❤️',
    svgPath:
      'M 200,340 ' +
      'C 100,280 20,200 20,140 ' +
      'C 20,80 70,40 120,40 ' +
      'C 160,40 190,60 200,100 ' +
      'C 210,60 240,40 280,40 ' +
      'C 330,40 380,80 380,140 ' +
      'C 380,200 300,280 200,340 Z',
    viewBox: { width: 400, height: 400 },
    estimatedTime: 10,
  },
];

// ========================  MEDIUM PATHS  ========================
// Letters & numbers as single-stroke traceable paths

export const MEDIUM_PATHS = [
  {
    id: 'letter-a',
    name: 'Lettre A',
    icon: '🅰️',
    // Single stroke: left leg → right leg, then crossbar
    svgPath:
      'M 80,350 L 200,50 L 320,350 ' +
      'M 140,220 L 260,220',
    viewBox: { width: 400, height: 400 },
    estimatedTime: 8,
  },
  {
    id: 'letter-b',
    name: 'Lettre B',
    icon: '🇧',
    svgPath:
      'M 100,50 L 100,350 ' +
      'L 250,350 ' +
      'C 330,350 330,260 250,220 ' +
      'L 100,220 ' +
      'L 250,220 ' +
      'C 330,220 330,120 250,50 ' +
      'L 100,50',
    viewBox: { width: 400, height: 400 },
    estimatedTime: 10,
  },
  {
    id: 'letter-s',
    name: 'Lettre S',
    icon: '🇸',
    svgPath:
      'M 300,100 ' +
      'C 300,30 100,30 100,100 ' +
      'C 100,170 300,180 300,260 ' +
      'C 300,340 100,340 100,300',
    viewBox: { width: 400, height: 400 },
    estimatedTime: 9,
  },
  {
    id: 'number-2',
    name: 'Chiffre 2',
    icon: '2️⃣',
    svgPath:
      'M 100,130 ' +
      'C 100,40 300,40 300,130 ' +
      'C 300,200 100,280 100,350 ' +
      'L 300,350',
    viewBox: { width: 400, height: 400 },
    estimatedTime: 8,
  },
  {
    id: 'number-8',
    name: 'Chiffre 8',
    icon: '8️⃣',
    // Figure-eight: top circle then bottom circle
    svgPath:
      'M 200,200 ' +
      'C 120,200 100,140 100,120 ' +
      'C 100,70 140,40 200,40 ' +
      'C 260,40 300,70 300,120 ' +
      'C 300,140 280,200 200,200 ' +
      'C 120,200 100,260 100,290 ' +
      'C 100,340 140,370 200,370 ' +
      'C 260,370 300,340 300,290 ' +
      'C 300,260 280,200 200,200',
    viewBox: { width: 400, height: 400 },
    estimatedTime: 12,
  },
  {
    id: 'letter-z',
    name: 'Lettre Z',
    icon: '🇿',
    svgPath:
      'M 100,80 L 300,80 L 100,320 L 300,320',
    viewBox: { width: 400, height: 400 },
    estimatedTime: 6,
  },
];

// ========================  HARD PATHS  ========================
// Complex patterns

export const HARD_PATHS = [
  {
    id: 'spiral',
    name: 'Spirale',
    icon: '🌀',
    // Archimedean spiral — 3 full turns, built from arcs
    svgPath:
      'M 200,200 ' +
      // Turn 1
      'A 15,15 0 0,1 230,200 ' +
      'A 30,30 0 0,1 170,200 ' +
      // Turn 2
      'A 45,45 0 0,1 245,200 ' +
      'A 60,60 0 0,1 140,200 ' +
      // Turn 3
      'A 75,75 0 0,1 275,200 ' +
      'A 90,90 0 0,1 110,200 ' +
      // extra outward sweep
      'A 105,105 0 0,1 305,200',
    viewBox: { width: 400, height: 400 },
    estimatedTime: 18,
  },
  {
    id: 'figure-8',
    name: 'Infini',
    icon: '♾️',
    // Lemniscate / infinity symbol
    svgPath:
      'M 200,200 ' +
      'C 200,120 320,80 340,160 ' +
      'C 360,240 260,300 200,200 ' +
      'C 140,100 40,160 60,240 ' +
      'C 80,320 200,280 200,200',
    viewBox: { width: 400, height: 400 },
    estimatedTime: 14,
  },
  {
    id: 'wave',
    name: 'Vague',
    icon: '🌊',
    // Sinusoidal wave — 3 periods across the viewBox
    svgPath:
      'M 20,200 ' +
      'C 40,100 80,100 110,200 ' +
      'C 140,300 170,300 200,200 ' +
      'C 230,100 260,100 290,200 ' +
      'C 320,300 350,300 380,200',
    viewBox: { width: 400, height: 400 },
    estimatedTime: 10,
  },
  {
    id: 'zigzag-maze',
    name: 'Labyrinthe Zigzag',
    icon: '⚡',
    // Complex angular zigzag path
    svgPath:
      'M 40,60 L 360,60 L 360,120 L 80,120 ' +
      'L 80,180 L 320,180 L 320,240 L 80,240 ' +
      'L 80,300 L 360,300 L 360,360 L 40,360',
    viewBox: { width: 400, height: 400 },
    estimatedTime: 16,
  },
  {
    id: 'cursive-a',
    name: 'Cursif a',
    icon: '🖊️',
    // Cursive lowercase 'a'
    svgPath:
      'M 280,140 ' +
      'C 280,80 180,60 140,120 ' +
      'C 100,180 120,300 200,300 ' +
      'C 260,300 280,240 280,200 ' +
      'L 280,140 L 280,300 ' +
      'C 290,340 310,350 330,340',
    viewBox: { width: 400, height: 400 },
    estimatedTime: 14,
  },
];

// ========================  ALL_PATHS  ========================

export const ALL_PATHS = {
  easy: EASY_PATHS,
  medium: MEDIUM_PATHS,
  hard: HARD_PATHS,
};

// ========================  DIFFICULTY CONFIG  ========================

export const DIFFICULTY_CONFIG = {
  easy: {
    tolerance: 40,
    guideSpeed: 0.3,
    label: 'Facile',
    emoji: '🌟',
    color: '#10B981',
    pathCount: 5,
  },
  medium: {
    tolerance: 25,
    guideSpeed: 0.5,
    label: 'Moyen',
    emoji: '🔥',
    color: '#E8841A',
    pathCount: 5,
  },
  hard: {
    tolerance: 15,
    guideSpeed: 0.7,
    label: 'Difficile',
    emoji: '🚀',
    color: '#EF4444',
    pathCount: 5,
  },
};

// ========================  UTILITIES  ========================

/**
 * Sample `numPoints` evenly-spaced { x, y } points along an SVG path string.
 *
 * Works in the browser by creating a temporary <svg>/<path> via
 * `document.createElementNS`, then using `getTotalLength()` and
 * `getPointAtLength()`.
 *
 * @param {string} svgPathString  The `d` attribute of an SVG <path>.
 * @param {number} numPoints      How many sample points (default 100).
 * @returns {{ x: number, y: number }[]}
 */
export function samplePathPoints(svgPathString, numPoints = 100) {
  const NS = 'http://www.w3.org/2000/svg';

  // We need a real <svg> in the DOM so the path geometry is computed.
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  svg.style.visibility = 'hidden';
  svg.style.pointerEvents = 'none';

  const pathEl = document.createElementNS(NS, 'path');
  pathEl.setAttribute('d', svgPathString);
  svg.appendChild(pathEl);
  document.body.appendChild(svg);

  const totalLength = pathEl.getTotalLength();
  const points = [];

  for (let i = 0; i < numPoints; i++) {
    const distance = (i / (numPoints - 1)) * totalLength;
    const pt = pathEl.getPointAtLength(distance);
    points.push({ x: pt.x, y: pt.y });
  }

  document.body.removeChild(svg);

  return points;
}

/**
 * Fisher-Yates shuffle (in-place).
 * @param {any[]} array
 * @returns {any[]} The same array, shuffled.
 */
function fisherYatesShuffle(array) {
  const arr = [...array]; // work on a copy
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Return `count` randomly-selected paths for the given difficulty.
 *
 * @param {'easy' | 'medium' | 'hard'} difficulty
 * @param {number} count  How many paths to return (default 5).
 * @returns {object[]}
 */
export function getRandomPaths(difficulty, count = 5) {
  const pool = ALL_PATHS[difficulty];
  if (!pool) {
    console.warn(`[pathData] Unknown difficulty "${difficulty}", falling back to easy.`);
    return getRandomPaths('easy', count);
  }

  const shuffled = fisherYatesShuffle(pool);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}
