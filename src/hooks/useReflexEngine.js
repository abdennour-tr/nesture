/**
 * hooks/useReflexEngine.js
 * Hook React pour intégrer le moteur de réflexes primitifs
 * avec les données MediaPipe (mains + visage) en temps réel.
 *
 * Usage :
 *   const { startTracking, stopTracking, pushFrame, results, frameCount } = useReflexEngine();
 *
 * Détection de patrons développementaux (non diagnostique)
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { ReflexEngine } from '../services/reflexEngine/index.js';

/**
 * @param {Object} options
 * @param {number} [options.analyzeEveryMs=3000] - Fréquence d'analyse temps réel (ms)
 * @param {Object} [options.sessionMeta={}]       - Métadonnées de session
 */
export function useReflexEngine({
  analyzeEveryMs = 3000,
  sessionMeta    = {},
} = {}) {
  // Instance du moteur (stable entre re-renders)
  const engineRef = useRef(null);

  // Résultats JSON courants
  const [results, setResults]      = useState(null);
  // Nombre de frames collectées
  const [frameCount, setFrameCount] = useState(0);
  // Statut
  const [isRunning, setIsRunning]   = useState(false);

  // Timer d'analyse périodique
  const analyzeTimerRef = useRef(null);

  // ── Initialisation ───────────────────────────────────────────────────────────

  useEffect(() => {
    engineRef.current = new ReflexEngine();
    return () => {
      // Nettoyage au démontage
      if (analyzeTimerRef.current) clearInterval(analyzeTimerRef.current);
    };
  }, []);

  // ── Démarrer le tracking ─────────────────────────────────────────────────────

  const startTracking = useCallback((meta = {}) => {
    if (!engineRef.current) return;

    engineRef.current.startSession({ ...sessionMeta, ...meta });
    setResults(null);
    setFrameCount(0);
    setIsRunning(true);

    // Analyse périodique en temps réel
    analyzeTimerRef.current = setInterval(() => {
      if (!engineRef.current) return;
      const partialResults = engineRef.current.analyzeBuffer();
      setResults(partialResults);
      setFrameCount(engineRef.current.getFrameCount());
    }, analyzeEveryMs);
  }, [sessionMeta, analyzeEveryMs]);

  // ── Arrêter le tracking et obtenir le résultat final ────────────────────────

  const stopTracking = useCallback(() => {
    if (!engineRef.current) return null;

    if (analyzeTimerRef.current) {
      clearInterval(analyzeTimerRef.current);
      analyzeTimerRef.current = null;
    }

    const finalResults = engineRef.current.endSession();
    setResults(finalResults);
    setIsRunning(false);
    return finalResults;
  }, []);

  // ── Pousser une frame (à appeler dans requestAnimationFrame) ─────────────────

  /**
   * @param {Object} frameData
   * @param {Array|null}  frameData.leftHand   - 21 landmarks MediaPipe Hands
   * @param {Array|null}  frameData.rightHand  - 21 landmarks MediaPipe Hands
   * @param {Array|null}  frameData.faceMesh   - 468 landmarks Face Mesh
   * @param {number|null} frameData.headPitch  - pitch (degrés)
   * @param {number|null} frameData.headYaw    - yaw (degrés)
   */
  const pushFrame = useCallback((frameData) => {
    if (!engineRef.current || !isRunning) return;
    engineRef.current.pushFrame(frameData);
  }, [isRunning]);

  // ── Changement de mode de saisie en cours de séance ─────────────────────────

  /**
   * Signale au moteur que l'enfant est passé de « main en l'air » à « tactile »
   * ou l'inverse. En tactile la caméra n'est pas ouverte : sans cette
   * information, une séance tactile ressort « Not Measured » exactement comme
   * une séance caméra dont la webcam a lâché.
   *
   * Volontairement sans dépendance sur `isRunning` : la garde a déjà coûté à ce
   * hook une session entière de données quand un appelant a capturé cette
   * fonction dans une boucle d'animation qui ne se recréait jamais.
   */
  const setInputMode = useCallback((mode) => {
    engineRef.current?.setInputMode?.(mode);
  }, []);

  // ── Convertir pour aiEngine ──────────────────────────────────────────────────

  /**
   * Retourne les scores au format compatible aiEngine.js
   * pour envoi à Supabase via endSession()
   */
  const getAiEngineScores = useCallback(() => {
    if (!results) return [];
    return ReflexEngine.toAiEngineFormat(results);
  }, [results]);

  return {
    /** Démarrer une session de tracking */
    startTracking,
    /** Arrêter et obtenir le résultat final */
    stopTracking,
    /** Pousser une frame depuis MediaPipe */
    pushFrame,
    /** Signaler un changement de mode de saisie ('camera' | 'touch') */
    setInputMode,
    /** Résultats JSON courants (mis à jour périodiquement) */
    results,
    /** Nombre de frames collectées */
    frameCount,
    /** true si le tracking est actif */
    isRunning,
    /** Scores au format aiEngine pour Supabase */
    getAiEngineScores,
  };
}
