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
export default function useMediaPipeTracking(videoRef, canvasRef, enabled = true) {
  const [landmarks,     setLandmarks]     = useState(null);
  const [multiHandData, setMultiHandData] = useState(null);
  const [faceLandmarks, setFaceLandmarks] = useState(null);
  const [headPose,      setHeadPose]      = useState({ pitch: 0, yaw: 0 });
  const [mouthOpen,     setMouthOpen]     = useState(0);
  const [isTracking,    setIsTracking]    = useState(false);
  const [error,         setError]         = useState(null);

  // --- Telemetry States ---
  const [calibrationStatus, setCalibrationStatus] = useState('Calibrating...');
  const [trackingConfidence, setTrackingConfidence] = useState(100);
  const [gazeDetected, setGazeDetected] = useState(false);
  const [fps, setFps] = useState(30);
  const [smoothedCursorPos, setSmoothedCursorPos] = useState({ x: 0.5, y: 0.5 });

  // --- Auto-Calibration & Filter Refs ---
  const calibMinX = useRef(0.35);
  const calibMaxX = useRef(0.65);
  const calibMinY = useRef(0.4);
  const calibMaxY = useRef(0.75);
  
  const calibrationTimer = useRef(null);
  const trackingLossTimer = useRef(null);
  const isCalibrating = useRef(true);

  const lastSmoothX = useRef(null);
  const lastSmoothY = useRef(null);
  
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

  // --- Manual Recalibrate function ---
  const recalibrate = useCallback(() => {
    isCalibrating.current = true;
    setCalibrationStatus('Calibrating...');
    // Reset limits slightly to snap to new coordinates
    calibMinX.current = 0.35;
    calibMaxX.current = 0.65;
    calibMinY.current = 0.4;
    calibMaxY.current = 0.75;
    lastSmoothX.current = null;
    lastSmoothY.current = null;
    if (calibrationTimer.current) clearTimeout(calibrationTimer.current);
    calibrationTimer.current = setTimeout(() => {
      isCalibrating.current = false;
      setCalibrationStatus('Calibrated');
    }, 3000);
  }, []);

  // ── Callback Hands ─────────────────────────────────────────────────────
  const onHandResults = useCallback((results) => {
    drawHandLandmarks(results, canvasRef?.current);

    if (results.multiHandLandmarks?.length > 0) {
      if (trackingLossTimer.current) {
        clearTimeout(trackingLossTimer.current);
        trackingLossTimer.current = null;
      }

      // Start calibration timer on first hand tracking
      if (isCalibrating.current && !calibrationTimer.current) {
        setCalibrationStatus('Calibrating...');
        calibrationTimer.current = setTimeout(() => {
          isCalibrating.current = false;
          setCalibrationStatus('Calibrated');
        }, 3000);
      }

      const first = results.multiHandLandmarks[0];
      setLandmarks(first);
      setIsTracking(true);

      // Track position buffer (index tip)
      const indexTip = first[8];
      if (indexTip) {
        posBuffer.current.push({ x: indexTip.x, y: indexTip.y, t: Date.now() });
        if (posBuffer.current.length > 20) posBuffer.current.shift();

        // ── Mirrored raw coords ──
        const mirroredX = 1 - indexTip.x;
        const mirroredY = indexTip.y;

        // ── Distance Scale Adjustment ──
        let distanceFactor = 1.0;
        if (faceLandmarksRef.current) {
          const faceLm = faceLandmarksRef.current;
          const leftEye = faceLm[LEFT_EYE_INNER];
          const rightEye = faceLm[RIGHT_EYE_INNER];
          if (leftEye && rightEye) {
            const eyeDist = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
            // 0.085 is the standard eye distance in camera space at 50-60cm.
            distanceFactor = Math.max(0.4, Math.min(2.5, eyeDist / 0.085));
          }
        }

        // Standard ranges scaled by user distance
        const targetRangeX = 0.28 * distanceFactor;
        const targetRangeY = 0.32 * distanceFactor;

        // Update bounds
        if (isCalibrating.current) {
          const rate = 0.25;
          calibMinX.current = calibMinX.current * (1 - rate) + Math.max(0.02, mirroredX - targetRangeX/2) * rate;
          calibMaxX.current = calibMaxX.current * (1 - rate) + Math.min(0.98, mirroredX + targetRangeX/2) * rate;
          calibMinY.current = calibMinY.current * (1 - rate) + Math.max(0.02, mirroredY - targetRangeY/2) * rate;
          calibMaxY.current = calibMaxY.current * (1 - rate) + Math.min(0.98, mirroredY + targetRangeY/2) * rate;
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
        
        setSmoothedCursorPos({ x: nextX, y: nextY });

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
        setTrackingConfidence(Math.max(0, Math.min(100, confidence)));
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
              setFps(fpsRef.current);
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
      if (calibrationTimer.current) clearTimeout(calibrationTimer.current);
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
    recalibrate,
  };
}
