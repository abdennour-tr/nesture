/**
 * useFaceMesh.js
 * Hook React wrappant MediaPipe Face Mesh.
 * Fournit :
 *   - 468 landmarks du visage
 *   - Estimation pitch / yaw de la tête
 *   - Position des iris (gauche + droite)
 *   - Ouverture de la bouche
 *
 * Détection de patrons développementaux (non diagnostique)
 */
import { useState, useEffect, useRef, useCallback } from 'react';

// ── Indices landmarks clés ────────────────────────────────────────────────────

// Nez (pour calcul orientation tête)
const NOSE_TIP   = 1;
const NOSE_BASE  = 168;
// Yeux (coins)
const LEFT_EYE_INNER  = 133;
const LEFT_EYE_OUTER  = 33;
const RIGHT_EYE_INNER = 362;
const RIGHT_EYE_OUTER = 263;
// Bouche
const MOUTH_TOP = 13;
const MOUTH_BOT = 14;
// Menton / front pour pitch
const CHIN    = 152;
const FOREHEAD = 10;

// ── Estimation pitch / yaw depuis landmarks 3D ─────────────────────────────

/**
 * Estime le pitch (inclinaison verticale) et yaw (rotation horizontale) de la tête.
 * Utilise les coordonnées normalisées 3D de MediaPipe.
 *
 * Pitch  > 0 : tête penchée en arrière (regard vers le haut)
 * Pitch  < 0 : tête penchée en avant  (regard vers le bas)
 * Yaw    > 0 : tête tournée à droite
 * Yaw    < 0 : tête tournée à gauche
 *
 * @param {Array} landmarks - 468 landmarks { x, y, z }
 * @returns {{ pitch: number, yaw: number }} en degrés
 */
function estimateHeadPose(landmarks) {
  if (!landmarks || landmarks.length < 468) return { pitch: 0, yaw: 0 };

  const noseTip  = landmarks[NOSE_TIP];
  const noseBase = landmarks[NOSE_BASE];
  const chin     = landmarks[CHIN];
  const forehead = landmarks[FOREHEAD];
  const leftEye  = landmarks[LEFT_EYE_INNER];
  const rightEye = landmarks[RIGHT_EYE_INNER];

  if (!noseTip || !chin || !forehead || !leftEye || !rightEye) return { pitch: 0, yaw: 0 };

  // ── Yaw : asymétrie horizontale entre les deux yeux et le nez ─────────────
  // Si le nez est plus proche de l'œil gauche → tête tournée à gauche
  const eyeMidX   = (leftEye.x + rightEye.x) / 2;
  const noseOffsetX = noseTip.x - eyeMidX;
  // Normaliser par la distance inter-oculaire
  const eyeDist  = Math.abs(rightEye.x - leftEye.x) || 0.001;
  const yawRaw   = noseOffsetX / eyeDist;
  const yaw      = yawRaw * 90; // degrés estimés

  // ── Pitch : position verticale du nez par rapport au centre front-menton ──
  const verticalCenter = (forehead.y + chin.y) / 2;
  const pitchRaw = (noseTip.y - verticalCenter) / ((chin.y - forehead.y) || 0.001);
  const pitch    = pitchRaw * -90; // inverse: nose bas = tête bas = pitch négatif

  return {
    pitch: Math.max(-45, Math.min(45, pitch)),
    yaw:   Math.max(-45, Math.min(45, yaw)),
  };
}

/**
 * Calcule le score d'ouverture de la bouche (0 = fermée, 1 = grande ouverte).
 * Normalisé par la hauteur du visage.
 */
function computeMouthOpen(landmarks) {
  if (!landmarks || landmarks.length < 468) return 0;
  const top  = landmarks[MOUTH_TOP];
  const bot  = landmarks[MOUTH_BOT];
  const face = landmarks[FOREHEAD];
  const chin = landmarks[CHIN];
  if (!top || !bot || !face || !chin) return 0;
  const opening    = Math.abs(bot.y - top.y);
  const faceHeight = Math.abs(chin.y - face.y) || 0.001;
  return Math.min(1, opening / faceHeight);
}

// ── Hook principal ────────────────────────────────────────────────────────────

/**
 * @param {React.RefObject} videoRef - même ref vidéo que useHandTracking
 * @param {boolean} enabled
 */
export default function useFaceMesh(videoRef, enabled = true) {
  const [faceLandmarks, setFaceLandmarks] = useState(null); // 468 points
  const [headPose,      setHeadPose]      = useState({ pitch: 0, yaw: 0 });
  const [mouthOpen,     setMouthOpen]     = useState(0);
  const [isReady,       setIsReady]       = useState(false);
  const [error,         setError]         = useState(null);

  const faceMeshRef = useRef(null);
  const cameraRef   = useRef(null);

  const onResults = useCallback((results) => {
    if (!results.multiFaceLandmarks?.length) {
      setFaceLandmarks(null);
      setHeadPose({ pitch: 0, yaw: 0 });
      setMouthOpen(0);
      return;
    }

    const lm = results.multiFaceLandmarks[0];
    setFaceLandmarks(lm);
    setHeadPose(estimateHeadPose(lm));
    setMouthOpen(computeMouthOpen(lm));
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const init = async () => {
      try {
        const { FaceMesh } = await import('@mediapipe/face_mesh');
        const { Camera }   = await import('@mediapipe/camera_utils');

        const faceMesh = new FaceMesh({
          locateFile: (file) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
        });

        faceMesh.setOptions({
          maxNumFaces:            1,
          refineLandmarks:        true,   // active les 478 points (+ iris 468-477)
          minDetectionConfidence: 0.5,
          minTrackingConfidence:  0.5,
        });

        faceMesh.onResults(onResults);
        faceMeshRef.current = faceMesh;

        if (!videoRef?.current) return;

        // Partager la caméra avec useHandTracking via le même videoRef
        // MediaPipe Camera gère le flux en interne
        const camera = new Camera(videoRef.current, {
          onFrame: async () => {
            if (!cancelled && faceMeshRef.current && videoRef.current) {
              await faceMeshRef.current.send({ image: videoRef.current });
            }
          },
          width:  640,
          height: 480,
        });

        await camera.start();
        cameraRef.current = camera;

        if (!cancelled) setIsReady(true);

      } catch (err) {
        if (!cancelled) {
          console.warn('[useFaceMesh] Face Mesh unavailable:', err.message);
          setError(err.message);
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      try { cameraRef.current?.stop();    } catch {}
      try { faceMeshRef.current?.close(); } catch {}
    };
  }, [enabled, onResults, videoRef]);

  return {
    faceLandmarks, // 468 (ou 478 avec iris) landmarks { x, y, z }
    headPose,      // { pitch, yaw } en degrés
    mouthOpen,     // 0–1
    isReady,
    error,
  };
}
