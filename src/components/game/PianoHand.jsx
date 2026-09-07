/**
 * PianoHand.jsx
 * ---------------------------------------------------------------------------
 * The wireframe hand card for Finger Piano.
 *
 * Finger Piano's whole instruction is "move THIS finger". Until now that was
 * said with a number in a coloured circle, which the child had to translate
 * into a finger. This card removes the translation: it shows a hand, and the
 * finger being asked for lights up on it.
 *
 * Two things it does beyond lighting up:
 *
 * 1. In camera mode it also shows the child's OWN bend, live. `setFlex()` is
 *    called from the game's rAF loop with each finger's flexion as a share of
 *    that finger's straight reading, and it writes a CSS variable straight onto
 *    the DOM node. No React state, so the hand can follow the hand at 60Hz
 *    without re-rendering the game once.
 *
 * 2. Fingers the current level does not use are drawn faint, so on Beginner the
 *    child sees at a glance that only three fingers are in play.
 *
 * The drawing is SVG rather than the reference photograph: it scales to any
 * card size without blurring, ships no image, and — the reason that matters —
 * each finger is its own group, so it can be lit, dimmed and bent on its own.
 */
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { PIANO_FINGERS } from '../../pages/fingerPianoLevels';

/* Hand skeleton in a 200×250 box, right hand, palm to camera, fingers up.
   Each finger runs knuckle → joints → tip, and the knuckle sits INSIDE the palm
   so the drawn finger grows out of the hand instead of floating above it. */
const BONES = {
  thumb:  [[70, 178], [48, 162], [30, 146], [16, 132]],
  index:  [[70, 150], [65, 116], [62,  88], [60,  62]],
  middle: [[97, 148], [96, 110], [96,  80], [96,  52]],
  ring:   [[124, 150], [128, 114], [130, 86], [132, 62]],
  little: [[148, 156], [156, 126], [160, 104], [163, 86]],
};

/* Palm outline — also the clip for the mesh fill. */
const PALM = 'M56 196 L52 134 Q54 120 68 119 L150 124 Q163 127 162 141 '
           + 'L155 198 Q151 226 124 231 L86 231 Q60 226 56 196 Z';

const polyline = (pts) => pts.map((p) => p.join(',')).join(' ');

const PianoHand = forwardRef(function PianoHand(
  { active, wanted, label }, ref
) {
  const groups = useRef({});

  /* Called from the game loop, never from React. `flex` is 0 (straight) to 1
     (bent far enough to fire), i.e. the same scale the tap detector uses. */
  useImperativeHandle(ref, () => ({
    setFlex(byFinger) {
      for (const key of Object.keys(groups.current)) {
        const el = groups.current[key];
        if (!el) continue;
        const v = byFinger?.[key];
        el.style.setProperty('--flex', v == null ? 0 : Math.max(0, Math.min(1, v)));
      }
    },
    clear() {
      for (const key of Object.keys(groups.current)) {
        groups.current[key]?.style.setProperty('--flex', 0);
      }
    },
  }), []);

  return (
    <div className="fpp-handcard">
      <div className="fpp-handcard-title">
        {wanted ? 'Move this finger' : 'Your hand'}
      </div>

      <svg className="fpp-hand-svg" viewBox="0 0 200 250" role="img"
        aria-label={wanted ? `Move your ${label}` : 'Hand'}>
        <defs>
          {/* The fine mesh that gives the hand its wireframe look. */}
          <pattern id="fppMesh" width="9" height="9" patternUnits="userSpaceOnUse">
            <path d="M0 0 L9 9 M9 0 L0 9" stroke="#7DD3FC" strokeWidth="0.4"
              opacity="0.35" fill="none" />
          </pattern>
          <clipPath id="fppPalmClip"><path d={PALM} /></clipPath>
          <filter id="fppGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* palm */}
        <g className="fpp-hand-palm">
          <path d={PALM} className="fpp-hand-fill" />
          <g clipPath="url(#fppPalmClip)">
            <rect x="0" y="0" width="200" height="250" fill="url(#fppMesh)" />
          </g>
          <path d={PALM} className="fpp-hand-edge" />
        </g>

        {/* one group per finger — this is what lights up */}
        {PIANO_FINGERS.map((f) => {
          const pts = BONES[f.key];
          const inPlay = active.includes(f.key);
          const isWanted = wanted === f.key;
          return (
            <g
              key={f.key}
              ref={(el) => { groups.current[f.key] = el; }}
              className={
                'fpp-hand-finger'
                + (inPlay ? '' : ' is-off')
                + (isWanted ? ' is-wanted' : '')
              }
              style={{ '--fc': f.color }}
              filter={isWanted ? 'url(#fppGlow)' : undefined}
            >
              {/* the soft body of the finger… */}
              <polyline className="fpp-hand-body" points={polyline(pts)} />
              {/* …with the same mesh the palm carries, so the whole hand reads
                  as one wireframe rather than sticks stuck to a shape */}
              <polyline className="fpp-hand-mesh" points={polyline(pts)} />
              {/* the bone and its joints */}
              <polyline className="fpp-hand-bone" points={polyline(pts)} />
              {pts.map(([x, y], i) => (
                <circle key={i} className="fpp-hand-joint" cx={x} cy={y}
                  r={i === pts.length - 1 ? 3.6 : 2.6} />
              ))}
              {/* the finger's number, at the tip */}
              <text className="fpp-hand-num"
                x={pts[pts.length - 1][0]}
                y={pts[pts.length - 1][1] - (f.key === 'thumb' ? 8 : 11)}>
                {f.n}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="fpp-handcard-foot">
        {wanted
          ? <><span className="fpp-handcard-dot"
                style={{ '--fc': PIANO_FINGERS.find((f) => f.key === wanted)?.color }}>
                {PIANO_FINGERS.find((f) => f.key === wanted)?.n}
              </span><strong>{label}</strong></>
          : <span className="fpp-handcard-wait">Waiting for the next key…</span>}
      </div>
    </div>
  );
});

export default PianoHand;
