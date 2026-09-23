import React, { forwardRef, useId, useImperativeHandle, useRef } from 'react';
import { PIANO_KEYS } from '../../pages/fingerPianoLevels';

// Anatomical contours and curved mesh, without landmark dots or fingertip rings.
const PALM = 'M68 181 Q68 160 79 156 Q117 144 163 164 Q176 169 174 190 L170 220 Q166 251 151 274 L154 310 L84 310 L83 279 Q70 259 62 240 L47 211 Q39 196 48 189 Q58 184 68 197 Z';
const DIGITS = {
  thumb:  { points: [[70, 222], [49, 202], [32, 181], [20, 169]], width: 13 },
  index:  { points: [[82, 183], [76, 136], [70, 97], [67, 67]], width: 12 },
  middle: { points: [[110, 176], [109, 118], [109, 74], [108, 39]], width: 13 },
  ring:   { points: [[139, 179], [143, 129], [146, 94], [148, 64]], width: 12 },
  little: { points: [[164, 191], [174, 159], [181, 131], [185, 109]], width: 10 },
};
function fingerSurface({ points, width }) {
  const samples = [];
  for (let j = 0; j <= 18; j++) {
    const t = j / 18, segment = Math.min(2, Math.floor(t * 3)), u = t * 3 - segment;
    const a = points[segment], b = points[segment + 1];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const radius = width * (1 - 0.3 * t);
    samples.push({
      x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u,
      nx: -(b[1] - a[1]) / length, ny: (b[0] - a[0]) / length, radius,
    });
  }
  const point = (s, ratio) => [s.x + s.nx * s.radius * ratio, s.y + s.ny * s.radius * ratio];
  const line = pts => pts.map((p, i) => (i ? 'L' : 'M') + p.join(' ')).join(' ');
  const end = samples[samples.length - 1], first = samples[0];
  const left = samples.map(s => point(s, -1)), right = samples.map(s => point(s, 1)).reverse();
  const tip = [end.x + end.ny * end.radius, end.y - end.nx * end.radius];
  const outline = line(left) + ' Q' + tip.join(' ') + ' ' + right[0].join(' ') + ' ' +
    right.slice(1).map(p => 'L' + p.join(' ')).join(' ') + ' Z';
  return {
    outline, origin: points[0],
    strands: [-0.65, -0.3, 0.12, 0.5, 0.8].map(r => line(samples.map(s => point(s, r)))),
    cross: samples.slice(1).map(s => {
      const a = point(s, -1), b = point(s, 1);
      return 'M' + a.join(' ') + ' Q' + (s.x - s.ny * 4) + ' ' + (s.y + s.nx * 4) + ' ' + b.join(' ');
    }),
    seam: 'M' + point(first, -1).join(' ') + ' L' + point(first, 1).join(' '),
  };
}
const SURFACES = Object.fromEntries(Object.entries(DIGITS).map(([key, shape]) => [key, fingerSurface(shape)]));

const PianoHand = forwardRef(function PianoHand(
  {
    hand = 'right', keyCount, wanted, mode, detected = false,
    /* Which hand this widget is LABELLED and DRAWN as (heading, aria-label,
       mirrored artwork). Defaults to `hand`. Kept separate from `hand` (which
       still picks the PIANO_KEYS subset — the actual finger/colour/note
       mapping) because "Swap hands" only changes which of the child's two
       physical hands is read for a given on-screen key set; it does not
       renumber the keys. Without this split, swapping hands for a
       single-hand stage would have silently swapped in the OTHER five keys
       (a different stage's notes) instead of just relabelling the same ones —
       see FingerPianoGame.jsx's own note on `handInvert`. */
    physicalHand,
  }, ref
) {
  const shownAs = physicalHand || hand;
  const uid = useId().replace(/:/g, '');
  const groups = useRef({});
  const root = useRef(null);
  const glow = uid + '-glow', clip = uid + '-palm';
  const mapped = PIANO_KEYS.filter(k => k.hand === hand);
  useImperativeHandle(ref, () => ({
    setFlex(values) {
      for (const key of Object.keys(groups.current)) {
        const value = Math.max(0, Math.min(1, values?.[key] || 0));
        groups.current[key]?.style.setProperty('--flex', value);
      }
    },
    setDetected(value) { root.current?.classList.toggle('is-detected', value); },
    clear() {
      root.current?.classList.remove('is-detected');
      for (const group of Object.values(groups.current)) group?.style.setProperty('--flex', 0);
    },
  }), []);
  const requested = mapped.find(k => wanted === k.id);
  return (
    <div ref={root} className={'fp-hand-figure' + (detected ? ' is-detected' : '') + (mode === 'touch' ? ' is-guide' : '')}>
      <div className="fp-hand-heading">
        <span>{shownAs === 'right' ? 'Right hand' : 'Left hand'}</span>
        {mode === 'camera' && <span className="fp-hand-signal" aria-hidden="true">LIVE</span>}
      </div>
      <svg viewBox="0 0 215 330" className="fp-hand-art" role="img"
        aria-label={(shownAs === 'right' ? 'Right' : 'Left') + ' hand' + (requested ? ': bend your ' + requested.fingerLabel.toLowerCase() : '')}>
        <defs>
          <clipPath id={clip}><path d={PALM} /></clipPath>
          <filter id={glow} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <g transform={shownAs === 'left' ? 'translate(215 0) scale(-1 1)' : undefined} className="fp-hand-model">
          <path d={PALM} className="fp-palm-surface" />
          <g clipPath={'url(#' + clip + ')'} className="fp-palm-mesh">
            {Array.from({ length: 15 }, (_, i) => (
              <path key={'long-' + i} d={'M' + (31 + i * 11) + ' 145 Q' + (64 + i * 7) + ' 215 ' +
                (90 + i * 4) + ' 268 Q' + (79 + i * 6) + ' 299 ' + (79 + i * 6) + ' 325'} />
            ))}
            {Array.from({ length: 22 }, (_, i) => (
              <path key={'cross-' + i} d={'M30 ' + (148 + i * 8) + ' Q107 ' + (180 + i * 7) + ' 184 ' + (143 + i * 8)} />
            ))}
            {Array.from({ length: 10 }, (_, i) => (
              <path key={'diagonal-' + i} d={'M35 ' + (179 + i * 12) + ' Q123 ' + (151 + i * 12) + ' 179 ' + (206 + i * 11)} />
            ))}
          </g>
          <path d={PALM} className="fp-palm-outline" />
          {mapped.map(k => {
            const shape = SURFACES[k.fingerKey];
            return (
              <g key={k.id} ref={el => { groups.current[k.fingerKey] = el; }}
                className={'fp-digit' + (k.i >= keyCount ? ' is-locked' : '') + (wanted === k.id ? ' is-wanted' : '')}
                style={{ '--fc': k.color, transformOrigin: shape.origin.join('px ') + 'px' }}
                filter={wanted === k.id ? 'url(#' + glow + ')' : undefined}>
                <path d={shape.outline} className="fp-digit-surface" />
                <g className="fp-digit-mesh">
                  {shape.strands.map((d, i) => <path key={'l' + i} d={d} />)}
                  {shape.cross.map((d, i) => <path key={'c' + i} d={d} />)}
                </g>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="fp-hand-caption">
        {requested
          ? <><span style={{ background: requested.color }}>{requested.n}</span>{requested.fingerLabel}</>
          : <span className="fp-hand-caption-rest">{mode === 'touch' ? 'Finger guide' : 'Relax and keep your palm open'}</span>}
      </div>
    </div>
  );
});
export default PianoHand;
