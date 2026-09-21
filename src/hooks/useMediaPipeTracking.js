/**
 * useMediaPipeTracking.js
 * Hook unifié — UNE seule caméra, deux modèles MediaPipe.
 *
 * Remplace useHandTracking + useFaceMesh dans GamePage.
 * Le Face Mesh est throttlé à 1 frame sur FACE_THROTTLE pour économiser le CPU.
 *
 * Retourne :
 *   landmarks      — 21 pts main principale (dwell cursor)
 *   multiHandData  — { left, right }
 *   faceLandmarks  — 468 pts visage
 *   headPose       — { pitch, yaw }
 *   mouthOpen      — 0–1
 *   isTracking
 *   positionBuffer
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import createActiveHandSelector from '../utils/activeHandSelector';

export { LANDMARKS, calculateSmoothness, landmarkDistance,
         getPointingVector, isIndexPointing, getPalmCenter,
         isGripping, detectMidlineCrossing } from './useHandTracking';

// ── Face Mesh : indices landmarks importants ───────────────────────────────
const NOSE_TIP   = 1;
const CHIN       = 152;
const FOREHEAD   = 10;
const LEFT_EYE_INNER  = 133;
const RIGHT_EYE_INNER = 362;
const MOUTH_TOP  = 13;
const MOUTH_BOT  = 14;

// ── Performance : traiter le Face Mesh 1 frame sur N ──────────────────────
const FACE_THROTTLE = 5; // 30fps → Face Mesh à ~6fps (largement suffisant pour l'analyse de réflexes)

/* ── Coverage grid ─────────────────────────────────────────────────────────
   The calibration screen asks the child to sweep their whole reach. To know
   whether they actually did — instead of trusting a timer — the camera frame
   is divided into a grid and each cell is marked as the hand passes through
   it. The screen draws this grid, so "move your hand around" stops being an
   instruction the child has to interpret and becomes a visible target. */
export const CAL_COLS = 4;
export const CAL_ROWS = 3;
/* The sweep is judged over the middle of the frame: the extreme edges are
   often out of a seated child's comfortable reach and demanding them would
   punish the children this app exists for. */
const CAL_GRID_X0 = 0.12, CAL_GRID_X1 = 0.88;
const CAL_GRID_Y0 = 0.15, CAL_GRID_Y1 = 0.92;

function coverageCellIndex(x, y) {
  const cx = (x - CAL_GRID_X0) / (CAL_GRID_X1 - CAL_GRID_X0);
  const cy = (y - CAL_GRID_Y0) / (CAL_GRID_Y1 - CAL_GRID_Y0);
  if (cx < 0 || cx >= 1 || cy < 0 || cy >= 1) return -1;
  const col = Math.min(CAL_COLS - 1, Math.floor(cx * CAL_COLS));
  const row = Math.min(CAL_ROWS - 1, Math.floor(cy * CAL_ROWS));
  return row * CAL_COLS + col;
}

// ── Estimation Pitch / Yaw ────────────────────────────────────────────────
function estimateHeadPose(lm) {
  if (!lm || lm.length < 468) return { pitch: 0, yaw: 0 };
  const noseTip  = lm[NOSE_TIP];
  const forehead = lm[FOREHEAD];
  const chin     = lm[CHIN];
  const leftEye  = lm[LEFT_EYE_INNER];
  const rightEye = lm[RIGHT_EYE_INNER];
  if (!noseTip || !chin || !forehead || !leftEye || !rightEye) return { pitch: 0, yaw: 0 };

  const eyeMidX    = (leftEye.x + rightEye.x) / 2;
  const eyeDist    = Math.abs(rightEye.x - leftEye.x) || 0.001;
  const yaw        = ((noseTip.x - eyeMidX) / eyeDist) * 90;

  const vCenter    = (forehead.y + chin.y) / 2;
  const faceH      = Math.abs(chin.y - forehead.y) || 0.001;
  const pitch      = ((noseTip.y - vCenter) / faceH) * -90;

  return {
    pitch: Math.max(-45, Math.min(45, pitch)),
    yaw:   Math.max(-45, Math.min(45, yaw)),
  };
}

function computeMouthOpen(lm) {
  if (!lm || lm.length < 468) return 0;
  const top  = lm[MOUTH_TOP];
  const bot  = lm[MOUTH_BOT];
  const face = lm[FOREHEAD];
  const chin = lm[CHIN];
  if (!top || !bot || !face || !chin) return 0;
  const opening   = Math.abs(bot.y - top.y);
  const faceH     = Math.abs(chin.y - face.y) || 0.001;
  return Math.min(1, opening / faceH);
}

// ── Dessin landmarks visage ────────────────────────────────────────────────
// Points clés affichés : contour visage, yeux, nez, bouche, iris
const FACE_KEY_POINTS = [
  // Contour du visage
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
  // Yeux
  33, 7, 163, 144, 145, 153, 154, 155, 133,
  362, 382, 381, 380, 374, 373, 390, 249, 263,
  // Sourcils
  46, 53, 52, 65, 55, 285, 295, 282, 283, 276,
  // Nez
  1, 2, 98, 327,
  // Bouche
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291,
  375, 321, 405, 314, 17, 84, 181, 91, 146,
  // Iris (disponibles avec refineLandmarks)
  468, 469, 470, 471, 472,  // iris gauche
  473, 474, 475, 476, 477,  // iris droit
];

function drawFaceLandmarks(faceLm, canvas) {
  if (!canvas || !faceLm || faceLm.length < 468) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;

  // Effacer les anciens points avant de dessiner les nouveaux
  ctx.clearRect(0, 0, w, h);

  for (const idx of FACE_KEY_POINTS) {
    const p = faceLm[idx];
    if (!p) continue;
    const isIris = idx >= 468;
    const x = p.x * w, y = p.y * h;
    ctx.beginPath();
    ctx.arc(x, y, isIris ? 3 : 1.5, 0, 2 * Math.PI);
    ctx.fillStyle = isIris
      ? 'rgba(255, 200, 0, 0.9)'       // iris : jaune
      : 'rgba(34, 211, 238, 0.65)';    // visage : cyan
    ctx.fill();
  }
}

function drawHandLandmarks(results, canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!results.multiHandLandmarks?.length) return;

  for (const handLandmarks of results.multiHandLandmarks) {
    ctx.strokeStyle = 'rgba(13,94,107,0.6)';
    ctx.lineWidth = 2;
    const connections = window.HAND_CONNECTIONS || [];
    for (const [s, e] of connections) {
      const a = handLandmarks[s], b = handLandmarks[e];
      if (a && b) {
        ctx.beginPath();
        ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
        ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
        ctx.stroke();
      }
    }
    for (let i = 0; i < handLandmarks.length; i++) {
      const p = handLandmarks[i];
      ctx.beginPath();
      ctx.arc(p.x * canvas.width, p.y * canvas.height, [4,8,12,16,20].includes(i) ? 5 : 2, 0, 2 * Math.PI);
      ctx.fillStyle = [4,8,12,16,20].includes(i) ? '#E8841A' : 'rgba(200,232,237,0.6)';
      ctx.fill();
    }
  }
}

// ── Hook principal ─────────────────────────────────────────────────────────
/**
 * @param {object} [options]
 * @param {boolean} [options.handSideLock]  One hand plays: the SIDE (right or
 *   left) of the first hand seen owns the round and only that hand drives the
 *   cursor. Client feedback: a learner who shakes the other hand (excited or
 *   nervous) had the cursor jump to it, because this hook used whichever hand
 *   MediaPipe happened to list first. See utils/activeHandSelector.js — the
 *   same lock Pinch the Coin uses.
 */
export default function useMediaPipeTracking(videoRef, canvasRef, enabled = true, options = {}) {
  const { handSideLock = false } = options;

  /* Read from the camera callback, which must keep a stable identity (it is
     handed to MediaPipe once), so the flag travels by ref. */
  const handSideLockRef = useRef(handSideLock);
  useEffect(() => { handSideLockRef.current = handSideLock; }, [handSideLock]);

  const handSelectorRef = useRef(null);
  if (!handSelectorRef.current) {
    handSelectorRef.current = createActiveHandSelector({ handSideLock: true });
  }

  const [landmarks,     setLandmarks]     = useState(null);
  const [multiHandData, setMultiHandData] = useState(null);
  const [faceLandmarks, setFaceLandmarks] = useState(null);
  const [headPose,      setHeadPose]      = useState({ pitch: 0, yaw: 0 });
  const [mouthOpen,     setMouthOpen]     = useState(0);
  const [isTracking,    setIsTracking]    = useState(false);
  const [error,         setError]         = useState(null);

  // --- Telemetry States ---
  const [calibrationStatus, setCalibrationStatus] = useState('Calibrating...');
  /* 0..1 — what the progress bar shows. It is real: it tracks the samples
     collected and the range actually covered, not a fixed animation. */
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [trackingConfidence, setTrackingConfidence] = useState(100);
  const [gazeDetected, setGazeDetected] = useState(false);
  const [fps, setFps] = useState(30);
  const [smoothedCursorPos, setSmoothedCursorPos] = useState({ x: 0.5, y: 0.5 });

  /* ── Calibration screen support ────────────────────────────────────────
     The calibration used to be an invisible 3s process running underneath a
     game that had already started. It is now something a dedicated screen can
     drive and, above all, SHOW: the raw (uncalibrated, mirrored) hand position
     so the screen can draw where the hand really is, a coverage grid so the
     child can see which parts of their reach are still missing, how many hands
     are in frame, and how far away the child is sitting. */
  const [rawCursorPos, setRawCursorPos]   = useState({ x: 0.5, y: 0.5 });
  const [handCount, setHandCount]         = useState(0);
  const [coverageCells, setCoverageCells] = useState(() => new Array(CAL_COLS * CAL_ROWS).fill(false));
  const [distanceFactorState, setDistanceFactorState] = useState(1);
  const coverageRef = useRef(new Array(CAL_COLS * CAL_ROWS).fill(false));
  const lastDistanceFactor = useRef(1);
  /* Bounds are mirrored into state only when calibration commits, so a caller
     can persist them per learner and restore them next session. */
  const [calibrationBounds, setCalibrationBounds] = useState(null);

  // --- Auto-Calibration & Filter Refs ---
  const calibMinX = useRef(0.35);
  const calibMaxX = useRef(0.65);
  const calibMinY = useRef(0.4);
  const calibMaxY = useRef(0.75);
  
  const trackingLossTimer = useRef(null);
  const isCalibrating = useRef(true);

  /* ── Calibration accumulators ──────────────────────────────────────────
     Calibration used to be a 3-second setTimeout. It declared success after
     three seconds of WALL CLOCK whether or not a single hand frame had
     arrived, so `recalibrate()` fired with no hand in view would "finish"
     against the default bounds and leave the cursor mapped to a tiny box in
     the middle of the frame. On a slow laptop (the field reports run at
     10-15 fps) three seconds is barely thirty frames, and the hand often
     appears only for the last one of them.

     It is now measured, not timed: calibration ends when enough frames WITH
     a hand have been seen AND the hand has actually swept a usable range.
     The bounds come from that observed range instead of a fixed window
     centred on wherever the hand happened to be. */
  const calibSamples   = useRef(0);
  const calibStartedAt = useRef(null);
  const obsMinX = useRef(1);
  const obsMaxX = useRef(0);
  const obsMinY = useRef(1);
  const obsMaxY = useRef(0);

  const lastSmoothX = useRef(null);
  const lastSmoothY = useRef(null);

  /* ── Per-frame values live in refs, not in state ────────────────────────
     The cursor position, the confidence and the frame rate change on EVERY
     camera frame. Publishing each one through useState made this hook fire
     three or four re-renders of its consumer thirty times a second — which is
     what made the calibration dot feel heavy: it was not the dot moving, it
     was the whole screen re-rendering under it.

     The refs below carry the full-rate signal for anything that reads them
     from its own animation frame. The matching state is still published, but
     only a few times a second, so components that render from state keep
     working without paying for it sixty times a second. */
  const rawCursorRef      = useRef({ x: 0.5, y: 0.5 });
  const smoothedCursorRef = useRef({ x: 0.5, y: 0.5 });
  const confidenceRef     = useRef(100);
  const lastPublishAt     = useRef(0);
  const lastPublishedConf = useRef(100);
  const lastPublishedFps  = useRef(30);
  const lastFpsPublishAt  = useRef(0);
  const PUBLISH_INTERVAL_MS = 120;   // ~8 Hz for the state mirrors
  
  const faceLandmarksRef = useRef(null);
  const gazeDetectedRef = useRef(false);

  const handsRef    = useRef(null);
  const faceMeshRef = useRef(null);
  const cameraRef   = useRef(null);
  const frameCount  = useRef(0);
  const posBuffer   = useRef([]);
  // Canvas dédié au visage — créé en interne, jamais effacé par le tracking Hands
  const faceCanvasRef = useRef(null);

  const fpsRef = useRef(30);
  const lastFrameTime = useRef(performance.now());

  /* Frames WITH a hand that must be collected. At 12 fps this is ~3.5s of
     actual hand time; at 30 fps, ~1.5s. Time no longer enters into it. */
  const CALIB_MIN_SAMPLES = 42;
  /* The hand must sweep at least this much of the camera frame on each axis,
     otherwise the mapping is built from a point and becomes hypersensitive. */
  const CALIB_MIN_SPAN = 0.12;
  /* A child who will not wave should still get to play: after this much time
     WITH A HAND VISIBLE, accept whatever range was covered and widen it to a
     sane minimum. */
  const CALIB_MAX_MS = 12000;
  /* Never map the screen onto less than this much camera space. */
  const CALIB_FLOOR_SPAN = 0.20;
  /* Fraction of the coverage grid the sweep has to visit. Not all twelve
     cells: the corners of the grid are the hardest to reach and holding a
     child there is how a calibration screen becomes a wall. */
  const CAL_MIN_COVERAGE = 0.75;

  // --- Manual Recalibrate function ---
  const recalibrate = useCallback(() => {
    isCalibrating.current = true;
    setCalibrationStatus('Calibrating...');
    setCalibrationProgress(0);

    // Reset limits so the new sweep is not blended with the old one.
    calibMinX.current = 0.35;
    calibMaxX.current = 0.65;
    calibMinY.current = 0.4;
    calibMaxY.current = 0.75;
    lastSmoothX.current = null;
    lastSmoothY.current = null;

    /* Inverted extremes: the first sample sets both ends. Nothing is timed
       here -- with no hand in front of the camera, calibration simply waits
       instead of quietly "succeeding" on the defaults. */
    calibSamples.current = 0;
    calibStartedAt.current = null;
    obsMinX.current = 1; obsMaxX.current = 0;
    obsMinY.current = 1; obsMaxY.current = 0;

    coverageRef.current = new Array(CAL_COLS * CAL_ROWS).fill(false);
    setCoverageCells(coverageRef.current.slice());
    setCalibrationBounds(null);
  }, []);

  /* ── Commit the calibration on demand ───────────────────────────────────
     Two callers need this. The calibration screen calls it when the child has
     swept enough, so the transition into the game is a deliberate, visible
     event rather than something that happens silently mid-word. A therapist
     or parent calls it through "use it as is" for a child who will not or
     cannot sweep the full area — they still get to play, with the mapping
     honestly limited to the reach that was actually observed. */
  const finalizeCalibration = useCallback(() => {
    if (!isCalibrating.current) return calibrationBounds;
    /* Nothing was ever seen: refuse rather than commit the default box, which
       is the failure mode that made the cursor unusable in the first place. */
    if (calibSamples.current < 5) return null;

    const spanX = Math.max(0, obsMaxX.current - obsMinX.current);
    const spanY = Math.max(0, obsMaxY.current - obsMinY.current);
    const padX = Math.max(0.03, spanX * 0.12);
    const padY = Math.max(0.03, spanY * 0.12);
    let minX = obsMinX.current - padX;
    let maxX = obsMaxX.current + padX;
    let minY = obsMinY.current - padY;
    let maxY = obsMaxY.current + padY;

    const floor = CALIB_FLOOR_SPAN * lastDistanceFactor.current;
    if (maxX - minX < floor) { const c = (minX + maxX) / 2; minX = c - floor / 2; maxX = c + floor / 2; }
    if (maxY - minY < floor) { const c = (minY + maxY) / 2; minY = c - floor / 2; maxY = c + floor / 2; }

    const bounds = {
      minX: Math.max(0.01, minX), maxX: Math.min(0.99, maxX),
      minY: Math.max(0.01, minY), maxY: Math.min(0.99, maxY),
      spanX, spanY,
      samples: calibSamples.current,
      coverage: coverageRef.current.filter(Boolean).length / (CAL_COLS * CAL_ROWS),
      savedAt: Date.now(),
    };

    calibMinX.current = bounds.minX; calibMaxX.current = bounds.maxX;
    calibMinY.current = bounds.minY; calibMaxY.current = bounds.maxY;
    isCalibrating.current = false;
    setCalibrationProgress(1);
    setCalibrationStatus('Calibrated');
    setCalibrationBounds(bounds);
    return bounds;
  }, [calibrationBounds]);

  /* Restore a calibration measured in an earlier session. The child sits in
     roughly the same place every day; making them sweep from scratch each
     time is friction with no clinical value. The calibration screen still
     runs, but it starts already satisfied and only has to confirm the hand
     is tracked. */
  const applyCalibration = useCallback((bounds) => {
    if (!bounds || typeof bounds.minX !== 'number') return false;
    if (!(bounds.maxX > bounds.minX) || !(bounds.maxY > bounds.minY)) return false;
    calibMinX.current = bounds.minX; calibMaxX.current = bounds.maxX;
    calibMinY.current = bounds.minY; calibMaxY.current = bounds.maxY;
    lastSmoothX.current = null; lastSmoothY.current = null;
    isCalibrating.current = false;
    setCalibrationProgress(1);
    setCalibrationStatus('Calibrated');
    setCalibrationBounds(bounds);
    return true;
  }, []);

  // ── Callback Hands ─────────────────────────────────────────────────────
  const onHandResults = useCallback((results) => {
    drawHandLandmarks(results, canvasRef?.current);

    if (results.multiHandLandmarks?.length > 0) {
      if (trackingLossTimer.current) {
        clearTimeout(trackingLossTimer.current);
        trackingLossTimer.current = null;
      }

      /* The calibration clock starts on the first frame that actually has a
         hand in it, not when the hook mounts. */
      if (isCalibrating.current && calibStartedAt.current === null) {
        calibStartedAt.current = Date.now();
        setCalibrationStatus('Calibrating...');
      }

      /* WHICH hand drives the cursor. Without the lock this was
         `multiHandLandmarks[0]` — whichever hand MediaPipe listed first, which
         changes from frame to frame and is very often the hand that is NOT
         playing. With it, the first hand seen keeps the round. */
      const picked = handSideLockRef.current
        ? handSelectorRef.current.select(
            results.multiHandLandmarks, results.multiHandedness || [], performance.now())
        : null;
      const first = handSideLockRef.current ? picked?.landmarks : results.multiHandLandmarks[0];

      /* The locked hand is not in this frame (it left, or it blinked out).
         Hand nothing to the game rather than the other hand, and let the same
         400ms grace below cover a blip. */
      if (!first) {
        if (!trackingLossTimer.current) {
          trackingLossTimer.current = setTimeout(() => {
            setLandmarks(null);
            setMultiHandData(null);
            setIsTracking(false);
            setTrackingConfidence(0);
            setHandCount(0);
          }, 400);
        }
        return;
      }

      setLandmarks(first);
      setIsTracking(true);
      setHandCount(results.multiHandLandmarks.length);

      // Track position buffer (index tip)
      const indexTip = first[8];
      if (indexTip) {
        posBuffer.current.push({ x: indexTip.x, y: indexTip.y, t: Date.now() });
        if (posBuffer.current.length > 20) posBuffer.current.shift();

        // ── Mirrored raw coords ──
        const mirroredX = 1 - indexTip.x;
        const mirroredY = indexTip.y;

        /* The uncalibrated position, published so the calibration screen can
           draw the hand before any mapping exists. During calibration the
           calibrated position is meaningless by definition, so a screen that
           drew only that would show the child a cursor that does not follow
           their hand — the exact confusion the new screen removes.
           Written to a ref every frame; the state mirror is throttled below. */
        rawCursorRef.current = { x: mirroredX, y: mirroredY };

        // ── Distance Scale Adjustment ──
        /* The face mesh runs at a fifth of the hand rate and can be absent for
           whole seconds. Falling back to 1.0 in those frames made the mapping
           floor jump between two values within a single calibration; the last
           good measurement is used instead. */
        let distanceFactor = lastDistanceFactor.current;
        if (faceLandmarksRef.current) {
          const faceLm = faceLandmarksRef.current;
          const leftEye = faceLm[LEFT_EYE_INNER];
          const rightEye = faceLm[RIGHT_EYE_INNER];
          if (leftEye && rightEye) {
            const eyeDist = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
            // 0.085 is the standard eye distance in camera space at 50-60cm.
            distanceFactor = Math.max(0.4, Math.min(2.5, eyeDist / 0.085));
            if (Math.abs(distanceFactor - lastDistanceFactor.current) > 0.02) {
              setDistanceFactorState(distanceFactor);
            }
            lastDistanceFactor.current = distanceFactor;
          }
        }

        // Update bounds
        if (isCalibrating.current) {
          /* Record the reach the child actually has, rather than bracketing a
             fixed window around wherever the hand is right now. A window
             centred on a hand held near the edge of the frame maps the whole
             screen onto that corner for the rest of the session -- which is
             exactly what "calibration does not work" looked like. */
          calibSamples.current += 1;
          obsMinX.current = Math.min(obsMinX.current, mirroredX);
          obsMaxX.current = Math.max(obsMaxX.current, mirroredX);
          obsMinY.current = Math.min(obsMinY.current, mirroredY);
          obsMaxY.current = Math.max(obsMaxY.current, mirroredY);

          /* Mark the cell the hand is passing through. The screen renders this
             as tiles that light up, which turns the sweep into a small game
             instead of a vague instruction. */
          const cell = coverageCellIndex(mirroredX, mirroredY);
          if (cell >= 0 && !coverageRef.current[cell]) {
            coverageRef.current[cell] = true;
            setCoverageCells(coverageRef.current.slice());
          }

          const spanX = obsMaxX.current - obsMinX.current;
          const spanY = obsMaxY.current - obsMinY.current;

          /* Progress is the limiting factor of the three requirements, so the
             bar cannot sit at 100% while the child still has to move. */
          const bySamples = Math.min(1, calibSamples.current / CALIB_MIN_SAMPLES);
          const bySpan = Math.min(1, Math.min(spanX, spanY) / CALIB_MIN_SPAN);
          const byCoverage = coverageRef.current.filter(Boolean).length / (CAL_COLS * CAL_ROWS);
          setCalibrationProgress(Math.min(bySamples, bySpan, byCoverage / CAL_MIN_COVERAGE));

          /* Provisional mapping while the sweep is in progress, so the cursor
             is usable rather than frozen. */
          const provisionalX = Math.max(CALIB_FLOOR_SPAN * distanceFactor, spanX);
          const provisionalY = Math.max(CALIB_FLOOR_SPAN * distanceFactor, spanY);
          const cx = (obsMinX.current + obsMaxX.current) / 2;
          const cy = (obsMinY.current + obsMaxY.current) / 2;
          calibMinX.current = Math.max(0.01, cx - provisionalX / 2);
          calibMaxX.current = Math.min(0.99, cx + provisionalX / 2);
          calibMinY.current = Math.max(0.01, cy - provisionalY / 2);
          calibMaxY.current = Math.min(0.99, cy + provisionalY / 2);

          const elapsed = Date.now() - (calibStartedAt.current || Date.now());
          const enough = calibSamples.current >= CALIB_MIN_SAMPLES
            && spanX >= CALIB_MIN_SPAN && spanY >= CALIB_MIN_SPAN
            && byCoverage >= CAL_MIN_COVERAGE;
          /* The escape hatch: a child who will not wave still gets to play.
             It needs hand frames, so it cannot fire on an empty camera. */
          const gaveUpWaiting = elapsed >= CALIB_MAX_MS && calibSamples.current >= 15;

          if (enough || gaveUpWaiting) {
            /* Pad the measured reach a little: the child will drift outside
               the exact extremes of their own sweep. */
            const padX = Math.max(0.03, spanX * 0.12);
            const padY = Math.max(0.03, spanY * 0.12);
            let minX = obsMinX.current - padX;
            let maxX = obsMaxX.current + padX;
            let minY = obsMinY.current - padY;
            let maxY = obsMaxY.current + padY;

            // Never map the screen onto less camera space than this.
            const floorX = CALIB_FLOOR_SPAN * distanceFactor;
            const floorY = CALIB_FLOOR_SPAN * distanceFactor;
            if (maxX - minX < floorX) {
              const c = (minX + maxX) / 2;
              minX = c - floorX / 2; maxX = c + floorX / 2;
            }
            if (maxY - minY < floorY) {
              const c = (minY + maxY) / 2;
              minY = c - floorY / 2; maxY = c + floorY / 2;
            }

            calibMinX.current = Math.max(0.01, minX);
            calibMaxX.current = Math.min(0.99, maxX);
            calibMinY.current = Math.max(0.01, minY);
            calibMaxY.current = Math.min(0.99, maxY);

            isCalibrating.current = false;
            setCalibrationProgress(1);
            setCalibrationStatus('Calibrated');
            setCalibrationBounds({
              minX: calibMinX.current, maxX: calibMaxX.current,
              minY: calibMinY.current, maxY: calibMaxY.current,
              spanX, spanY,
              samples: calibSamples.current,
              coverage: byCoverage,
              savedAt: Date.now(),
            });
          }
        } else {
          // Slow adaptation rate to follow posture shifts
          const rate = 0.02;
          if (mirroredX < calibMinX.current) calibMinX.current = calibMinX.current * (1 - rate) + Math.max(0.01, mirroredX) * rate;
          if (mirroredX > calibMaxX.current) calibMaxX.current = calibMaxX.current * (1 - rate) + Math.min(0.99, mirroredX) * rate;
          if (mirroredY < calibMinY.current) calibMinY.current = calibMinY.current * (1 - rate) + Math.max(0.01, mirroredY) * rate;
          if (mirroredY > calibMaxY.current) calibMaxY.current = calibMaxY.current * (1 - rate) + Math.min(0.99, mirroredY) * rate;
        }

        // Clamp safety boundaries
        if (calibMaxX.current <= calibMinX.current) calibMaxX.current = calibMinX.current + 0.1;
        if (calibMaxY.current <= calibMinY.current) calibMaxY.current = calibMinY.current + 0.1;

        // Calibrated normalized coordinate [0..1]
        let normX = (mirroredX - calibMinX.current) / (calibMaxX.current - calibMinX.current);
        let normY = (mirroredY - calibMinY.current) / (calibMaxY.current - calibMinY.current);
        normX = Math.max(0, Math.min(1, normX));
        normY = Math.max(0, Math.min(1, normY));

        // ── Adaptive Smoothing Filter ──
        let smoothX = lastSmoothX.current === null ? normX : lastSmoothX.current;
        let smoothY = lastSmoothY.current === null ? normY : lastSmoothY.current;

        const dx = normX - smoothX;
        const dy = normY - smoothY;
        const dist = Math.hypot(dx, dy);

        // Alpha scaling: move fast -> high alpha (snappy), move slow -> low alpha (steady)
        const minAlpha = 0.20;
        const maxAlpha = 0.80;
        const speedThreshold = 0.10;
        const alpha = minAlpha + (maxAlpha - minAlpha) * Math.min(dist / speedThreshold, 1);

        let nextX = smoothX + alpha * dx;
        let nextY = smoothY + alpha * dy;

        // Anti-jitter deadzone (tuned for fine motor control precision)
        const deadZone = 0.0015;
        if (Math.abs(dx) < deadZone) nextX = smoothX;
        if (Math.abs(dy) < deadZone) nextY = smoothY;

        lastSmoothX.current = nextX;
        lastSmoothY.current = nextY;

        smoothedCursorRef.current = { x: nextX, y: nextY };

        // ── Confidence Estimation ──
        let confidence = 50; // hand tracking is active
        if (faceLandmarksRef.current) {
          confidence += 20; // face tracking active
          if (gazeDetectedRef.current) {
            confidence += 15; // gaze focused
          }
        }
        // Jitter penalty
        const jitterPenalty = Math.min(1, dist / 0.10);
        confidence += Math.round(15 * (1 - jitterPenalty));
        confidenceRef.current = Math.max(0, Math.min(100, confidence));

        /* ── Throttled state mirrors ──────────────────────────────────────
           Everything above ran at camera rate and touched only refs. Only
           here, roughly eight times a second, does anything reach React —
           and confidence and fps are additionally gated on a change large
           enough to be worth a render. */
        const nowMs = performance.now();
        if (nowMs - lastPublishAt.current >= PUBLISH_INTERVAL_MS) {
          lastPublishAt.current = nowMs;
          setRawCursorPos(rawCursorRef.current);
          setSmoothedCursorPos(smoothedCursorRef.current);
          if (Math.abs(confidenceRef.current - lastPublishedConf.current) >= 4) {
            lastPublishedConf.current = confidenceRef.current;
            setTrackingConfidence(confidenceRef.current);
          }
        }
      }

      // Séparer gauche / droite
      let left = null, right = null;
      const handedness = results.multiHandedness || [];
      results.multiHandLandmarks.forEach((lm, i) => {
        const label = handedness[i]?.label;
        if (label === 'Left')       right = lm; // miroir caméra
        else if (label === 'Right') left  = lm;
        else                        left  = left || lm;
      });
      setMultiHandData({ left, right, all: results.multiHandLandmarks });
    } else {
      // Trigger grace period on tracking loss
      if (!trackingLossTimer.current) {
        trackingLossTimer.current = setTimeout(() => {
          setLandmarks(null);
          setMultiHandData(null);
          setIsTracking(false);
          setTrackingConfidence(0);
          setHandCount(0);
        }, 400); // 400ms grace period keeps cursor active during blips
      }
    }
  }, [canvasRef]);

  // ── Callback Face Mesh ───────────────────────────────────────────────
  const onFaceResults = useCallback((results) => {
    if (!results.multiFaceLandmarks?.length) {
      // Effacer le canvas visage si plus de visage détecté
      const fc = faceCanvasRef.current;
      if (fc) fc.getContext('2d').clearRect(0, 0, fc.width, fc.height);
      setFaceLandmarks(null);
      faceLandmarksRef.current = null;
      setHeadPose({ pitch: 0, yaw: 0 });
      setMouthOpen(0);
      setGazeDetected(false);
      gazeDetectedRef.current = false;
      return;
    }
    const lm = results.multiFaceLandmarks[0];
    faceLandmarksRef.current = lm;
    
    // ← Dessine sur le canvas dédié visage (indépendant du clearRect Hands)
    drawFaceLandmarks(lm, faceCanvasRef.current);
    setFaceLandmarks(lm);
    
    const pose = estimateHeadPose(lm);
    setHeadPose(pose);
    setMouthOpen(computeMouthOpen(lm));

    // Gaze Detection Heuristics
    const headTurnedAway = Math.abs(pose.pitch) > 22 || Math.abs(pose.yaw) > 28;
    
    const pOuter = lm[263];
    const pInner = lm[362];
    const pIris = lm[468];
    let irisAligned = true;
    if (pOuter && pInner && pIris) {
      const eyeWidth = Math.abs(pOuter.x - pInner.x) || 0.001;
      const irisOffset = pIris.x - (pOuter.x + pInner.x) / 2;
      const relativeOffset = Math.abs(irisOffset) / eyeWidth;
      // High deflection of iris means looking off-screen
      if (relativeOffset > 0.32) {
        irisAligned = false;
      }
    }
    
    const gaze = !headTurnedAway && irisAligned;
    setGazeDetected(gaze);
    gazeDetectedRef.current = gaze;
  }, []);

  // ── Initialisation ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const init = async () => {
      try {
        // Charger les deux modèles en parallèle
        const [
          { Hands, HAND_CONNECTIONS },
          { FaceMesh },
          { Camera },
        ] = await Promise.all([
          import('@mediapipe/hands'),
          import('@mediapipe/face_mesh'),
          import('@mediapipe/camera_utils'),
        ]);

        if (cancelled) return;

        window.HAND_CONNECTIONS = HAND_CONNECTIONS;

        // ── Modèle Hands ──────────────────────────────────────────────────
        const hands = new Hands({
          locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
        });
        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 0,
          minDetectionConfidence: 0.7,
          minTrackingConfidence: 0.5,
        });
        hands.onResults(onHandResults);

        // ── Modèle Face Mesh (throttlé) ───────────────────────────────────
        const faceMesh = new FaceMesh({
          locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
        });
        faceMesh.setOptions({
          maxNumFaces:            1,
          refineLandmarks:        true,    // active les iris (468-477)
          minDetectionConfidence: 0.5,
          minTrackingConfidence:  0.5,
        });
        faceMesh.onResults(onFaceResults);

        if (cancelled) {
          try { hands.close(); } catch {}
          try { faceMesh.close(); } catch {}
          return;
        }

        handsRef.current = hands;
        faceMeshRef.current = faceMesh;

        if (!videoRef?.current) return;

        // ── UNE SEULE Camera pour les deux modèles (16:9 aspect) ───────────
        const camera = new Camera(videoRef.current, {
          onFrame: async () => {
            if (cancelled || !videoRef.current) return;
            frameCount.current++;

            const now = performance.now();
            const elapsed = now - lastFrameTime.current;
            lastFrameTime.current = now;
            if (elapsed > 0) {
              const currentFps = 1000 / elapsed;
              fpsRef.current = Math.round(fpsRef.current * 0.92 + currentFps * 0.08);
              /* Not setFps on every frame — that was one of the four state
                 writes per camera frame. Published on a timer instead, and
                 here rather than in onHandResults so the calibration screen
                 still gets a frame rate while it is waiting for a hand. */
              if (now - lastFpsPublishAt.current >= 500
                  && Math.abs(fpsRef.current - lastPublishedFps.current) >= 2) {
                lastFpsPublishAt.current = now;
                lastPublishedFps.current = fpsRef.current;
                setFps(fpsRef.current);
              }
            }

            // Hands : chaque frame (pour dwell fluide)
            if (handsRef.current) {
              await handsRef.current.send({ image: videoRef.current });
            }

            // Face Mesh : 1 frame sur FACE_THROTTLE (économie CPU ~60%)
            if (faceMeshRef.current && frameCount.current % FACE_THROTTLE === 0) {
              await faceMeshRef.current.send({ image: videoRef.current });
            }
          },
          width:  640,
          height: 360, // 16:9 Constraint
        });

        if (cancelled) {
          try { camera.stop(); } catch {}
          try { hands.close(); } catch {}
          try { faceMesh.close(); } catch {}
          return;
        }

        cameraRef.current = camera;
        await camera.start();

        if (cancelled) {
          try { camera.stop(); } catch {}
          try { hands.close(); } catch {}
          try { faceMesh.close(); } catch {}
        }

      } catch (err) {
        if (!cancelled) {
          console.warn('[useMediaPipeTracking] Error:', err.message);
          setError('simulation');
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      if (trackingLossTimer.current) clearTimeout(trackingLossTimer.current);
      
      // Stop and release camera tracks directly
      try {
        if (videoRef.current?.srcObject) {
          const stream = videoRef.current.srcObject;
          stream.getTracks().forEach(t => t.stop());
          videoRef.current.srcObject = null;
        }
      } catch (e) {
        console.warn('Error releasing camera tracks:', e);
      }
      
      try { cameraRef.current?.stop();    } catch {}
      try { handsRef.current?.close();    } catch {}
      try { faceMeshRef.current?.close(); } catch {}
    };
  }, [enabled, onHandResults, onFaceResults, videoRef]);

  // ── Helpers exposés ────────────────────────────────────────────────────
  const getPositionBuffer  = useCallback(() => posBuffer.current, []);
  const getIndexTipPosition = useCallback(() => landmarks?.[8] || null, [landmarks]);

  return {
    // Hands
    landmarks,
    multiHandData,
    isTracking,
    positionBuffer: posBuffer,
    getPositionBuffer,
    getIndexTipPosition,
    isSimulationMode: error === 'simulation',
    error,
    // Face
    faceLandmarks,
    headPose,
    mouthOpen,
    // Canvas dédié visage — à attacher à un <canvas> dans GamePage
    faceCanvasRef,
    
    // Telemetry & Filtered Outputs
    smoothedCursorPos,
    fps,
    trackingConfidence,
    handDetected: isTracking,
    gazeDetected,
    calibrationStatus,
    calibrationProgress,
    recalibrate,

    /* Full-rate refs. Read these from an animation frame and write straight to
       the DOM; read the state versions above only if a few updates a second is
       enough. Mixing them up is the difference between a cursor that glides and
       one that drags the whole page along behind it. */
    rawCursorRef,
    smoothedCursorRef,
    confidenceRef,
    fpsRef,

    // ── Calibration screen ──
    rawCursorPos,
    handCount,
    coverageCells,
    coverageTarget: CAL_MIN_COVERAGE,
    distanceFactor: distanceFactorState,
    calibrationBounds,
    isCalibrating: calibrationStatus !== 'Calibrated',
    finalizeCalibration,
    applyCalibration,
  };
}
