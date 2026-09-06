/**
 * traceTypeWords.js
 * ---------------------------------------------------------------------------
 * The word-based round model for Trace → Find → Type.
 *
 * Client feedback (this is the product owner's original intent):
 *
 *   "Type shows the letter 3 times - why is that? … say a word like BUS is
 *    presented where the learner will first start with left with tracing B,
 *    then finding B in the middle in the keyboard and then typing B in the
 *    right hand side; … then they will start with tracing U … and so on. So by
 *    the end of this 1 round they have traced, found and typed all 3 letters
 *    and formed a complete word BUS."
 *
 * So a ROUND = one word. A STEP = one letter, and each letter runs through the
 * three phases in order: trace → find → type. The word being built stays
 * visible the whole time, filling in letter by letter.
 *
 * The old behaviour (same letter typed three times) is removed.
 */

export const PHASES = ['trace', 'find', 'type'];

/** Words are chosen so Easy uses mostly straight-line letters. */
export const WORD_SETS = {
  easy:   ['BUS', 'CAT', 'HAT', 'TEN', 'FIX', 'LIT', 'VET', 'EEL'],
  medium: ['MOON', 'BOAT', 'FISH', 'DUCK', 'STAR', 'CAKE', 'BIRD', 'TREE'],
  hard:   ['QUEEN', 'JUICE', 'GRASS', 'WHALE', 'BRUSH', 'ZEBRA', 'SNAKE'],
};

/**
 * Build the ordered step list for one round.
 * @returns {{word:string, steps:Array<{index:number,letter:string,phase:string}>}}
 */
export function buildRound(levelKey, previousWord = null) {
  const pool = WORD_SETS[levelKey] || WORD_SETS.easy;
  const choices = pool.filter((w) => w !== previousWord);
  const word = choices[Math.floor(Math.random() * choices.length)];

  const steps = [];
  word.split('').forEach((letter, index) => {
    PHASES.forEach((phase) => steps.push({ index, letter, phase }));
  });

  return { word, steps };
}

/** Progress label shown in the HUD, e.g. "Letter 2 of 3 — Find". */
export function stepLabel(step, word) {
  if (!step) return '';
  const phaseName = { trace: 'Trace', find: 'Find', type: 'Type' }[step.phase];
  return `Letter ${step.index + 1} of ${word.length} — ${phaseName} “${step.letter}”`;
}

/* ── Tracing difficulty ──────────────────────────────────────────────────
   Client feedback (round 1): "i struggled with the tracing in air... very
   tricky even with easy level! so had to use the mouse throughout".
   Client feedback (round 2): "le lettre est terminé même si je ne touche pas
   tous les points" — the letter completed without touching every dot.

   The second one was caused by a `coverage` shortcut added for the first: it
   accepted a letter once ~62% of its waypoints were reached and auto-filled
   the rest. That is gone. EVERY waypoint must now be touched, in order.

   Forgiveness comes from two honest dials instead:

     spacing    how far apart the dots are along a stroke. Bigger = fewer dots
                = an easier letter, without ever letting the child skip part of
                the shape. (See letterStrokes.js — the dots are generated from
                the letter's path at this spacing, so straight strokes are as
                densely sampled as curved ones. They were not before: X had 4
                dots with 284px gaps in a 300px box.)
     tolerance  how close the fingertip must come to the next dot.

   INVARIANT: tolerance must stay below the smallest gap between two dots,
   otherwise one touch satisfies two of them and part of the letter is skipped
   again. letterStrokes.js guarantees every gap is at least 0.6 x spacing, so
   tolerance is set at 0.55 x spacing. Verified gaps at these settings:

       easy    spacing 72  tolerance 40   gaps 48-74px   ~12 dots/letter
       medium  spacing 56  tolerance 31   gaps 37-60px   ~14 dots/letter
       hard    spacing 44  tolerance 24   gaps 30-44px   ~17 dots/letter          */
export const TRACE_TUNING = {
  easy:   { spacing: 72, tolerance: 40, snap: true,  strokeWidth: 26, showArrows: true,  showGuideDot: true,  smoothing: 0.28 },
  medium: { spacing: 56, tolerance: 31, snap: true,  strokeWidth: 20, showArrows: true,  showGuideDot: true,  smoothing: 0.34 },
  hard:   { spacing: 44, tolerance: 24, snap: false, strokeWidth: 14, showArrows: false, showGuideDot: false, smoothing: 0.42 },
};

export function traceTuning(levelKey) {
  return TRACE_TUNING[levelKey] || TRACE_TUNING.easy;
}
