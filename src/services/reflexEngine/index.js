/**
 * reflexEngine/index.js
 * Moteur principal de détection des réflexes primitifs — Orchestrateur
 *
 * Pipeline :
 *   1) Tracking des mains (MediaPipe Hands via hook externe)
 *   2) Tracking du visage (MediaPipe Face Mesh via hook externe)
 *   3) Extraction des caractéristiques (frame par frame)
 *   4) Calcul des scores de réflexes sur le buffer de frames
 *   5) Génération de la sortie JSON structurée
 *
 * Détection de patrons développementaux (non diagnostique)
 */

import { detectATNR }          from './reflexDetectors/atnr.js';
import { detectSTNR }          from './reflexDetectors/stnr.js';
import { detectTLR }           from './reflexDetectors/tlr.js';
import { detectMoro }          from './reflexDetectors/moro.js';
import { detectVOR }           from './reflexDetectors/vor.js';
import { detectPalmarGrasp }   from './reflexDetectors/palmarGrasp.js';
import { detectBabkin }        from './reflexDetectors/babkin.js';
import { detectHandToMouth }   from './reflexDetectors/handToMouth.js';
import { detectEyeCoordination } from './reflexDetectors/eyeCoordination.js';
import { detectVisualTracking }  from './reflexDetectors/visualTracking.js';
import { formatOutput, REFLEX_EDUCATION } from './outputFormatter.js';

// ── Configuration ──────────────────────────────────────────────────────────────

const CONFIG = {
  MAX_BUFFER_FRAMES: 300,   // ~10 secondes à 30fps
  MIN_FRAMES_REQUIRED: 5,   // minimum pour toute analyse
  FPS_TARGET: 30,
};

// ── Classe principale ─────────────────────────────────────────────────────────

export class ReflexEngine {
  constructor() {
    /** @type {Array<Object>} Buffer circulaire des frames */
    this._frameBuffer = [];

    /** Résultats courants (mis à jour à chaque analyse) */
    this._currentResults = null;

    /** Métadonnées de session */
    this._sessionMeta = {};

    /** Timestamp de la dernière frame */
    this._lastTimestamp = null;

    /** Flag pour savoir si le moteur est actif */
    this._running = false;
  }

  // ── Cycle de vie ────────────────────────────────────────────────────────────

  /** Démarre une nouvelle session de tracking */
  startSession(meta = {}) {
    this._frameBuffer   = [];
    this._currentResults = null;
    this._sessionMeta   = { ...meta, timestamp: new Date().toISOString() };
    this._lastTimestamp = null;
    this._running = true;
    console.log('[ReflexEngine] Session démarrée', this._sessionMeta);
  }

  /** Arrête le tracking et retourne l'analyse finale */
  endSession() {
    this._running = false;
    const results = this.analyzeBuffer(this._frameBuffer);
    console.log('[ReflexEngine] Session terminée — Frames analysées :', this._frameBuffer.length);
    return results;
  }

  // ── Ingestion des frames ─────────────────────────────────────────────────────

  /**
   * Ingère une frame depuis les hooks MediaPipe.
   * Appeler cette méthode à chaque frame (requestAnimationFrame).
   *
   * @param {Object} frameData
   * @param {Array|null}  frameData.leftHand    - 21 landmarks main gauche
   * @param {Array|null}  frameData.rightHand   - 21 landmarks main droite
   * @param {Array|null}  frameData.faceMesh    - 468 landmarks visage
   * @param {number|null} frameData.headPitch   - pitch de la tête (degrés)
   * @param {number|null} frameData.headYaw     - yaw de la tête (degrés)
   */
  pushFrame(frameData) {
    if (!this._running) return;

    const now = Date.now();
    const frame = {
      timestamp:  now,
      leftHand:   frameData.leftHand   || null,
      rightHand:  frameData.rightHand  || null,
      faceMesh:   frameData.faceMesh   || null,
      headPitch:  frameData.headPitch  ?? 0,
      headYaw:    frameData.headYaw    ?? 0,
    };

    this._frameBuffer.push(frame);

    // Buffer circulaire
    if (this._frameBuffer.length > CONFIG.MAX_BUFFER_FRAMES) {
      this._frameBuffer.shift();
    }

    this._lastTimestamp = now;
  }

  // ── Analyse ─────────────────────────────────────────────────────────────────

  /**
   * Analyse le buffer de frames courant.
   * Peut être appelé en temps réel (ex : toutes les 2 secondes)
   * ou une seule fois en fin de session.
   *
   * @param {Array} frames - frames à analyser (par défaut : buffer complet)
   * @returns {Object} sortie JSON formatée
   */
  analyzeBuffer(frames = null) {
    const buffer = frames || this._frameBuffer;

    if (buffer.length < CONFIG.MIN_FRAMES_REQUIRED) {
      return formatOutput({}, this._sessionMeta);
    }

    // ── Exécuter tous les détecteurs ──────────────────────────────────────────
    const rawResults = {
      ATNR:              detectATNR(buffer),
      STNR:              detectSTNR(buffer),
      TLR:               detectTLR(buffer),
      Moro:              detectMoro(buffer),
      VOR:               detectVOR(buffer),
      'Palmar Grasp':    detectPalmarGrasp(buffer),
      Babkin:            detectBabkin(buffer),
      'Hand-to-Mouth':   detectHandToMouth(buffer),
      'Eye Coordination':detectEyeCoordination(buffer),
      'Visual Tracking': detectVisualTracking(buffer),
    };

    // ── Formater et retourner ─────────────────────────────────────────────────
    this._currentResults = formatOutput(rawResults, this._sessionMeta);
    return this._currentResults;
  }

  // ── Accès aux résultats ─────────────────────────────────────────────────────

  /** Retourne les derniers résultats calculés */
  getCurrentResults() {
    return this._currentResults;
  }

  /** Retourne le nombre de frames dans le buffer */
  getFrameCount() {
    return this._frameBuffer.length;
  }

  /** Retourne les métadonnées éducatives pour un réflexe donné */
  getEducation(reflexKey) {
    return REFLEX_EDUCATION[reflexKey] || null;
  }

  /**
   * Convertit la sortie JSON du moteur en format compatible avec aiEngine.js
   * pour l'insertion dans Supabase (reflex_scores).
   *
   * @param {Object} engineOutput - sortie de analyzeBuffer()
   * @returns {Array} tableau de scores au format aiEngine
   */
  static toAiEngineFormat(engineOutput) {
    if (!engineOutput || !engineOutput.reflexes) return [];

    return Object.values(engineOutput.reflexes).map(r => ({
      reflex:          r.reflex_key,
      score:           _labelToAiScore(r.label, r.score),
      confidence:      _labelToConfidenceLevel(r.label),
      impact:          r.education?.explanation?.slice(0, 100) || '',
      label:           r.label,
      explanation:     r.education?.explanation || '',
      activities:      r.education?.activities || [],
      podcast:         r.education?.podcast    || null,
      indicators_found: [],
      exercises:       [],
      actionable:      r.label === 'strong' || r.label === 'moderate',
    }));
  }
}

// ── Helpers internes ──────────────────────────────────────────────────────────

/** Convertit le label en score aiEngine (10–100, 100 = intégré) */
function _labelToAiScore(label, rawScore) {
  // rawScore ici = score de rétention [0-100], 100 = forte rétention
  // aiEngine score = inverse : 100 = bien intégré
  return Math.max(10, Math.min(100, 100 - rawScore));
}

/** Convertit le label en niveau de confiance texte */
function _labelToConfidenceLevel(label) {
  switch (label) {
    case 'strong':   return 'High';
    case 'moderate': return 'Medium';
    case 'weak':     return 'Low';
    default:         return 'Low';
  }
}

// ── Singleton exporté ─────────────────────────────────────────────────────────

/** Instance partagée du moteur (singleton pour usage en React) */
export const reflexEngine = new ReflexEngine();

/** Ré-exporter les métadonnées éducatives pour usage direct */
export { REFLEX_EDUCATION, formatOutput };
