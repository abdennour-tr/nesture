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
const TRACK_IDENTITY_MS = 1500; // allow slow inference to match the next visible wrist
const SWITCH_HOLD_MS = 250;
const SWITCH_MARGIN = 0.10;

/* ── Single-hand lock ──────────────────────────────────────────────────────
   Client feedback: "when two hands are visible the system gets confused and
   the pointer becomes unstable."

   Scoring alone cannot fix this. Two hands that are both moving produce two
   similar scores, and any rule that compares them every frame can change its
   mind — which is what the child feels as the pointer jumping between hands.

   So for pointer games the rule is not "pick the best hand each frame", it is
   "pick a hand ONCE, then stop looking". While a hand holds the lock the other
   hand is not scored, not compared and cannot win: the second hand may as well
   not be in frame. The lock is only released after the locked hand has been
   genuinely gone — not blinking, gone — for RELEASE_MS, at which point the
   next frame acquires fresh.

   Acquisition still sees every visible hand, because choosing correctly at the
   start is exactly what stops the pointer latching onto a hand resting on a
   cheek. It is the switching, not the choosing, that had to go. */
const LOCK_RELEASE_MS = 900;

/* ── Hand-SIDE lock (Pinch the Coin) ───────────────────────────────────────
   Client feedback: "this may be the reality of many of our learners where they
   are shaking their other hand too much (my daughter does this all the time —
   specially if she is excited or nervous) … Even though i was pinching and
   moving the coin correctly the app kept dropping the coin as it got confused
   between both the hand movements."

   Root cause: Pinch the Coin used the default per-frame scoring, where MOTION
   is 50 % of the score — so the hand shaking the hardest won the frame, the
   pinch point jumped to it, its (open) thumb–index aperture read as "released"
   and the coin dropped.

   The side lock uses MediaPipe's handedness label as the identity: whichever
   side (Right / Left) is seen FIRST owns the game for the whole round. The
   other side's landmarks are never scored, compared or returned — however
   much it moves. Acquisition deliberately ignores motion so a shaking hand
   cannot win the very first frame either.

   Handedness labels are occasionally wrong for a single frame, so two narrow,
   physically-motivated guards keep the lock on the right hand:
     - label SWAP: both hands visible, but the "locked-side" hand has teleported
       more than SIDE_SWAP_JUMP while the other one sits exactly where the
       locked hand was → the labels swapped, follow the hand, not the label.
     - label FLIP while alone: a single hand with the other label, sitting
       exactly where the locked hand was a moment ago → same hand, mislabelled.
   The lock is only released if the locked hand is gone for SIDE_RELEASE_MS
   (the child really put it down / switched hands), or on reset(). */
const SIDE_RELEASE_MS = 4000;
const SIDE_SWAP_JUMP = 0.25;   // normalised wrist travel in one frame = impossible
const SIDE_NEAR = 0.08;        // "same place as the locked hand was"
const SIDE_RECENT_MS = 300;    // the guards only trust a very recent position

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
  stableSelection = false,   // pointer games keep control through stillness and brief dropouts
  singleHandLock = false,    // once acquired, one hand keeps the pointer outright
  lockReleaseMs = LOCK_RELEASE_MS,
  handSideLock = false,      // lock onto the first hand's SIDE (Right/Left) for the round
  sideReleaseMs = SIDE_RELEASE_MS,
} = {}) {
  /** key → [{x, y, t}] */
  const history = new Map();
  let currentKey = null;
  let lastSeenAt = 0;
  const tracks = new Map();
  let nextTrackId = 0;
  let contenderKey = null;
  let contenderSince = 0;
  /* When the lock is held, this is the only hand that exists as far as the
     rest of the app is concerned. `lockedMissingSince` is the moment it stopped
     being visible, or null while it is on screen. */
  let lockedKey = null;
  let lockedMissingSince = null;

  /* Hand-side lock state (see SIDE_* above). */
  let lockedSide = null;         // 'Right' | 'Left' — MediaPipe label, used only for consistency
  let sideLastWrist = null;      // last wrist position of the locked hand
  let sideLastSeen = 0;
  let sideMissingSince = null;

  function releaseSide() {
    lockedSide = null;
    sideLastWrist = null;
    sideLastSeen = 0;
    sideMissingSince = null;
  }

  function selectBySide(hands, handedness, now) {
    const visible = (hands || []).map((lm, i) => ({
      i, lm, label: handedness[i]?.label || null,
    }));
    const sideKey = (side) => (side ? `side:${side}` : null);
    const wristDist = (v) => (sideLastWrist
      ? Math.hypot(v.lm[WRIST].x - sideLastWrist.x, v.lm[WRIST].y - sideLastWrist.y)
      : 0);
    const accept = (v) => {
      sideLastWrist = { x: v.lm[WRIST].x, y: v.lm[WRIST].y };
      sideLastSeen = now;
      sideMissingSince = null;
      currentKey = sideKey(lockedSide);
      lastSeenAt = now;
      return { landmarks: v.lm, index: v.i, key: sideKey(lockedSide), reason: 'ok', scores: [] };
    };

    /* ── Acquisition: the first hand seen owns the round ─────────────────── */
    if (!lockedSide) {
      const labelled = visible.filter((v) => v.label);
      if (!labelled.length) {
        return { landmarks: null, index: -1, key: null, reason: 'no-hand', scores: [] };
      }
      // Two hands appeared in the same frame: pick by size + centring, NOT by
      // motion — motion is exactly what a shaking hand has most of.
      let pick = labelled[0];
      if (labelled.length > 1) {
        const rank = (v) => {
          const size = Math.min(1, span(v.lm) / 0.22);
          const centred = 1 - Math.min(1, Math.hypot(v.lm[9].x - 0.5, v.lm[9].y - 0.5) / 0.7);
          return size * 0.6 + centred * 0.4;
        };
        pick = labelled.reduce((a, b) => (rank(b) > rank(a) ? b : a));
      }
      lockedSide = pick.label;
      sideLastWrist = null;
      return accept(pick);
    }

    /* ── Locked: only the locked side exists ─────────────────────────────── */
    const same  = visible.filter((v) => v.label === lockedSide);
    const other = visible.filter((v) => v.label !== lockedSide);
    const nearest = (list) => (list.length
      ? list.reduce((a, b) => (wristDist(b) < wristDist(a) ? b : a))
      : null);
    const recent = sideLastWrist && now - sideLastSeen < SIDE_RECENT_MS;

    let pick = nearest(same);

    // Guard 1 — labels swapped between the two hands for a frame.
    if (pick && recent && wristDist(pick) > SIDE_SWAP_JUMP) {
      const alt = nearest(other);
      if (alt && wristDist(alt) < SIDE_NEAR) pick = alt;
    }
    // Guard 2 — the locked hand alone, mislabelled for a frame.
    if (!pick && recent && other.length === 1 && wristDist(other[0]) < SIDE_NEAR) {
      pick = other[0];
    }

    if (pick) return accept(pick);

    // Locked hand not visible. Do NOT hand the game to the other hand.
    if (sideMissingSince === null) sideMissingSince = now;
    if (now - sideMissingSince >= sideReleaseMs) {
      // Gone long enough to be a real "put it down / switch hands".
      releaseSide();
      currentKey = null;
      return { landmarks: null, index: -1, key: null, reason: 'no-hand', scores: [] };
    }
    return { landmarks: null, index: -1, key: sideKey(lockedSide), reason: 'blink', scores: [] };
  }

  function clearContender() {
    contenderKey = null;
    contenderSince = 0;
  }

  function releaseLock() {
    lockedKey = null;
    lockedMissingSince = null;
  }

  // Result order and handedness can both change from one detection to the next.
  // Match wrists first, treating the label only as a soft hint. A distance gate
  // prevents an absent playing hand from inheriting a distant resting hand.
  function stableKeys(hands, handedness, now) {
    for (const [key, track] of tracks) {
      if (now - track.t >= TRACK_IDENTITY_MS) {
        tracks.delete(key);
        history.delete(key);
      }
    }
    const candidates = [];
    hands.forEach((lm, i) => {
      const label = handedness[i]?.label;
      for (const [key, track] of tracks) {
        const distance = Math.hypot(lm[WRIST].x - track.x, lm[WRIST].y - track.y);
        const sameLabel = label && label === track.label;
        if (distance <= (sameLabel ? 0.40 : 0.20)) {
          candidates.push({ i, key, cost: distance + (label && track.label && !sameLabel ? 0.06 : 0) });
        }
      }
    });
    candidates.sort((a, b) => a.cost - b.cost);
    const keys = new Array(hands.length);
    const matched = new Set();
    for (const candidate of candidates) {
      if (keys[candidate.i] !== undefined || matched.has(candidate.key)) continue;
      keys[candidate.i] = candidate.key;
      matched.add(candidate.key);
    }
    hands.forEach((lm, i) => {
      if (keys[i] === undefined) keys[i] = `hand-${nextTrackId++}`;
      tracks.set(keys[i], {
        x: lm[WRIST].x, y: lm[WRIST].y,
        label: handedness[i]?.label || tracks.get(keys[i])?.label,
        t: now,
      });
    });
    return keys;
  }

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
    if (handSideLock) return selectBySide(hands, handedness, now);

    if (!hands || hands.length === 0) {
      clearContender();
      /* A locked hand is allowed to disappear for longer than an unlocked one
         before the pointer is handed to anybody else: the child lowering their
         hand for a moment is not a request to change hands. */
      if (singleHandLock && lockedKey) {
        if (lockedMissingSince === null) lockedMissingSince = now;
        if (now - lockedMissingSince < lockReleaseMs) {
          return { landmarks: null, index: -1, key: lockedKey, reason: 'blink', scores: [] };
        }
        releaseLock();
      }
      // Brief grace so a one-frame detection drop does not blank the pointer.
      if (currentKey && now - lastSeenAt < LOST_GRACE_MS) {
        return { landmarks: null, index: -1, key: currentKey, reason: 'blink', scores: [] };
      }
      history.clear();
      tracks.clear();
      currentKey = null;
      return { landmarks: null, index: -1, key: null, reason: 'no-hand', scores: [] };
    }

    /* The lock needs a stable identity for "the same hand as last frame",
       so it always uses wrist matching regardless of `stableSelection`. */
    const keys = (stableSelection || singleHandLock)
      ? stableKeys(hands, handedness, now)
      : null;
    const scores = hands.map((lm, i) => {
      const key = keys ? keys[i] : handKey(handedness[i]?.label, i);
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

    /* ── The lock, before any comparison ──────────────────────────────────
       Note this runs BEFORE the score-based paths below. A locked hand is
       returned on its identity alone; the other hand's score is never
       consulted, so there is nothing for the pointer to flicker between. */
    if (singleHandLock) {
      if (lockedKey) {
        const held = scores.find((s) => s.key === lockedKey);
        if (held) {
          lockedMissingSince = null;
          currentKey = lockedKey;
          lastSeenAt = now;
          clearContender();
          return { landmarks: hands[held.i], index: held.i, key: held.key, reason: 'ok', scores };
        }
        // Locked hand not in this frame — hold the pointer for it, do not
        // hand control to whatever else happens to be visible.
        if (lockedMissingSince === null) lockedMissingSince = now;
        if (now - lockedMissingSince < lockReleaseMs) {
          return { landmarks: null, index: -1, key: lockedKey, reason: 'blink', scores };
        }
        releaseLock();
      }

      // Acquisition: free to compare, because nothing holds the pointer yet.
      if (requireMotion && best.motion < idleMotion) {
        currentKey = null;
        return { landmarks: null, index: -1, key: null, reason: 'idle', scores };
      }
      lockedKey = best.key;
      lockedMissingSince = null;
      currentKey = best.key;
      lastSeenAt = now;
      clearContender();
      return { landmarks: hands[best.i], index: best.i, key: best.key, reason: 'ok', scores };
    }

    if (stableSelection && currentKey) {
      const current = scores.find((score) => score.key === currentKey);
      if (!current) {
        clearContender();
        // Do not immediately transfer control to the other visible hand when
        // the playing hand is briefly occluded.
        if (now - lastSeenAt < LOST_GRACE_MS) {
          return { landmarks: null, index: -1, key: currentKey, reason: 'blink', scores };
        }
        currentKey = null;
      } else {
        lastSeenAt = now;
        let picked = current;
        if (best.key !== currentKey && best.motion >= idleMotion && best.score > current.score + SWITCH_MARGIN) {
          if (contenderKey !== best.key) {
            contenderKey = best.key;
            contenderSince = now;
          } else if (now - contenderSince >= SWITCH_HOLD_MS) {
            picked = best;
            currentKey = best.key;
            clearContender();
          }
        } else {
          clearContender();
        }
        // A still index finger is a valid pointer position. Acquisition can
        // require motion, but holding the acquired hand must not flicker idle.
        return { landmarks: hands[picked.i], index: picked.i, key: picked.key, reason: 'ok', scores };
      }
    }

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
    tracks.clear();
    currentKey = null;
    lastSeenAt = 0;
    clearContender();
    releaseLock();
    releaseSide();
  }

  /** Drop the current hand and re-acquire on the next frame (e.g. the child
   *  wants to swap hands mid-round without waiting for the release timer). */
  function releaseActiveHand() {
    releaseLock();
    releaseSide();
    currentKey = null;
    clearContender();
  }

  return {
    select, reset, releaseActiveHand,
    get lockedKey() { return lockedKey; },
    get lockedSide() { return lockedSide; },
  };
}

export default createActiveHandSelector;
