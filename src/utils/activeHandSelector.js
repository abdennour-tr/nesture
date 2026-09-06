/**
 * activeHandSelector.js
 * ---------------------------------------------------------------------------
 * Picks WHICH detected hand should drive the pointer.
 *
 * Client feedback (Pop the Bubble):
 *   "i had my left hand on my cheek and right one in air and i realised the
 *    cursor wont move in the beginning and i wondered why — only to realise
 *    camera was taking my resting hand."
 *
 * Root cause: useHandTracking did `setLandmarks(multiHandLandmarks[0])` — it
 * used whichever hand MediaPipe happened to list first, which is essentially
 * arbitrary and very often the still one.
 *
 * This module scores every visible hand each frame and returns the one the
 * child is actually playing with. Scoring dimensions:
 *
 *   motion    — how much the index tip has moved over the last ~0.5s.
 *               A hand resting on a cheek scores ~0.
 *   pointing  — index extended past the knuckles (a playing posture).
 *   size      — a hand held up towards the camera is bigger in frame than one
 *               parked beside the face.
 *   centred   — hands near the middle of the frame beat hands pinned to an edge.
 *
 * Hysteresis: the current hand keeps a bonus, so the pointer does not flicker
 * between two hands that score similarly.
 *
 * If NO hand clears the idle threshold, `active` is null and `reason` is
 * 'idle' — the game shows "Raise one hand to start" instead of silently
 * tracking a motionless hand.
 */

const TIP = 8;    // index fingertip
const MCP = 5;    // index knuckle
const WRIST = 0;
const PINKY_MCP = 17;

const HISTORY_MS = 550;
const IDLE_MOTION = 0.010;   // normalised units of travel over the window
const STICKY_BONUS = 0.22;   // score bonus for the hand already in control
const LOST_GRACE_MS = 420;   // keep the last hand briefly when it blinks out

function span(lm) {
  if (!lm) return 0;
  return Math.hypot(lm[WRIST].x - lm[PINKY_MCP].x, lm[WRIST].y - lm[PINKY_MCP].y);
}

/** Stable-ish identity for a hand across frames: its handedness label, else index. */
function handKey(label, idx) {
  return label || `h${idx}`;
}

export function createActiveHandSelector({
  idleMotion = IDLE_MOTION,
  historyMs = HISTORY_MS,
  requireMotion = true,       // set false for games where holding still is the task
} = {}) {
  /** key → [{x, y, t}] */
  const history = new Map();
  let currentKey = null;
  let lastSeenAt = 0;

  function motionFor(key, tip, now) {
    let buf = history.get(key);
    if (!buf) { buf = []; history.set(key, buf); }
    buf.push({ x: tip.x, y: tip.y, t: now });
    while (buf.length > 1 && now - buf[0].t > historyMs) buf.shift();

    if (buf.length < 2) return 0;
    // Total path length over the window — better than start/end displacement,
    // because a small tremor back and forth is still "not playing".
    let travel = 0;
    let maxDisp = 0;
    for (let i = 1; i < buf.length; i++) {
      travel += Math.hypot(buf[i].x - buf[i - 1].x, buf[i].y - buf[i - 1].y);
      maxDisp = Math.max(maxDisp, Math.hypot(buf[i].x - buf[0].x, buf[i].y - buf[0].y));
    }
    // Weight net displacement higher than jitter.
    return maxDisp * 0.7 + travel * 0.3;
  }

  /**
   * @param {Array<Array>} hands      results.multiHandLandmarks
   * @param {Array}        handedness results.multiHandedness
   * @param {number}       now        performance.now()
   * @returns {{ landmarks, index, key, reason, scores }}
   */
  function select(hands, handedness = [], now = performance.now()) {
    if (!hands || hands.length === 0) {
      // Brief grace so a one-frame detection drop does not blank the pointer.
      if (currentKey && now - lastSeenAt < LOST_GRACE_MS) {
        return { landmarks: null, index: -1, key: currentKey, reason: 'blink', scores: [] };
      }
      history.clear();
      currentKey = null;
      return { landmarks: null, index: -1, key: null, reason: 'no-hand', scores: [] };
    }

    const scores = hands.map((lm, i) => {
      const key = handKey(handedness[i]?.label, i);
      const tip = lm[TIP];
      const mcp = lm[MCP];
      const s = span(lm) || 0.0001;

      const motion = motionFor(key, tip, now);

      // Pointing: fingertip further from the wrist than the knuckle is, scaled
      // by hand size so it works at any distance from the camera.
      const tipDist = Math.hypot(tip.x - lm[WRIST].x, tip.y - lm[WRIST].y);
      const mcpDist = Math.hypot(mcp.x - lm[WRIST].x, mcp.y - lm[WRIST].y);
      const pointing = Math.max(0, Math.min(1, (tipDist / Math.max(mcpDist, 1e-4) - 1) / 0.8));

      // Size: bigger hand in frame ⇒ held up towards the camera.
      const size = Math.max(0, Math.min(1, s / 0.22));

      // Centred: distance from the middle of the frame.
      const cx = lm[9].x, cy = lm[9].y;
      const centred = 1 - Math.min(1, Math.hypot(cx - 0.5, cy - 0.5) / 0.7);

      const sticky = key === currentKey ? STICKY_BONUS : 0;

      const score =
        Math.min(1, motion / 0.06) * 0.50 +
        pointing * 0.22 +
        size * 0.16 +
        centred * 0.12 +
        sticky;

      return { i, key, score, motion, pointing, size, centred };
    });

    scores.sort((a, b) => b.score - a.score);
    const best = scores[0];

    // Every visible hand is essentially still → nobody is playing.
    const anyMoving = scores.some((s) => s.motion >= idleMotion);
    if (requireMotion && !anyMoving) {
      // Keep the previous hand while it is still visible, but tell the game
      // so it can prompt the child. Do NOT switch to a different still hand.
      if (currentKey) {
        const keep = scores.find((s) => s.key === currentKey);
        if (keep) {
          lastSeenAt = now;
          return { landmarks: hands[keep.i], index: keep.i, key: keep.key, reason: 'idle', scores };
        }
      }
      return { landmarks: null, index: -1, key: null, reason: 'idle', scores };
    }

    currentKey = best.key;
    lastSeenAt = now;
    return { landmarks: hands[best.i], index: best.i, key: best.key, reason: 'ok', scores };
  }

  function reset() {
    history.clear();
    currentKey = null;
    lastSeenAt = 0;
  }

  return { select, reset };
}

export default createActiveHandSelector;
