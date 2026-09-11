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
import { RECORDED_LANDMARKS } from '../services/pose/poseLandmarks';

/** Bump this if the frame encoding changes; the export reads it to decode. */
export const SCHEMA = 'nesture.pose.v1';

const DEFAULT_HZ = 15;
/** ~20 minutes at 15Hz. A guard against an abandoned tab recording forever. */
const MAX_FRAMES = 18000;

const r4 = (v) => Math.round((v || 0) * 1e4) / 1e4;
const r3 = (v) => Math.round((v || 0) * 1e3) / 1e3;
const r2 = (v) => Math.round((v || 0) * 1e2) / 1e2;

/**
 * @param {React.RefObject} videoRef  a <video> element to attach the camera to
 * @param {Object} options
 * @param {boolean} options.enabled   consent given AND the round is running
 * @param {number}  options.sampleHz
 * @param {string}  options.gameId    recorded with the session, for the dataset
 */
export default function useUpperBodyTracking(videoRef, {
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
    if (poseRef.current) {
      try { poseRef.current.close(); } catch { /* already closed */ }
      poseRef.current = null;
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
    setIsTracking(false);
  }, [videoRef]);

  const onResults = useCallback((results) => {
    if (!enabledRef.current) return;
    const lm = results?.poseLandmarks;
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
  }, [minIntervalMs]);

  // ── Start / stop with `enabled` ──────────────────────────────────────────
  useEffect(() => {
    if (!enabled) { releaseCamera(); return undefined; }

    let cancelled = false;

    (async () => {
      try {
        const { Pose } = await import('@mediapipe/pose');
        const { Camera } = await import('@mediapipe/camera_utils');
        if (cancelled) return;

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
        pose.onResults(onResults);
        poseRef.current = pose;

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

  // Belt and braces: the webcam goes off when this component does.
  useEffect(() => releaseCamera, [releaseCamera]);

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
