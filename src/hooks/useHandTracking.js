/**
 * useHandTracking.js
 * Custom React hook wrapping Google MediaPipe Hands.
 * Falls back to simulation mode if camera is unavailable.
 *
 * Usage:
 *   const { landmarks, isTracking, error } = useHandTracking(videoRef, canvasRef, enabled);
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import createActiveHandSelector from '../utils/activeHandSelector';

// ── Landmark indices (MediaPipe 21-point hand model) ──────────────────────
export const LANDMARKS = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_TIP: 20,
  PALM_CENTER: 9, // Middle MCP as palm center
};

/**
 * Calculate distance between two 2D points (normalised 0-1 coords)
 */
export function landmarkDistance(a, b) {
  if (!a || !b) return 1;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Derive pointing direction from wrist→index tip vector
 */
export function getPointingVector(landmarks) {
  if (!landmarks || landmarks.length < 9) return null;
  const wrist = landmarks[LANDMARKS.WRIST];
  const index = landmarks[LANDMARKS.INDEX_TIP];
  return {
    x: index.x - wrist.x,
    y: index.y - wrist.y,
  };
}

/**
 * Detect if index finger is extended (pointing)
 */
export function isIndexPointing(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;
  const indexTip = landmarks[LANDMARKS.INDEX_TIP];
  const indexMcp = landmarks[5];
  return indexTip.y < indexMcp.y - 0.05;
}

/**
 * Get the palm center position (average of MCP joints)
 * Returns normalised {x, y} coords
 */
export function getPalmCenter(landmarks) {
  if (!landmarks || landmarks.length < 21) return null;
  const mcpIndices = [5, 9, 13, 17]; // Index, Middle, Ring, Pinky MCP
  const sum = mcpIndices.reduce(
    (acc, i) => ({ x: acc.x + landmarks[i].x, y: acc.y + landmarks[i].y }),
    { x: 0, y: 0 }
  );
  return { x: sum.x / mcpIndices.length, y: sum.y / mcpIndices.length };
}

/**
 * Detect a closed-fist "grip" gesture.
 * All fingertips must be close to the palm center.
 * Returns true when the hand is gripping.
 */
export function isGripping(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;
  const palm = getPalmCenter(landmarks);
  if (!palm) return false;

  const fingerTips = [
    landmarks[LANDMARKS.INDEX_TIP],
    landmarks[LANDMARKS.MIDDLE_TIP],
    landmarks[LANDMARKS.RING_TIP],
    landmarks[LANDMARKS.PINKY_TIP],
  ];

  // All fingertips must be within 0.15 normalised units of palm center
  const threshold = 0.15;
  const allClosed = fingerTips.every(
    (tip) => Math.hypot(tip.x - palm.x, tip.y - palm.y) < threshold
  );

  // Also check thumb is somewhat inward (not fully extended)
  const thumb = landmarks[LANDMARKS.THUMB_TIP];
  const wrist = landmarks[LANDMARKS.WRIST];
  const thumbDist = Math.hypot(thumb.x - palm.x, thumb.y - palm.y);

  return allClosed && thumbDist < 0.2;
}

/**
 * Estimate trajectory smoothness from a buffer of recent landmark positions.
 * Returns 0-1 (1 = perfectly smooth).
 */
export function calculateSmoothness(positionBuffer) {
  if (positionBuffer.length < 3) return 0.8;
  const jerks = [];
  for (let i = 2; i < positionBuffer.length; i++) {
    const v1x = positionBuffer[i-1].x - positionBuffer[i-2].x;
    const v1y = positionBuffer[i-1].y - positionBuffer[i-2].y;
    const v2x = positionBuffer[i].x   - positionBuffer[i-1].x;
    const v2y = positionBuffer[i].y   - positionBuffer[i-1].y;
    const jerk = Math.hypot(v2x - v1x, v2y - v1y);
    jerks.push(jerk);
  }
  const avgJerk = jerks.reduce((a, b) => a + b, 0) / jerks.length;
  // Map jerk 0→0.1 to smoothness 1→0
  return Math.max(0, Math.min(1, 1 - avgJerk * 10));
}

/**
 * Detect midline crossing: does the index tip cross x=0.5 during a gesture?
 */
export function detectMidlineCrossing(startX, endX) {
  return (startX < 0.5 && endX > 0.5) || (startX > 0.5 && endX < 0.5);
}

// ── Main hook ─────────────────────────────────────────────────────────────────
/**
 * Hand selection is ALWAYS active: of the visible hands, the one that is
 * moving / pointing / held towards the camera drives the pointer.
 *
 * @param {boolean} requireMotion  Opt-in stricter rule for POINTER games
 *   (Pop the Bubble, Follow the Ladybug): when every visible hand is
 *   completely still, no hand takes the pointer and `handStatus` becomes
 *   'idle' so the game can prompt the child. Games where holding a pose IS the
 *   task — Magic Finger Copy, Finger Piano — must leave this false (the
 *   default), otherwise a correctly held gesture would be treated as idle.
 * @param {boolean} stableSelection Keep pointer control through stillness,
 *   changing result order, and brief occlusions; require sustained movement
 *   before a second hand takes over. Opt in for games driven by a hand pointer.
 */
/**
 * @param {boolean} singleHandLock  Exactly one hand drives the pointer. Once a
 *   hand is acquired it keeps control outright — a second hand in frame is not
 *   scored and cannot take over — until the locked hand has been gone long
 *   enough to count as put down. See src/utils/activeHandSelector.js.
 * @param {boolean} handSideLock  Stricter: the SIDE (right/left, from
 *   MediaPipe handedness) of the first hand seen is locked for the round. Only
 *   that hand's landmarks are ever returned; the other hand — even shaking hard
 *   — is ignored. Used by Pinch the Coin. See activeHandSelector.js.
 * @param {0|1} modelComplexity  MediaPipe model. 0 is the lite graph: roughly
 *   twice the frame rate for a little more landmark noise, which is the right
 *   trade for a pointer (the noise is filtered downstream; the frame rate is
 *   what the child actually feels). 1 is the full graph, for games that score
 *   finger POSE rather than move a cursor.
 * @param {number} publishIntervalMs  How often the per-frame signal is mirrored
 *   into React state, in ms. See the ref/state note below.
 *
 *   DEFAULT 0 = publish every camera result, which is the behaviour every
 *   existing caller was written against. Throttling is OPT-IN and only safe for
 *   a game that reads the *Ref values instead — Pinch the Coin, Follow the
 *   Ladybug, Pop the Bubble, Finger Piano and Magic Finger Copy all drive their
 *   gameplay from the `landmarks` / `multiHandData` STATE, so throttling this
 *   without them opting in drops them from ~30Hz to ~8Hz and the pointer in
 *   every one of them goes to treacle.
 */
export default function useHandTracking(
  videoRef, canvasRef, enabled = true, pauseProcessing = false, maxHands = 2,
  {
    requireMotion = false,
    stableSelection = false,
    singleHandLock = false,
    handSideLock = false,       // first hand's side (Right/Left) owns the round
    modelComplexity = 1,
    publishIntervalMs = 0,      // 0 = every frame; see the note above
    drawOnlyActiveHand = false,
  } = {}
) {
  const [landmarks,      setLandmarks]      = useState(null);  // the ACTIVE hand
  const [multiHandData,  setMultiHandData]  = useState(null);  // { left, right, all }
  const [isTracking,     setIsTracking]     = useState(false);
  const [error,          setError]          = useState(null);
  /* 'ok' | 'idle' | 'no-hand' | 'blink' — lets a game show
     "Raise one hand to start" instead of looking broken. */
  const [handStatus,     setHandStatus]     = useState('no-hand');
  const [activeHandIndex, setActiveHandIndex] = useState(-1);
  const [activeHandKey, setActiveHandKey] = useState(null);
  const [trackingTimestamp, setTrackingTimestamp] = useState(null);

  /* Chooses which of the visible hands drives the pointer. See
     src/utils/activeHandSelector.js — this replaces the old
     `multiHandLandmarks[0]`, which picked an arbitrary hand. */
  const selectorRef = useRef(null);
  if (!selectorRef.current) {
    selectorRef.current = createActiveHandSelector({
      requireMotion, stableSelection, singleHandLock, handSideLock,
    });
  }

  /* ── Per-frame values live in refs; state is a throttled mirror ──────────
     Every one of the setters above used to fire on EVERY camera result, so a
     30fps camera re-rendered the consuming game thirty times a second. In a
     game whose component is a couple of thousand lines, that render is far
     more expensive than the pointer maths — the pointer was not moving badly,
     it was being redrawn under a screen that was rebuilding itself.

     The refs below carry the full-rate signal for consumers that read them
     from their own animation frame (the correct way to drive a pointer). The
     state is still published, but only every `publishIntervalMs`, for UI that
     legitimately renders from state — "Raise your hand", the camera badge.

     This mirrors what useMediaPipeTracking already does for LetterQuest, which
     is why LetterQuest's cursor feels lighter than this one did. */
  const landmarksRef = useRef(null);
  const trackingTimestampRef = useRef(null);
  const activeHandKeyRef = useRef(null);
  const handStatusRef = useRef('no-hand');
  const multiHandDataRef = useRef(null);
  /* Bumped on every accepted camera result, so a consumer can tell "new
     sample" from "same sample" without comparing timestamps. */
  const frameSeqRef = useRef(0);
  const lastPublishAtRef = useRef(0);
  const lastPublishedStatusRef = useRef('no-hand');

  // Ref to hold the latest pauseProcessing value for the async callback
  const pauseProcessingRef = useRef(pauseProcessing);
  useEffect(() => {
    pauseProcessingRef.current = pauseProcessing;
  }, [pauseProcessing]);

  const handsRef   = useRef(null);
  const cameraRef  = useRef(null);
  const rafRef     = useRef(null);
  const posBuffer  = useRef([]);   // Rolling buffer of index tip positions

  /* ── Releasing the webcam ────────────────────────────────────────────────
     MediaPipe's `Camera.stop()` only stops its own requestAnimationFrame loop.
     It does NOT stop the underlying MediaStream, so the webcam stays open and
     the privacy light stays on after a game finishes — which is what the
     client saw. The tracks have to be stopped explicitly, and the video
     element's srcObject cleared, or the browser keeps the device held.

     Safe to call repeatedly: every step is guarded and idempotent. */
  const releaseCamera = useCallback(() => {
    // 1. Stop MediaPipe's frame pump.
    if (cameraRef.current) {
      try { cameraRef.current.stop(); } catch { /* already stopped */ }
      cameraRef.current = null;
    }

    // 2. Free the WASM graph so the GPU/CPU worker is not left running.
    if (handsRef.current) {
      try { handsRef.current.close(); } catch { /* already closed */ }
      handsRef.current = null;
    }

    // 3. THE ACTUAL FIX — stop every track so the OS releases the camera.
    const video = videoRef?.current;
    const stream = video?.srcObject;
    if (stream && typeof stream.getTracks === 'function') {
      stream.getTracks().forEach((track) => {
        try { track.stop(); } catch { /* already stopped */ }
      });
    }
    if (video) {
      try {
        video.pause();
        video.srcObject = null;
        video.removeAttribute('src');
        video.load();
      } catch { /* detached node */ }
    }

    setIsTracking(false);
    setLandmarks(null);
    setMultiHandData(null);
    setActiveHandIndex(-1);
    setActiveHandKey(null);
    setTrackingTimestamp(null);
    setHandStatus('no-hand');
    selectorRef.current?.reset();
  }, [videoRef]);

  /* Mirror the refs into React state at a human rate rather than a camera
     rate. A status change (hand lost / found / idle) publishes immediately,
     because that drives a visible prompt and must not wait for the interval. */
  const publish = useCallback(({ index, tracking }) => {
    const status = handStatusRef.current;
    const now = trackingTimestampRef.current ?? performance.now();
    const statusChanged = status !== lastPublishedStatusRef.current;
    if (!statusChanged && now - lastPublishAtRef.current < publishIntervalMs) return;
    lastPublishAtRef.current = now;
    lastPublishedStatusRef.current = status;
    setLandmarks(landmarksRef.current);
    setMultiHandData(multiHandDataRef.current);
    setActiveHandIndex(index);
    setActiveHandKey(activeHandKeyRef.current);
    setHandStatus(status);
    setTrackingTimestamp(now);
    setIsTracking(tracking);
  }, [publishIntervalMs]);

  // ── Draw landmarks on canvas ─────────────────────────────────────────────
  const drawLandmarks = useCallback((results, activeIndex = -1) => {
    const canvas = canvasRef?.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!results.multiHandLandmarks?.length) return;

    /* Show one hand, the one in control. Drawing every detected hand meant a
       resting hand got its own skeleton, which reads as "the game is following
       that one" even though the pointer is driven by the other. */
    const hands = drawOnlyActiveHand
      ? (activeIndex >= 0 && results.multiHandLandmarks[activeIndex]
          ? [results.multiHandLandmarks[activeIndex]]
          : [])
      : results.multiHandLandmarks;

    for (const handLandmarks of hands) {
      // Draw connections
      ctx.strokeStyle = 'rgba(13,94,107,0.6)';
      ctx.lineWidth = 2;
      const connections = window.HAND_CONNECTIONS || [];
      for (const [start, end] of connections) {
        const s = handLandmarks[start];
        const e = handLandmarks[end];
        if (s && e) {
          ctx.beginPath();
          ctx.moveTo(s.x * canvas.width, s.y * canvas.height);
          ctx.lineTo(e.x * canvas.width, e.y * canvas.height);
          ctx.stroke();
        }
      }

      // Draw key points
      for (let i = 0; i < handLandmarks.length; i++) {
        const lm = handLandmarks[i];
        const isKey = Object.values(LANDMARKS).includes(i);
        ctx.beginPath();
        ctx.arc(lm.x * canvas.width, lm.y * canvas.height, isKey ? 5 : 2, 0, 2 * Math.PI);
        ctx.fillStyle = isKey ? '#E8841A' : 'rgba(200,232,237,0.6)';
        ctx.fill();
      }

      // Track index tip position
      const indexTip = handLandmarks[LANDMARKS.INDEX_TIP];
      if (indexTip) {
        posBuffer.current.push({ x: indexTip.x, y: indexTip.y, t: Date.now() });
        if (posBuffer.current.length > 20) posBuffer.current.shift();
      }
    }
  }, [canvasRef, drawOnlyActiveHand]);

  // ── MediaPipe result handler ──────────────────────────────────────────────
  const onResults = useCallback((results) => {
    const timestamp = performance.now();
    trackingTimestampRef.current = timestamp;
    if (results.multiHandLandmarks?.length > 0) {
      /* ── Pick the hand the child is actually playing with ────────────────
         Previously this was `multiHandLandmarks[0]`, i.e. whichever hand
         MediaPipe listed first — very often a hand resting on the face, which
         left the pointer frozen while the child waved the other one. */
      const picked = selectorRef.current.select(
        results.multiHandLandmarks,
        results.multiHandedness || [],
        timestamp
      );
      landmarksRef.current = picked.landmarks;
      activeHandKeyRef.current = picked.key;
      handStatusRef.current = picked.reason;
      frameSeqRef.current += 1;
      /* Draw after selection so the overlay can show only the hand that is
         actually in control — two skeletons on screen is the visual half of
         "it gets confused when both hands are up". */
      drawLandmarks(results, picked.index);

      // ── Séparer main gauche / droite via multiHandedness ─────────────────
      let leftHand  = null;
      let rightHand = null;
      const handedness = results.multiHandedness || [];
      results.multiHandLandmarks.forEach((lm, idx) => {
        // MediaPipe Hands retourne 'Left'/'Right' du point de vue de la caméra
        // (miroir) → on inverse pour obtenir la main réelle du sujet
        const label = handedness[idx]?.label;
        if (label === 'Left')  rightHand = lm;   // miroir caméra
        else if (label === 'Right') leftHand = lm;
        else leftHand = leftHand || lm; // fallback
      });

      multiHandDataRef.current = {
        left:  leftHand,
        right: rightHand,
        all:   results.multiHandLandmarks,
      };

      /* Publish LAST: it copies the refs into state, so every ref this frame
         writes has to be set before it runs, or the state mirror lags a frame
         behind the signal it is mirroring. */
      publish({ index: picked.index, tracking: true });
    } else {
      const picked = selectorRef.current.select([], [], timestamp);
      landmarksRef.current = null;
      multiHandDataRef.current = null;
      activeHandKeyRef.current = picked.key;
      handStatusRef.current = picked.reason;
      frameSeqRef.current += 1;
      drawLandmarks(results, -1);
      publish({ index: -1, tracking: false });
    }
  }, [drawLandmarks, publish]);

  // ── Initialize MediaPipe ──────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const init = async () => {
      try {
        // Dynamic import — MediaPipe loaded via CDN in index.html
        // In Docker: loaded from node_modules via package.json
        const { Hands, HAND_CONNECTIONS } = await import('@mediapipe/hands');
        const { Camera } = await import('@mediapipe/camera_utils');

        window.HAND_CONNECTIONS = HAND_CONNECTIONS;

        const hands = new Hands({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
        });

        /* A hand held further from the camera is a smaller hand in the frame,
           and a smaller hand scores lower. At 0.7 detection / 0.5 tracking a
           child sitting back was dropped and re-acquired several times a
           second, which is the other half of why the pointer felt heavy at
           distance: every drop restarts the filter downstream and blanks the
           pointer for the 400ms grace period. Letting a distant hand stay
           tracked costs some extra jitter, and rejecting jitter is exactly
           what handPointerFilter is for. */
        hands.setOptions({
          maxNumHands: maxHands,
          modelComplexity,
          minDetectionConfidence: 0.55,
          minTrackingConfidence: 0.40,
        });

        hands.onResults(onResults);
        handsRef.current = hands;

        if (!videoRef?.current) return;

        const camera = new Camera(videoRef.current, {
          onFrame: async () => {
            if (pauseProcessingRef.current) return; // Skip CPU processing if paused
            if (
              !cancelled &&
              handsRef.current &&
              videoRef.current &&
              videoRef.current.readyState >= 2 &&
              videoRef.current.videoWidth > 0 &&
              videoRef.current.videoHeight > 0
            ) {
              try {
                await handsRef.current.send({ image: videoRef.current });
              } catch (e) {
                console.warn('MediaPipe send error:', e);
              }
            }
          },
          width: 640,
          height: 480,
        });

        await camera.start();
        cameraRef.current = camera;

      } catch (err) {
        if (!cancelled) {
          console.warn('MediaPipe unavailable, using simulation mode:', err.message);
          setError('simulation');
          setIsTracking(false);
        }
      }
    };

    init();

    /* Stop the camera when tracking is disabled or the game unmounts.
       Also fired on pagehide so closing the tab mid-game releases the webcam
       instead of leaving the light on until the browser garbage-collects. */
    window.addEventListener('pagehide', releaseCamera);

    return () => {
      cancelled = true;
      window.removeEventListener('pagehide', releaseCamera);
      releaseCamera();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, onResults, videoRef, releaseCamera]);

  /* Belt and braces: whatever else happens, release the webcam when this
     component goes away. */
  useEffect(() => releaseCamera, [releaseCamera]);

  // ── Expose position buffer for smoothness calculations ───────────────────
  const getPositionBuffer = useCallback(() => posBuffer.current, []);
  const getIndexTipPosition = useCallback(() => {
    if (!landmarks) return null;
    return landmarks[LANDMARKS.INDEX_TIP] || null;
  }, [landmarks]);

  return {
    landmarks,          // 21 landmarks of the ACTIVE hand (see activeHandSelector)
    multiHandData,      // { left, right, all } — pour useReflexEngine
    activeHandIndex,    // index into multiHandData.all, or -1
    activeHandKey,      // persistent identity, retained through a brief detection loss
    trackingTimestamp, // performance.now() of the latest camera result, or null

    /* ── Full-rate signal, for consumers that drive a pointer ──────────────
       These update on EVERY camera result without re-rendering anything. A
       game that moves a cursor should read them from its own animation frame
       and ignore the state above, which is a throttled mirror meant for UI.
       `frameSeqRef` increments once per result: compare it with the last value
       you consumed to know whether there is a new sample to process. */
    landmarksRef,
    trackingTimestampRef,
    activeHandKeyRef,
    handStatusRef,
    frameSeqRef,
    /** Drop the current hand so the next frame re-acquires (swap hands). */
    releaseActiveHand: () => selectorRef.current?.releaseActiveHand(),
    handStatus,         // 'ok' | 'idle' | 'blink' | 'no-hand'
    /** Ready-to-show coaching line for the current tracking state. */
    handHint:
      handStatus === 'no-hand' ? 'Raise one hand in front of the camera'
      : handStatus === 'idle'  ? 'Move your hand to take control of the pointer'
      : null,
    isTracking,
    /* Lets a game force the webcam off the moment a round ends, without
       waiting for `enabled` to propagate. */
    releaseCamera,
    error,
    getPositionBuffer,
    getIndexTipPosition,
    isSimulationMode: error === 'simulation',
    positionBuffer: posBuffer,
  };
}
