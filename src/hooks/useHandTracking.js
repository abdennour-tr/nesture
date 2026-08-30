/**
 * useHandTracking.js
 * Custom React hook wrapping Google MediaPipe Hands.
 * Falls back to simulation mode if camera is unavailable.
 *
 * Usage:
 *   const { landmarks, isTracking, error } = useHandTracking(videoRef, canvasRef, enabled);
 */
import { useState, useEffect, useRef, useCallback } from 'react';

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
export default function useHandTracking(videoRef, canvasRef, enabled = true, pauseProcessing = false) {
  const [landmarks,      setLandmarks]      = useState(null);  // main détectée (1re)
  const [multiHandData,  setMultiHandData]  = useState(null);  // { left, right, all }
  const [isTracking,     setIsTracking]     = useState(false);
  const [error,          setError]          = useState(null);
  
  // Ref to hold the latest pauseProcessing value for the async callback
  const pauseProcessingRef = useRef(pauseProcessing);
  useEffect(() => {
    pauseProcessingRef.current = pauseProcessing;
  }, [pauseProcessing]);

  const handsRef   = useRef(null);
  const cameraRef  = useRef(null);
  const rafRef     = useRef(null);
  const posBuffer  = useRef([]);   // Rolling buffer of index tip positions

  // ── Draw landmarks on canvas ─────────────────────────────────────────────
  const drawLandmarks = useCallback((results) => {
    const canvas = canvasRef?.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!results.multiHandLandmarks?.length) return;

    for (const handLandmarks of results.multiHandLandmarks) {
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
  }, [canvasRef]);

  // ── MediaPipe result handler ──────────────────────────────────────────────
  const onResults = useCallback((results) => {
    drawLandmarks(results);
    if (results.multiHandLandmarks?.length > 0) {
      setLandmarks(results.multiHandLandmarks[0]);
      setIsTracking(true);

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

      setMultiHandData({
        left:  leftHand,
        right: rightHand,
        all:   results.multiHandLandmarks,
      });
    } else {
      setLandmarks(null);
      setMultiHandData(null);
      setIsTracking(false);
    }
  }, [drawLandmarks]);

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

        hands.setOptions({
          maxNumHands: 2,           // ← les deux mains pour le moteur de réflexes
          modelComplexity: 1,
          minDetectionConfidence: 0.7,
          minTrackingConfidence: 0.5,
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

    return () => {
      cancelled = true;
      if (cameraRef.current) {
        try { cameraRef.current.stop(); } catch {}
      }
      if (handsRef.current) {
        try { handsRef.current.close(); } catch {}
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, onResults, videoRef]);

  // ── Expose position buffer for smoothness calculations ───────────────────
  const getPositionBuffer = useCallback(() => posBuffer.current, []);
  const getIndexTipPosition = useCallback(() => {
    if (!landmarks) return null;
    return landmarks[LANDMARKS.INDEX_TIP] || null;
  }, [landmarks]);

  return {
    landmarks,          // 21 landmarks de la 1re main détectée (pour dwell cursor)
    multiHandData,      // { left, right, all } — pour useReflexEngine
    isTracking,
    error,
    getPositionBuffer,
    getIndexTipPosition,
    isSimulationMode: error === 'simulation',
    positionBuffer: posBuffer,
  };
}
