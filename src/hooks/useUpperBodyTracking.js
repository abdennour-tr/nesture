/**
 * useUpperBodyTracking.js
 * ---------------------------------------------------------------------------
 * LAYER 1 of the touch-mode pipeline: camera → upper-body landmarks.
 *
 *   [CAPTURE] → features → indicators → score → export
 *
 * Runs MediaPipe Pose while a touch-mode round is in progress, records the
 * upper-body landmarks with timestamps, and hands the recording over when the
 * round ends. It does not interpret anything.
 *
 * THIS HOOK NEVER STARTS THE CAMERA BY ITSELF.
 * `enabled` has to be true, and the games only set it true after the child has
 * been asked (see components/game/PoseConsentPrompt.jsx). A recording hook that
 * could open a webcam on mount is one refactor away from doing it silently.
 *
 * WHY 15Hz AND NOT THE CAMERA'S 30
 * --------------------------------
 * Every feature this platform derives is either a posture held over seconds
 * (the ATNR and STNR correlations) or an event lasting about a second (the
 * startle shape). 15Hz gives 15 samples across a second-long event, which is
 * ample, and halves the stored volume. The camera still runs at its own rate;
 * frames between samples are dropped at capture, before anything is allocated.
 *
 * MEMORY
 * ------
 * Frames go into a flat numeric array in a compact, self-describing format
 * (see `SCHEMA`), not an array of objects. A ten-minute round is ~9,000 frames;
 * as `{x, y, z, visibility}` objects that would be ~190,000 short-lived objects
 * for the garbage collector to walk while a child is playing a game that needs
 * a steady frame rate.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { POSE, RECORDED_LANDMARKS, MIN_VISIBILITY } from '../services/pose/poseLandmarks';

/** Bump this if the frame encoding changes; the export reads it to decode. */
export const SCHEMA = 'nesture.pose.v1';

const DEFAULT_HZ = 15;
/** ~20 minutes at 15Hz. A guard against an abandoned tab recording forever. */
const MAX_FRAMES = 18000;

const r4 = (v) => Math.round((v || 0) * 1e4) / 1e4;
const r3 = (v) => Math.round((v || 0) * 1e3) / 1e3;
const r2 = (v) => Math.round((v || 0) * 1e2) / 1e2;

/* Bones drawn between the points this platform actually records (see
   poseLandmarks.js) — nothing hip-down, since nothing hip-down is recorded
   either. Same idea as useHandTracking's skeleton: show exactly what is
   being kept, not the model's full 33-point output. */
const SKELETON_CONNECTIONS = [
  [POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER],
  [POSE.LEFT_SHOULDER, POSE.LEFT_ELBOW], [POSE.LEFT_ELBOW, POSE.LEFT_WRIST],
  [POSE.RIGHT_SHOULDER, POSE.RIGHT_ELBOW], [POSE.RIGHT_ELBOW, POSE.RIGHT_WRIST],
  [POSE.LEFT_SHOULDER, POSE.LEFT_HIP], [POSE.RIGHT_SHOULDER, POSE.RIGHT_HIP],
  [POSE.LEFT_HIP, POSE.RIGHT_HIP],
  [POSE.LEFT_WRIST, POSE.LEFT_INDEX], [POSE.LEFT_WRIST, POSE.LEFT_THUMB],
  [POSE.LEFT_WRIST, POSE.LEFT_PINKY],
  [POSE.RIGHT_WRIST, POSE.RIGHT_INDEX], [POSE.RIGHT_WRIST, POSE.RIGHT_THUMB],
  [POSE.RIGHT_WRIST, POSE.RIGHT_PINKY],
];

/** Bigger, highlighted dots — the joints the ATNR/STNR features are built
    from — vs. small dots for the rest of the recorded set (face, fingers). */
const KEY_LANDMARKS = new Set([
  POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER,
  POSE.LEFT_ELBOW, POSE.RIGHT_ELBOW,
  POSE.LEFT_WRIST, POSE.RIGHT_WRIST,
]);

/**
 * @param {React.RefObject} videoRef  a <video> element to attach the camera to
 * @param {React.RefObject} [canvasRef] optional — when given, the same
 *   skeleton every camera-mode game draws (dots + bones) is drawn on it every
 *   frame, so the touch-mode camera frame shows exactly what is being read,
 *   not just a badge saying it's on.
 * @param {Object} options
 * @param {boolean} options.enabled   consent given AND the round is running
 * @param {number}  options.sampleHz
 * @param {string}  options.gameId    recorded with the session, for the dataset
 */
export default function useUpperBodyTracking(videoRef, canvasRef, {
  enabled = false,
  sampleHz = DEFAULT_HZ,
  gameId = null,
} = {}) {
  const [isTracking, setIsTracking] = useState(false);
  const [error, setError] = useState(null);
  /* Published a few times a second only — the frame counter is for a status
     line, and re-rendering a game on every camera frame to move a number is
     the mistake that made the hand pointer heavy (see useHandTracking). */
  const [frameCount, setFrameCount] = useState(0);

  const poseRef = useRef(null);
  const cameraRef = useRef(null);
  const framesRef = useRef([]);
  const startedAtRef = useRef(null);
  const lastSampleRef = useRef(0);
  const droppedRef = useRef(0);
  const lastPublishRef = useRef(0);
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  const minIntervalMs = 1000 / Math.max(1, sampleHz);

  const reset = useCallback(() => {
    framesRef.current = [];
    startedAtRef.current = null;
    lastSampleRef.current = 0;
    droppedRef.current = 0;
    setFrameCount(0);
  }, []);

  /* ── Releasing the webcam ────────────────────────────────────────────────
     MediaPipe's Camera.stop() only stops its own frame pump; the MediaStream
     stays open and the privacy light stays on. The tracks have to be stopped
     explicitly. Same fix as useHandTracking — and it matters more here, where
     the camera is on during a mode the child thinks of as "not the camera one". */
  const releaseCamera = useCallback(() => {
    if (cameraRef.current) {
      try { cameraRef.current.stop(); } catch { /* already stopped */ }
      cameraRef.current = null;
    }
    const video = videoRef?.current;
    const stream = video?.srcObject;
    if (stream && typeof stream.getTracks === 'function') {
      stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* done */ } });
    }
    if (video) {
      try {
        video.pause();
        video.srcObject = null;
        video.removeAttribute('src');
        video.load();
      } catch { /* detached */ }
    }
    /* Otherwise the last frame's skeleton sits there, over a frozen or blank
       video, looking like tracking that is still running after it isn't. */
    const canvas = canvasRef?.current;
    if (canvas) {
      try { canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height); }
      catch { /* detached */ }
    }
    setIsTracking(false);
  }, [videoRef, canvasRef]);

  /* ── Draw the skeleton on canvas ──────────────────────────────────────────
     Same technique as useHandTracking's drawLandmarks: cleared and redrawn
     every frame, coordinates used as-is (fractions of the canvas' own
     width/height) — mirroring is handled once, in CSS, on the <video> and
     <canvas> together, same as every camera-mode game already does. */
  const drawSkeleton = useCallback((lm) => {
    const canvas = canvasRef?.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!lm) return;

    const visible = (i) => {
      const p = lm[i];
      return p && (p.visibility == null || p.visibility >= MIN_VISIBILITY);
    };

    ctx.strokeStyle = 'rgba(13,94,107,0.6)';
    ctx.lineWidth = 2;
    for (const [a, b] of SKELETON_CONNECTIONS) {
      if (!visible(a) || !visible(b)) continue;
      ctx.beginPath();
      ctx.moveTo(lm[a].x * canvas.width, lm[a].y * canvas.height);
      ctx.lineTo(lm[b].x * canvas.width, lm[b].y * canvas.height);
      ctx.stroke();
    }

    for (const i of RECORDED_LANDMARKS) {
      if (!visible(i)) continue;
      const p = lm[i];
      const isKey = KEY_LANDMARKS.has(i);
      ctx.beginPath();
      ctx.arc(p.x * canvas.width, p.y * canvas.height, isKey ? 5 : 2, 0, 2 * Math.PI);
      ctx.fillStyle = isKey ? '#E8841A' : 'rgba(200,232,237,0.6)';
      ctx.fill();
    }
  }, [canvasRef]);

  const onResults = useCallback((results) => {
    const lm = results?.poseLandmarks;
    /* Drawn regardless of `enabledRef` staleness below — the frame is a live
       view of what the camera sees right now, not part of the recording, so
       it has nothing to gain from waiting on the same guard the capture
       logic uses. If the round has actually ended the camera is already
       being released (see releaseCamera) and onResults stops firing. */
    drawSkeleton(lm);

    if (!enabledRef.current) return;
    if (!lm) return;

    const now = performance.now();
    if (startedAtRef.current == null) startedAtRef.current = now;

    // Decimate to the sample rate before allocating anything.
    if (now - lastSampleRef.current < minIntervalMs) return;
    lastSampleRef.current = now;

    if (framesRef.current.length >= MAX_FRAMES) {
      droppedRef.current += 1;
      return;
    }

    /* One flat row: [tMs, x,y,z,visibility per recorded landmark].
       Rounded at capture — four decimals on a 0..1 coordinate is finer than
       the model's own precision, and it roughly halves the stored size. */
    const row = new Array(1 + RECORDED_LANDMARKS.length * 4);
    row[0] = Math.round(now - startedAtRef.current);
    let k = 1;
    for (const idx of RECORDED_LANDMARKS) {
      const p = lm[idx];
      if (p) {
        row[k] = r4(p.x); row[k + 1] = r4(p.y);
        row[k + 2] = r3(p.z); row[k + 3] = r2(p.visibility);
      } else {
        row[k] = null; row[k + 1] = null; row[k + 2] = null; row[k + 3] = 0;
      }
      k += 4;
    }
    framesRef.current.push(row);

    if (now - lastPublishRef.current > 500) {
      lastPublishRef.current = now;
      setFrameCount(framesRef.current.length);
    }
  }, [minIntervalMs, drawSkeleton]);

  // ── Start / stop with `enabled` ──────────────────────────────────────────
  useEffect(() => {
    if (!enabled) { releaseCamera(); return undefined; }

    let cancelled = false;

    (async () => {
      try {
        const { Pose } = await import('@mediapipe/pose');
        const { Camera } = await import('@mediapipe/camera_utils');
        if (cancelled) return;

        /* Built once and kept for the life of the hook. Constructing a Pose per
           round and close()-ing it between rounds races its own asset loader:
           close() frees the state that the packed-assets XHR then writes into,
           which surfaces as "Cannot set properties of undefined (setting
           'loaded')". Rounds now reuse one instance; only the camera stops. */
        if (!poseRef.current) {
          const pose = new Pose({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
          });
          /* modelComplexity 1: the lite model loses elbow precision, and elbow
             angle is the single most important input to the ATNR and STNR
             features. This runs at 15Hz on one camera, so the extra cost is
             affordable in a way it would not be for a 30Hz pointer. */
          pose.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            enableSegmentation: false,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
          poseRef.current = pose;
        }
        /* Rebound every run: onResults changes identity with its deps. */
        poseRef.current.onResults(onResults);

        if (!videoRef?.current) return;
        const camera = new Camera(videoRef.current, {
          onFrame: async () => {
            if (!enabledRef.current || !poseRef.current) return;
            const v = videoRef.current;
            if (!v || v.readyState < 2 || !v.videoWidth) return;
            try { await poseRef.current.send({ image: v }); }
            catch (e) { console.warn('[pose] send failed:', e?.message); }
          },
          width: 640,
          height: 480,
        });
        await camera.start();
        if (cancelled) { try { camera.stop(); } catch { /* noop */ } return; }
        cameraRef.current = camera;
        setIsTracking(true);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.warn('[pose] unavailable:', err?.message);
        setError(err?.message || 'pose-unavailable');
        setIsTracking(false);
      }
    })();

    window.addEventListener('pagehide', releaseCamera);
    return () => {
      cancelled = true;
      window.removeEventListener('pagehide', releaseCamera);
      releaseCamera();
    };
  }, [enabled, onResults, releaseCamera, videoRef]);

  /* Belt and braces: the webcam goes off when this component does — and this is
     the one place the Pose instance is actually destroyed, since the component
     is going away and nothing will write into it afterwards. */
  useEffect(() => () => {
    releaseCamera();
    if (poseRef.current) {
      try { poseRef.current.close(); } catch { /* already closed */ }
      poseRef.current = null;
    }
  }, [releaseCamera]);

  /**
   * The finished recording, in the compact self-describing format the export
   * decodes. Returns null when nothing usable was captured — never an empty
   * shell that would look like a session with no movement.
   */
  const getRecording = useCallback(() => {
    const frames = framesRef.current;
    if (!frames.length) return null;
    return {
      schema: SCHEMA,
      gameId,
      sampleHz,
      landmarks: RECORDED_LANDMARKS,
      /** Column meaning for each landmark, in order, after the leading t. */
      fields: ['x', 'y', 'z', 'visibility'],
      frameCount: frames.length,
      durationMs: frames[frames.length - 1][0],
      droppedFrames: droppedRef.current,
      recordedAt: new Date().toISOString(),
      frames,
    };
  }, [gameId, sampleHz]);

  return {
    isTracking,
    error,
    frameCount,
    getRecording,
    reset,
    releaseCamera,
    /** True when the camera could not start — the game plays on regardless. */
    unavailable: !!error,
  };
}
