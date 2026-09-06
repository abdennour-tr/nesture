import React from 'react';

/**
 * The hand pointer shared by the gesture games.
 *
 * The silhouette is a real hand: it was traced from a photograph, resampled and
 * smoothed, then normalised so the very tip of the index finger sits at the
 * local origin with the finger pointing along -y. A game therefore only has to
 * translate the pointer to the tracked fingertip and rotate it to the tracked
 * finger direction — the fingertip *is* the cursor.
 *
 * Usage:
 *   <svg …><HandDefs /><g ref={ref} className="hand-pointer"><HandArt /></g></svg>
 *
 * Pass `contrast` to HandArt when the pointer sits on a light background.
 *   const target = makeHandState(0.4);   // written by tracking
 *   const shown  = makeHandState(0.4);   // written by the animation loop
 *   requestAnimationFrame(() => followHand(target, shown, ref.current));
 *
 * `HandDefs` must appear once per document; several pointers can share it, even
 * from a different <svg> element.
 */

/* Rotation is the noisiest thing tracking gives us: the fingertip wobbles by a
   pixel or two and the angle it implies swings several degrees. This absorbs
   that — small changes are ignored outright, larger ones are damped — so the
   hand holds its heading instead of shivering. */
/* NOTE: no longer used for rendering — the pointer never rotates (see
   followHand). Kept exported because it is a generally useful angle-unwrap
   helper and is still imported by callers; safe to delete once they are gone. */
export function steadyAngle(current, raw) {
  let d = raw - current;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  if (Math.abs(d) < 4) return current;          // deadzone: hold still
  return current + d * 0.3;                     // damp what is left
}

/* Gradients, the wireframe clip and the forearm fade. Rendered once inside the
   trace SVG; every id is prefixed so it cannot collide with anything else on
   the page. Every paint is an attribute rather than a class, so the pointer
   still renders correctly even if the stylesheet is stale. */
/* Colour ramps. A game picks the one that reads on its own background: `neon`
   (cyan → magenta) for the dark canvases, `coral` (warm white → pink) for the
   bright blue underwater board where a cyan hand disappears into the water, and
   `violet` and `green` for the garden. Green needs the dark backing to stand
   off the grass — it is a lighter, colder green than the field, not a match
   for it.
   The gradient ids do not change, so nothing else has to know which is in use;
   two games are never on screen at once. */
const PALETTES = {
  neon: {
    line: [['0', '#B8FFF7'], ['.18', '#5EEAD4'], ['.45', '#7DD3FC'],
           ['.68', '#A78BFA'], ['1', '#F0ABFC']],
    body: [['0', '#67E8F9', '.26'], ['.5', '#818CF8', '.20'], ['1', '#D946EF', '.16']],
    tip:  [['0', '#F2FFFD', '1'], ['.35', '#8FFFF0', '.75'], ['1', '#22D3EE', '0']],
  },
  green: {
    line: [['0', '#FFFFFF'], ['.2', '#E4FFF4'], ['.5', '#86EFC7'],
           ['.78', '#22C55E'], ['1', '#0F766E']],
    body: [['0', '#DCFCE7', '.48'], ['.5', '#6EE7B7', '.38'], ['1', '#059669', '.30']],
    tip:  [['0', '#FFFFFF', '1'], ['.35', '#B6FFE0', '.8'], ['1', '#10B981', '0']],
  },
  violet: {
    line: [['0', '#FFFFFF'], ['.22', '#F7DCFF'], ['.55', '#DCBBFF'],
           ['.8', '#B57BF7'], ['1', '#8B5CF6']],
    body: [['0', '#FBEAFF', '.46'], ['.5', '#DDB8FF', '.38'], ['1', '#A855F7', '.30']],
    tip:  [['0', '#FFFFFF', '1'], ['.35', '#EBD3FF', '.8'], ['1', '#A855F7', '0']],
  },
  coral: {
    line: [['0', '#FFF6E0'], ['.18', '#FFD166'], ['.45', '#FFA94D'],
           ['.72', '#FF7A6B'], ['1', '#F062A6']],
    body: [['0', '#FFE9B0', '.42'], ['.5', '#FFB067', '.34'], ['1', '#F97392', '.28']],
    tip:  [['0', '#FFFDF5', '1'], ['.35', '#FFD98A', '.8'], ['1', '#FF8C42', '0']],
  },
};

export function HandDefs({ theme = 'neon' }) {
  const pal = PALETTES[theme] || PALETTES.neon;
  return (
    <defs>
      {/* one ramp across the whole hand: cyan at the fingertip, magenta at the
          wrist — userSpaceOnUse so the whole hand samples a single ramp */}
      <linearGradient id="ttWireG" gradientUnits="userSpaceOnUse" x1="-6" y1="-4" x2="20" y2="175">
        {pal.line.map(([o, c]) => <stop key={o} offset={o} stopColor={c} />)}
      </linearGradient>
      <linearGradient id="ttWireFill" gradientUnits="userSpaceOnUse" x1="-6" y1="-4" x2="20" y2="175">
        {pal.body.map(([o, c, a]) => <stop key={o} offset={o} stopColor={c} stopOpacity={a} />)}
      </linearGradient>
      {/* the forearm dissolves instead of ending in a hard cut */}
      <linearGradient id="ttWireFade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity="1" />
        <stop offset=".6" stopColor="#fff" stopOpacity="1" />
        <stop offset=".93" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <mask id="ttWireMask">
        <rect x="-30" y="-30" width="150" height="212" fill="url(#ttWireFade)" />
      </mask>
      {/* keeps the mesh inside the hand */}
      <clipPath id="ttWireClip">
        <path d="M1.18,0.40 Q2.36,0.80 3.23,1.72 Q4.10,2.65 4.54,3.82 Q4.97,4.99 5.17,6.28 Q5.36,7.57 5.51,8.89 Q5.66,10.20 5.79,11.52 Q5.93,12.84 6.07,14.16 Q6.21,15.48 6.24,16.80 Q6.27,18.13 6.24,19.43 Q6.21,20.74 6.24,22.06 Q6.27,23.39 6.24,24.69 Q6.21,26.00 6.24,27.32 Q6.26,28.64 6.29,29.97 Q6.32,31.29 6.41,32.64 Q6.49,33.98 6.69,35.27 Q6.89,36.56 7.05,37.87 Q7.22,39.18 7.33,40.50 Q7.45,41.83 7.48,43.16 Q7.51,44.48 7.54,45.81 Q7.56,47.13 7.59,48.46 Q7.62,49.78 7.59,51.09 Q7.56,52.39 7.59,53.72 Q7.62,55.04 7.59,56.35 Q7.56,57.65 7.65,59.00 Q7.73,60.34 7.98,61.60 Q8.23,62.87 8.54,64.10 Q8.85,65.34 9.43,66.44 Q10.02,67.54 11.16,68.03 Q12.31,68.52 13.50,68.22 Q14.69,67.91 15.64,67.02 Q16.58,66.12 17.62,65.41 Q18.66,64.71 19.85,64.29 Q21.03,63.88 22.34,63.87 Q23.66,63.87 24.86,64.22 Q26.05,64.58 27.14,65.22 Q28.24,65.87 29.00,66.85 Q29.77,67.82 30.13,69.03 Q30.49,70.24 31.30,71.18 Q32.12,72.13 33.35,72.10 Q34.58,72.08 35.66,71.45 Q36.73,70.81 37.88,70.34 Q39.04,69.87 40.35,69.90 Q41.65,69.93 42.84,70.30 Q44.02,70.68 45.09,71.41 Q46.16,72.14 46.82,73.20 Q47.48,74.26 47.81,75.48 Q48.15,76.71 49.05,77.58 Q49.95,78.46 51.23,78.44 Q52.50,78.42 53.74,78.11 Q54.98,77.81 56.20,78.07 Q57.43,78.33 58.51,79.00 Q59.60,79.66 60.43,80.62 Q61.26,81.58 61.68,82.76 Q62.11,83.93 62.14,85.26 Q62.17,86.58 62.08,87.87 Q61.99,89.15 61.88,90.43 Q61.77,91.71 61.65,92.98 Q61.52,94.25 61.20,95.46 Q60.88,96.67 60.56,97.87 Q60.24,99.08 59.87,100.26 Q59.49,101.45 59.23,102.68 Q58.97,103.90 58.76,105.15 Q58.56,106.39 58.32,107.63 Q58.09,108.86 57.86,110.10 Q57.63,111.34 57.39,112.57 Q57.15,113.81 56.92,115.04 Q56.69,116.28 56.41,117.50 Q56.14,118.72 55.84,119.93 Q55.54,121.14 55.21,122.35 Q54.87,123.55 54.48,124.73 Q54.08,125.91 53.68,127.09 Q53.27,128.26 52.76,129.40 Q52.24,130.54 51.71,131.68 Q51.18,132.81 50.63,133.94 Q50.08,135.06 49.56,136.20 Q49.04,137.34 48.57,138.50 Q48.10,139.65 47.78,140.86 Q47.46,142.06 47.38,143.35 Q47.29,144.63 47.43,145.95 Q47.57,147.27 47.82,148.53 Q48.07,149.80 48.27,151.09 Q48.47,152.38 48.49,153.70 Q48.52,155.03 48.55,156.35 Q48.58,157.68 48.67,159.02 Q48.75,160.36 48.89,161.68 Q49.04,163.00 49.18,164.32 Q49.32,165.63 49.51,166.92 Q49.71,168.22 49.96,169.48 Q50.21,170.74 50.41,172.03 Q50.61,173.32 50.80,174.61 Q51.00,175.90 51.25,177.17 Q51.50,178.43 51.70,179.72 Q51.89,181.01 52.14,182.28 Q52.40,183.54 52.65,184.80 Q52.90,186.07 53.15,187.33 Q53.40,188.59 53.65,189.86 Q53.90,191.12 54.15,192.38 Q54.41,193.65 54.67,194.90 Q54.94,196.16 55.25,197.39 Q55.56,198.62 55.25,199.42 Q54.93,200.21 53.58,200.29 Q52.24,200.38 50.89,200.47 Q49.55,200.55 48.20,200.64 Q46.86,200.73 45.52,200.81 Q44.17,200.90 42.83,200.99 Q41.48,201.07 40.14,201.16 Q38.79,201.24 37.45,201.33 Q36.10,201.42 34.76,201.50 Q33.42,201.59 32.07,201.68 Q30.73,201.76 29.38,201.85 Q28.04,201.93 26.69,202.02 Q25.35,202.11 24.00,202.19 Q22.66,202.28 21.31,202.37 Q19.97,202.45 18.63,202.54 Q17.28,202.63 16.58,201.95 Q15.87,201.27 15.61,200.01 Q15.35,198.76 15.05,197.51 Q14.76,196.27 14.51,195.01 Q14.25,193.74 13.95,192.51 Q13.64,191.27 13.34,190.03 Q13.03,188.80 12.71,187.57 Q12.38,186.34 12.04,185.12 Q11.70,183.91 11.38,182.68 Q11.06,181.45 10.67,180.25 Q10.28,179.06 9.90,177.85 Q9.53,176.65 9.12,175.46 Q8.72,174.27 8.35,173.07 Q7.97,171.87 7.56,170.68 Q7.14,169.50 6.68,168.34 Q6.23,167.18 5.80,166.00 Q5.37,164.83 4.94,163.65 Q4.51,162.47 4.11,161.29 Q3.70,160.10 3.39,158.86 Q3.09,157.62 2.89,156.33 Q2.70,155.04 2.50,153.75 Q2.30,152.46 2.11,151.17 Q1.91,149.88 1.55,148.67 Q1.19,147.46 0.61,146.36 Q0.03,145.26 -0.69,144.23 Q-1.41,143.19 -2.38,142.28 Q-3.36,141.38 -4.40,140.57 Q-5.44,139.76 -6.37,138.83 Q-7.31,137.90 -8.14,136.93 Q-8.97,135.95 -9.69,134.92 Q-10.42,133.89 -11.08,132.83 Q-11.74,131.76 -12.44,130.72 Q-13.14,129.68 -13.82,128.62 Q-14.50,127.57 -15.18,126.52 Q-15.87,125.47 -16.53,124.41 Q-17.19,123.35 -17.86,122.29 Q-18.53,121.23 -19.15,120.15 Q-19.76,119.06 -20.31,117.94 Q-20.85,116.82 -21.01,115.55 Q-21.18,114.27 -20.98,113.02 Q-20.79,111.77 -20.72,110.48 Q-20.65,109.19 -20.28,108.00 Q-19.91,106.81 -19.24,105.73 Q-18.57,104.64 -17.70,103.65 Q-16.83,102.67 -16.02,101.63 Q-15.21,100.59 -14.53,99.51 Q-13.85,98.42 -13.33,97.29 Q-12.81,96.15 -12.29,95.01 Q-11.77,93.87 -11.17,92.76 Q-10.56,91.65 -9.71,90.63 Q-8.86,89.60 -8.61,88.37 Q-8.36,87.15 -8.33,85.84 Q-8.30,84.54 -8.33,83.21 Q-8.35,81.89 -8.27,80.60 Q-8.18,79.32 -8.15,78.01 Q-8.12,76.71 -8.03,75.42 Q-7.94,74.14 -7.80,72.87 Q-7.65,71.60 -7.51,70.34 Q-7.36,69.07 -7.22,67.81 Q-7.07,66.54 -7.03,65.24 Q-6.98,63.94 -6.97,62.63 Q-6.95,61.32 -7.04,59.98 Q-7.13,58.63 -7.21,57.29 Q-7.30,55.94 -7.38,54.60 Q-7.47,53.26 -7.61,51.94 Q-7.75,50.62 -7.89,49.30 Q-8.04,47.99 -8.12,46.64 Q-8.21,45.30 -8.24,43.97 Q-8.27,42.65 -8.29,41.32 Q-8.32,40.00 -8.29,38.69 Q-8.26,37.39 -8.17,36.10 Q-8.09,34.82 -8.00,33.53 Q-7.91,32.25 -7.87,30.94 Q-7.84,29.64 -7.82,28.33 Q-7.79,27.03 -7.88,25.68 Q-7.97,24.34 -7.99,23.01 Q-8.02,21.69 -7.99,20.38 Q-7.96,19.08 -7.88,17.79 Q-7.79,16.51 -7.76,15.20 Q-7.73,13.90 -7.64,12.61 Q-7.55,11.33 -7.43,10.06 Q-7.30,8.79 -7.07,7.55 Q-6.83,6.31 -6.43,5.13 Q-6.04,3.96 -5.35,2.87 Q-4.67,1.79 -3.61,1.13 Q-2.54,0.47 -1.27,0.23 Q-0.00,0.00 1.18,0.40 Z" />
      </clipPath>
      <radialGradient id="ttWireTip">
        {pal.tip.map(([o, c, a]) => <stop key={o} offset={o} stopColor={c} stopOpacity={a} />)}
      </radialGradient>
      <radialGradient id="ttTargetG">
        <stop offset="0" stopColor="#fff" stopOpacity=".9" />
        <stop offset=".35" stopColor="#8B5CF6" stopOpacity=".55" />
        <stop offset="1" stopColor="#6366F1" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

/* The pointer: a holographic wireframe hand with the index finger extended and
   the very tip of that finger at the local origin, so the parent only has to
   translate to the tracked fingertip and rotate to the tracked finger
   direction.

   The silhouette is a real hand: it was traced from a photograph — the outline
   is resampled and smoothed, then normalised so the fingertip sits at the
   origin with the finger vertical. That is why it reads as a hand rather than
   as a diagram of one; it is not a shape drawn from primitives.

   Drawn with no SVG filters on purpose: the group's transform is rewritten on
   every animation frame and a blur filter would have to be re-rasterised each
   time. The glow is a wide faint stroke under a crisp one instead. */
export function HandArt({ contrast = false }) {
  const SIL = "M1.18,0.40 Q2.36,0.80 3.23,1.72 Q4.10,2.65 4.54,3.82 Q4.97,4.99 5.17,6.28 Q5.36,7.57 5.51,8.89 Q5.66,10.20 5.79,11.52 Q5.93,12.84 6.07,14.16 Q6.21,15.48 6.24,16.80 Q6.27,18.13 6.24,19.43 Q6.21,20.74 6.24,22.06 Q6.27,23.39 6.24,24.69 Q6.21,26.00 6.24,27.32 Q6.26,28.64 6.29,29.97 Q6.32,31.29 6.41,32.64 Q6.49,33.98 6.69,35.27 Q6.89,36.56 7.05,37.87 Q7.22,39.18 7.33,40.50 Q7.45,41.83 7.48,43.16 Q7.51,44.48 7.54,45.81 Q7.56,47.13 7.59,48.46 Q7.62,49.78 7.59,51.09 Q7.56,52.39 7.59,53.72 Q7.62,55.04 7.59,56.35 Q7.56,57.65 7.65,59.00 Q7.73,60.34 7.98,61.60 Q8.23,62.87 8.54,64.10 Q8.85,65.34 9.43,66.44 Q10.02,67.54 11.16,68.03 Q12.31,68.52 13.50,68.22 Q14.69,67.91 15.64,67.02 Q16.58,66.12 17.62,65.41 Q18.66,64.71 19.85,64.29 Q21.03,63.88 22.34,63.87 Q23.66,63.87 24.86,64.22 Q26.05,64.58 27.14,65.22 Q28.24,65.87 29.00,66.85 Q29.77,67.82 30.13,69.03 Q30.49,70.24 31.30,71.18 Q32.12,72.13 33.35,72.10 Q34.58,72.08 35.66,71.45 Q36.73,70.81 37.88,70.34 Q39.04,69.87 40.35,69.90 Q41.65,69.93 42.84,70.30 Q44.02,70.68 45.09,71.41 Q46.16,72.14 46.82,73.20 Q47.48,74.26 47.81,75.48 Q48.15,76.71 49.05,77.58 Q49.95,78.46 51.23,78.44 Q52.50,78.42 53.74,78.11 Q54.98,77.81 56.20,78.07 Q57.43,78.33 58.51,79.00 Q59.60,79.66 60.43,80.62 Q61.26,81.58 61.68,82.76 Q62.11,83.93 62.14,85.26 Q62.17,86.58 62.08,87.87 Q61.99,89.15 61.88,90.43 Q61.77,91.71 61.65,92.98 Q61.52,94.25 61.20,95.46 Q60.88,96.67 60.56,97.87 Q60.24,99.08 59.87,100.26 Q59.49,101.45 59.23,102.68 Q58.97,103.90 58.76,105.15 Q58.56,106.39 58.32,107.63 Q58.09,108.86 57.86,110.10 Q57.63,111.34 57.39,112.57 Q57.15,113.81 56.92,115.04 Q56.69,116.28 56.41,117.50 Q56.14,118.72 55.84,119.93 Q55.54,121.14 55.21,122.35 Q54.87,123.55 54.48,124.73 Q54.08,125.91 53.68,127.09 Q53.27,128.26 52.76,129.40 Q52.24,130.54 51.71,131.68 Q51.18,132.81 50.63,133.94 Q50.08,135.06 49.56,136.20 Q49.04,137.34 48.57,138.50 Q48.10,139.65 47.78,140.86 Q47.46,142.06 47.38,143.35 Q47.29,144.63 47.43,145.95 Q47.57,147.27 47.82,148.53 Q48.07,149.80 48.27,151.09 Q48.47,152.38 48.49,153.70 Q48.52,155.03 48.55,156.35 Q48.58,157.68 48.67,159.02 Q48.75,160.36 48.89,161.68 Q49.04,163.00 49.18,164.32 Q49.32,165.63 49.51,166.92 Q49.71,168.22 49.96,169.48 Q50.21,170.74 50.41,172.03 Q50.61,173.32 50.80,174.61 Q51.00,175.90 51.25,177.17 Q51.50,178.43 51.70,179.72 Q51.89,181.01 52.14,182.28 Q52.40,183.54 52.65,184.80 Q52.90,186.07 53.15,187.33 Q53.40,188.59 53.65,189.86 Q53.90,191.12 54.15,192.38 Q54.41,193.65 54.67,194.90 Q54.94,196.16 55.25,197.39 Q55.56,198.62 55.25,199.42 Q54.93,200.21 53.58,200.29 Q52.24,200.38 50.89,200.47 Q49.55,200.55 48.20,200.64 Q46.86,200.73 45.52,200.81 Q44.17,200.90 42.83,200.99 Q41.48,201.07 40.14,201.16 Q38.79,201.24 37.45,201.33 Q36.10,201.42 34.76,201.50 Q33.42,201.59 32.07,201.68 Q30.73,201.76 29.38,201.85 Q28.04,201.93 26.69,202.02 Q25.35,202.11 24.00,202.19 Q22.66,202.28 21.31,202.37 Q19.97,202.45 18.63,202.54 Q17.28,202.63 16.58,201.95 Q15.87,201.27 15.61,200.01 Q15.35,198.76 15.05,197.51 Q14.76,196.27 14.51,195.01 Q14.25,193.74 13.95,192.51 Q13.64,191.27 13.34,190.03 Q13.03,188.80 12.71,187.57 Q12.38,186.34 12.04,185.12 Q11.70,183.91 11.38,182.68 Q11.06,181.45 10.67,180.25 Q10.28,179.06 9.90,177.85 Q9.53,176.65 9.12,175.46 Q8.72,174.27 8.35,173.07 Q7.97,171.87 7.56,170.68 Q7.14,169.50 6.68,168.34 Q6.23,167.18 5.80,166.00 Q5.37,164.83 4.94,163.65 Q4.51,162.47 4.11,161.29 Q3.70,160.10 3.39,158.86 Q3.09,157.62 2.89,156.33 Q2.70,155.04 2.50,153.75 Q2.30,152.46 2.11,151.17 Q1.91,149.88 1.55,148.67 Q1.19,147.46 0.61,146.36 Q0.03,145.26 -0.69,144.23 Q-1.41,143.19 -2.38,142.28 Q-3.36,141.38 -4.40,140.57 Q-5.44,139.76 -6.37,138.83 Q-7.31,137.90 -8.14,136.93 Q-8.97,135.95 -9.69,134.92 Q-10.42,133.89 -11.08,132.83 Q-11.74,131.76 -12.44,130.72 Q-13.14,129.68 -13.82,128.62 Q-14.50,127.57 -15.18,126.52 Q-15.87,125.47 -16.53,124.41 Q-17.19,123.35 -17.86,122.29 Q-18.53,121.23 -19.15,120.15 Q-19.76,119.06 -20.31,117.94 Q-20.85,116.82 -21.01,115.55 Q-21.18,114.27 -20.98,113.02 Q-20.79,111.77 -20.72,110.48 Q-20.65,109.19 -20.28,108.00 Q-19.91,106.81 -19.24,105.73 Q-18.57,104.64 -17.70,103.65 Q-16.83,102.67 -16.02,101.63 Q-15.21,100.59 -14.53,99.51 Q-13.85,98.42 -13.33,97.29 Q-12.81,96.15 -12.29,95.01 Q-11.77,93.87 -11.17,92.76 Q-10.56,91.65 -9.71,90.63 Q-8.86,89.60 -8.61,88.37 Q-8.36,87.15 -8.33,85.84 Q-8.30,84.54 -8.33,83.21 Q-8.35,81.89 -8.27,80.60 Q-8.18,79.32 -8.15,78.01 Q-8.12,76.71 -8.03,75.42 Q-7.94,74.14 -7.80,72.87 Q-7.65,71.60 -7.51,70.34 Q-7.36,69.07 -7.22,67.81 Q-7.07,66.54 -7.03,65.24 Q-6.98,63.94 -6.97,62.63 Q-6.95,61.32 -7.04,59.98 Q-7.13,58.63 -7.21,57.29 Q-7.30,55.94 -7.38,54.60 Q-7.47,53.26 -7.61,51.94 Q-7.75,50.62 -7.89,49.30 Q-8.04,47.99 -8.12,46.64 Q-8.21,45.30 -8.24,43.97 Q-8.27,42.65 -8.29,41.32 Q-8.32,40.00 -8.29,38.69 Q-8.26,37.39 -8.17,36.10 Q-8.09,34.82 -8.00,33.53 Q-7.91,32.25 -7.87,30.94 Q-7.84,29.64 -7.82,28.33 Q-7.79,27.03 -7.88,25.68 Q-7.97,24.34 -7.99,23.01 Q-8.02,21.69 -7.99,20.38 Q-7.96,19.08 -7.88,17.79 Q-7.79,16.51 -7.76,15.20 Q-7.73,13.90 -7.64,12.61 Q-7.55,11.33 -7.43,10.06 Q-7.30,8.79 -7.07,7.55 Q-6.83,6.31 -6.43,5.13 Q-6.04,3.96 -5.35,2.87 Q-4.67,1.79 -3.61,1.13 Q-2.54,0.47 -1.27,0.23 Q-0.00,0.00 1.18,0.40 Z";
  return (
    <g mask="url(#ttWireMask)">
      {/* On a light background the neon lines have nothing to glow against, so
          `contrast` lays a dark body under them first. Games on a dark canvas
          leave it off and keep the pointer fully translucent. */}
      {contrast && (
        <path
          d={SIL}
          fill="#0D2A4A" fillOpacity=".42"
          stroke="#0D2A4A" strokeOpacity=".62" strokeWidth="8" strokeLinejoin="round"
        />
      )}
      {/* translucent volume */}
      <path d={SIL} fill="url(#ttWireFill)" />
      <g clipPath="url(#ttWireClip)">
        {/* wireframe mesh */}
        <path d="M-14,0 Q34,7 84,0 M-14,11 Q34,18 84,11 M-14,22 Q34,29 84,22 M-14,33 Q34,40 84,33 M-14,44 Q34,51 84,44 M-14,55 Q34,62 84,55 M-14,66 Q34,73 84,66 M-14,77 Q34,84 84,77 M-14,88 Q34,95 84,88 M-14,99 Q34,106 84,99 M-14,110 Q34,117 84,110 M-14,121 Q34,128 84,121 M-14,132 Q34,139 84,132 M-14,143 Q34,150 84,143 M-14,154 Q34,161 84,154 M-14,165 Q34,172 84,165 M-14,176 Q34,183 84,176 M-14,187 Q34,194 84,187 M-14,198 Q34,205 84,198" fill="none" stroke="url(#ttWireG)" strokeWidth="1" opacity=".38" />
        <path d="M-16,-8 Q-9,100 -16,210 M-5,-8 Q2,100 -5,210 M6,-8 Q13,100 6,210 M17,-8 Q24,100 17,210 M28,-8 Q35,100 28,210 M39,-8 Q46,100 39,210 M50,-8 Q57,100 50,210 M61,-8 Q68,100 61,210 M72,-8 Q79,100 72,210 M83,-8 Q90,100 83,210" fill="none" stroke="url(#ttWireG)" strokeWidth="1" opacity=".38" />
        {/* soft glow under a crisp edge */}
        <path d={SIL} fill="none" stroke="url(#ttWireG)" strokeWidth="10" opacity=".16" />
        <path d={SIL} fill="none" stroke="url(#ttWireG)" strokeWidth="3" opacity=".95" />
      </g>

      {/* the contact point — the fingertip is the cursor */}
      <circle cx="0" cy="4" r="12" fill="url(#ttWireTip)" />
      <circle cx="0" cy="4" r="2.6" fill="#FFFFFF" />
    </g>
  );
}

/* A pointer's state: where tracking says the hand is (the target), or where it
   is currently drawn (the shown value). `on` is the 0..1 fade. */
export function makeHandState(scale = 0.4) {
  return { x: 0, y: 0, rot: 0, scale, flip: 1, on: 0 };
}

/* Ease `shown` towards `target` and write the result onto the node. Call once
   per animation frame, per pointer.
   Position follows hard — tracking only arrives at ~30fps, so a slow ease reads
   as lag rather than as smoothing. Rotation is deliberately slower: the angle a
   fingertip implies swings several degrees on a one-pixel wobble. Scale is
   slower still, because depth is the noisiest of the three and never needs to
   be exact.
   Opacity is written as inline style rather than as an attribute so that a
   React re-render cannot reset it. */
export function followHand(target, shown, node) {
  if (!node) return;
  // Re-appearing after a gap: jump to the new spot instead of sliding.
  if (target.on === 1 && shown.on < 0.04) {
    shown.x = target.x; shown.y = target.y;
    shown.scale = target.scale;
  }
  shown.x += (target.x - shown.x) * 0.78;
  shown.y += (target.y - shown.y) * 0.78;
  shown.scale += (target.scale - shown.scale) * 0.2;
  shown.on += (target.on - shown.on) * 0.3;

  /* NO ROTATION, NO MIRRORING.
     ---------------------------------------------------------------------
     The pointer used to be turned to the direction the index finger implied,
     and mirrored depending on which side the little finger fell. Both are
     gone: the hand is always drawn upright.

     Why: the angle a fingertip implies swings several degrees on a one-pixel
     landmark wobble, so the pointer was permanently rocking, and the mirror
     could flip the whole hand across the finger axis mid-reach. Neither told
     the child anything useful about where the cursor was — and the cursor is
     the fingertip, which does not move when the art rotates around it.

     `shown.rot` / `shown.flip` are left in the state object (makeHandState
     still returns them) so nothing that reads the struct breaks, but they no
     longer affect the transform. */
  node.setAttribute(
    'transform',
    `translate(${shown.x.toFixed(2)} ${shown.y.toFixed(2)}) ` +
    `scale(${shown.scale.toFixed(4)})`
  );
  node.style.opacity = shown.on.toFixed(3);
}

/* `handFlip` (which way round to mirror the hand) was removed with the
   rotation: the pointer is always drawn upright, so there is nothing to
   mirror. See followHand above. */

