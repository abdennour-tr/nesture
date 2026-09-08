/**
 * Camera-frame tap detection. No screen coordinates or target bias:
 * each hand calibrates independently and reports the finger that moved.
 */
import { PIANO_FINGERS } from '../pages/fingerPianoLevels';

const JOINTS = { thumb: [4, 3, 2], index: [8, 6, 5], middle: [12, 10, 9], ring: [16, 14, 13], little: [20, 18, 17] };
/* A thumb moves with the palm and needs a deeper, longer gesture. A little
   finger has less travel and noisier landmarks, so it gets a smaller distance
   threshold plus an extra confirming frame. All values are relative to that
   finger's own calibrated open pose. */
export const FINGER_TAP_PROFILES = Object.freeze({
  thumb:  { arm: 0.93, bend: 0.100, release: 0.055, frames: 3, holdMs: 55, cooldownMs: 260, tau: 0.055, referenceAlpha: 0.06 },
  index:  { arm: 0.91, bend: 0.055, release: 0.035, frames: 2, holdMs: 30, cooldownMs: 190, tau: 0.035, referenceAlpha: 0.12 },
  middle: { arm: 0.91, bend: 0.055, release: 0.035, frames: 2, holdMs: 30, cooldownMs: 190, tau: 0.035, referenceAlpha: 0.12 },
  ring:   { arm: 0.90, bend: 0.050, release: 0.032, frames: 2, holdMs: 35, cooldownMs: 210, tau: 0.042, referenceAlpha: 0.10 },
  little: { arm: 0.89, bend: 0.045, release: 0.030, frames: 3, holdMs: 45, cooldownMs: 220, tau: 0.050, referenceAlpha: 0.08 },
});
// Backwards-compatible exports for the original common index-finger baseline.
export const ARM_FRAC = FINGER_TAP_PROFILES.index.arm;
export const FIRE_FRAC = 1 - FINGER_TAP_PROFILES.index.bend;
const clamp = v => Math.max(0, Math.min(1, v));
/* Relative z is much noisier than x/y and changes when the palm rotates even
   if a digit stays open. The image plane contains enough flexion information. */
const distance = (a, b) => Math.hypot((a.x - b.x) * 4 / 3, a.y - b.y);

export function makePianoTapDetector() {
  let state, firstAt, previousAt, pending, lastTap;
  const reset = () => {
    state = Object.fromEntries(PIANO_FINGERS.map(f => [f.key, {
      reference: null, u: 1, top: 1, armed: false, openSince: null,
      bentSince: null, frames: 0, peakRate: 0, lastFire: -Infinity,
      bendReference: null, bottom: null,
    }]));
    firstAt = null; previousAt = null; pending = null; lastTap = -Infinity;
  };
  reset();
  return {
    reset,
    update(landmarks, now) {
      if (!landmarks || landmarks.length !== 21 ||
          landmarks.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
        reset(); return { flex: {}, tap: null, ready: false };
      }
      if (previousAt != null && now - previousAt > 300) reset();
      if (firstAt == null) firstAt = now;
      const dt = previousAt == null ? 1 / 30 : Math.max(0.008, (now - previousAt) / 1000);
      previousAt = now;
      const flex = {}, candidates = [];
      for (const f of PIANO_FINGERS) {
        const isThumb = f.key === 'thumb';
        const profile = FINGER_TAP_PROFILES[f.key];
        const [tip, pip, mcp] = JOINTS[f.key];
        const denominator = f.key === 'thumb'
          ? distance(landmarks[5], landmarks[17]) : distance(landmarks[pip], landmarks[mcp]);
        if (denominator < 0.012) continue;
        const raw = f.key === 'thumb'
          ? distance(landmarks[4], landmarks[5]) / denominator
          : distance(landmarks[tip], landmarks[mcp]) / denominator;
        if (!Number.isFinite(raw) || raw < 0.08 || raw > 3.8) continue;
        const s = state[f.key];
        // A comfortably open hand is enough; full finger extension is optional.
        if (s.reference == null) {
          if (raw < (isThumb ? 0.24 : 1.45)) continue;
          s.reference = raw;
        } else if (raw > s.reference && raw < s.reference * 1.35) {
          s.reference += (raw - s.reference) * profile.referenceAlpha;
        }
        let normalized = raw / s.reference;
        if (isThumb) {
          // Either drawing the thumb inward OR bending its own joint is a tap.
          // Bone-length normalization keeps the second cue independent of hand size.
          const boneLength = distance(landmarks[2], landmarks[3]) + distance(landmarks[3], landmarks[4]);
          if (boneLength > 0.015) {
            const bend = distance(landmarks[2], landmarks[4]) / boneLength;
            if (s.bendReference == null && bend >= 0.65) s.bendReference = bend;
            else if (s.bendReference != null && bend > s.bendReference) {
              s.bendReference += (bend - s.bendReference) * 0.15;
            }
            if (s.bendReference) normalized = Math.min(normalized, bend / s.bendReference);
          }
        }
        const alpha = 1 - Math.exp(-dt / profile.tau);
        const u = s.u + (normalized - s.u) * alpha;
        const rate = (s.u - u) / dt;
        s.u = u;
        flex[f.key] = clamp((1 - u) / 0.32);
        if (!s.armed && s.bottom != null) s.bottom = Math.min(s.bottom, u);
        // Every finger rearms after a small release, even from a relaxed pose.
        // A held bend cannot rearm itself or repeatedly trigger the same key.
        const open = !s.armed && (s.bottom == null
          ? u >= profile.arm : u - s.bottom >= profile.release);
        if (open) {
          s.openSince ??= now;
          if (now - s.openSince >= 40 && now - s.lastFire >= profile.cooldownMs) {
            s.armed = true; s.top = u; s.peakRate = 0;
            s.bottom = null;
          }
          s.bentSince = null; s.frames = 0;
        } else {
          s.openSince = null;
        }
        if (!s.armed || now - firstAt < 250) continue;
        s.top = Math.max(s.top, u);
        s.peakRate = Math.max(s.peakRate, rate);
        if (s.top - u >= profile.bend) {
          s.bentSince ??= now;
          s.frames++;
          // No speed requirement: a tiny, slow bend works. Require fresh frames
          // and a short hold to reject isolated tracking noise.
          if (s.frames >= profile.frames && now - s.bentSince >= profile.holdMs &&
              now - lastTap >= profile.cooldownMs) {
            candidates.push({ finger: f.key, amplitude: s.top - u, rate: s.peakRate });
            s.armed = false; s.lastFire = now;
            s.bottom = u;
          }
        } else {
          s.bentSince = null; s.frames = 0;
        }
      }
      if (candidates.length) {
        pending ??= { at: now, candidates: [] };
        pending.candidates.push(...candidates);
      }
      let tap = null;
      // Collect adjacent camera frames, so a closing fist cannot score one finger.
      if (pending && now - pending.at >= 60) {
        const ranked = pending.candidates.sort((a, b) => b.amplitude - a.amplitude);
        const best = ranked[0];
        const clear = ranked.length === 1 ||
          (ranked.length === 2 && best.amplitude >= ranked[1].amplitude * 1.65);
        const others = PIANO_FINGERS.filter(f => f.key !== best.finger);
        tap = {
          ...best, ambiguous: !clear,
          isolation: others.every(f => state[f.key].reference != null)
            ? others.filter(f => state[f.key].u >= FINGER_TAP_PROFILES[f.key].arm).length / others.length : null,
        };
        pending = null; lastTap = now;
      }
      return { flex, tap, ready: now - firstAt >= 250 && Object.values(state).some(s => s.armed) };
    },
  };
}
