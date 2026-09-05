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
import { formatOutput, REFLEX_EDUCATION, MIN_REPORTABLE_CONFIDENCE } from './outputFormatter.js';

// ── Configuration ──────────────────────────────────────────────────────────────

const CONFIG = {
  MAX_BUFFER_FRAMES: 300,   // ~10 secondes à 30fps — fenêtre glissante temps réel
  MIN_FRAMES_REQUIRED: 5,   // minimum pour toute analyse
  FPS_TARGET: 30,
  /* ── Whole-session analysis ─────────────────────────────────────────────
     The frame buffer is a 300-frame ring, so `endSession()` used to analyse
     only the last ten seconds of a session that may have run ten minutes. A
     child who worked hard and then sat still while the results loaded was
     scored on the sitting still: on a 5-minute test session, Palmar Grasp fell
     from 84 to 20 purely because of the last ten seconds.

     Keeping every frame is not an option — a face mesh is 478 points per frame,
     so ten minutes is millions of objects. Instead each window is analysed as
     it completes and only its RESULT is kept, and the session output is the
     aggregate of those. Sixty small objects for a ten-minute session. */
  WINDOW_FRAMES: 150,       // ~5 s at 30 fps — one analysed window
  MIN_TAIL_FRAMES: 30,      // a final partial window shorter than this is dropped
};


// ── Détecteurs & agrégation ───────────────────────────────────────────────────

/** Exécute tous les détecteurs sur une fenêtre de frames. */
function _runDetectors(frames) {
  return {
    ATNR:              detectATNR(frames),
    STNR:              detectSTNR(frames),
    TLR:               detectTLR(frames),
    Moro:              detectMoro(frames),
    VOR:               detectVOR(frames),
    'Palmar Grasp':    detectPalmarGrasp(frames),
    Babkin:            detectBabkin(frames),
    'Hand-to-Mouth':   detectHandToMouth(frames),
    'Eye Coordination':detectEyeCoordination(frames),
    'Visual Tracking': detectVisualTracking(frames),
  };
}

const _LABEL_FOR = (score) =>
  score >= 65 ? 'strong' : score >= 40 ? 'moderate' : score >= 20 ? 'weak' : 'none';

/**
 * Combine les résultats des fenêtres d'une session en un résultat unique.
 *
 * Le score retenu est la moyenne pondérée par la confiance : une fenêtre où
 * l'enfant était hors champ pèse moins qu'une fenêtre bien suivie, au lieu de
 * compter autant. Les fenêtres non mesurées ne comptent pas du tout — mais si
 * AUCUNE fenêtre n'a pu mesurer un réflexe, le résultat reste `not_measured`
 * plutôt que de devenir un zéro qui se lirait comme « intégré ».
 */
function _aggregateWindows(windows) {
  const out = {};
  const keys = new Set();
  for (const w of windows) for (const k of Object.keys(w)) keys.add(k);

  for (const key of keys) {
    const all      = windows.map(w => w[key]).filter(Boolean);
    const measured = all.filter(r => r && r.label !== 'not_measured' && typeof r.score === 'number');

    if (measured.length === 0) {
      out[key] = {
        score: null, label: 'not_measured', confidence: 0,
        events: all.reduce((a, r) => a + (r.events || 0), 0) || null,
        detail: {
          reason: 'No window produced a usable measurement',
          windows_total: windows.length,
          windows_measured: 0,
        },
      };
      continue;
    }

    let wSum = 0, sSum = 0, cSum = 0;
    for (const r of measured) {
      /* A window with zero confidence would otherwise vanish from the average
         entirely; it still counts, just barely. */
      const w = Math.max(0.05, r.confidence ?? 0);
      wSum += w;
      sSum += w * r.score;
      cSum += (r.confidence ?? 0);
    }
    const score      = Math.round(sSum / wSum);
    const confidence = cSum / measured.length;
    /* Coverage matters as much as confidence: a reflex measurable in 3 windows
       out of 60 is a weaker claim than one measurable throughout. */
    const coverage   = measured.length / windows.length;

    const scores = measured.map(r => r.score).sort((a, b) => a - b);
    out[key] = {
      score,
      label: _LABEL_FOR(score),
      confidence: Math.min(confidence, coverage === 1 ? confidence : confidence * (0.5 + coverage / 2)),
      events: measured.reduce((a, r) => a + (r.events || 0), 0) || null,
      left:      measured[measured.length - 1].left      ?? null,
      right:     measured[measured.length - 1].right     ?? null,
      bilateral: measured[measured.length - 1].bilateral ?? null,
      detail: {
        aggregation: 'confidence-weighted mean over session windows',
        windows_total: windows.length,
        windows_measured: measured.length,
        session_coverage: coverage.toFixed(2),
        score_min: scores[0],
        score_median: scores[Math.floor(scores.length / 2)],
        score_max: scores[scores.length - 1],
        last_window_detail: measured[measured.length - 1].detail ?? {},
      },
    };
  }
  return out;
}

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

    /** Résultats des fenêtres déjà analysées (voir CONFIG.WINDOW_FRAMES) */
    this._windowResults = [];

    /** Frames accumulées depuis la dernière fenêtre close */
    this._framesSinceWindow = 0;

    /** Total des frames reçues sur la session (le buffer, lui, est glissant) */
    this._totalFrames = 0;

    /** Modes de saisie traversés par la séance ('camera' | 'touch') */
    this._modesSeen = new Set();
    this._currentMode = 'camera';
  }

  // ── Cycle de vie ────────────────────────────────────────────────────────────

  /** Démarre une nouvelle session de tracking */
  startSession(meta = {}) {
    this._frameBuffer   = [];
    this._currentResults = null;
    this._sessionMeta   = { ...meta, timestamp: new Date().toISOString() };
    this._lastTimestamp = null;
    this._running = true;
    this._windowResults = [];
    this._framesSinceWindow = 0;
    this._totalFrames = 0;
    this._currentMode = meta.inputMode || 'camera';
    this._modesSeen = new Set([this._currentMode]);
    console.log('[ReflexEngine] Session démarrée', this._sessionMeta);
  }

  /** Arrête le tracking et retourne l'analyse de TOUTE la session */
  endSession() {
    this._running = false;

    // Close the final partial window, if it holds enough frames to mean anything.
    if (this._framesSinceWindow >= CONFIG.MIN_TAIL_FRAMES) {
      this._closeWindow();
    }

    /* No window ever completed — a session shorter than one window, or one in
       which the engine received nothing at all. Fall back to whatever is in the
       buffer rather than returning nothing. */
    if (this._windowResults.length === 0) {
      const results = formatOutput(
        this._frameBuffer.length >= CONFIG.MIN_FRAMES_REQUIRED
          ? _runDetectors(this._frameBuffer)
          : {},
        this._sessionContext(),
      );
      console.log('[ReflexEngine] Session terminée — frames reçues :', this._totalFrames,
                  '| aucune fenêtre complète, analyse du buffer :', this._frameBuffer.length);
      return results;
    }

    const aggregated = _aggregateWindows(this._windowResults);
    this._currentResults = formatOutput(aggregated, this._sessionContext());
    console.log('[ReflexEngine] Session terminée — frames reçues :', this._totalFrames,
                '| fenêtres analysées :', this._windowResults.length);
    return this._currentResults;
  }

  /**
   * Signale un changement de mode de saisie en cours de séance.
   *
   * Le mode tactile n'ouvre pas la caméra : aucune image n'atteint le moteur et
   * aucun réflexe ne PEUT être observé. Sans cette information, le rapport dit
   * « Not Measured » exactement comme une séance caméra dont la webcam a
   * lâché — deux situations très différentes pour l'ergothérapeute qui le lit.
   *
   * Le passage caméra → tactile clôt aussi la fenêtre en cours, pour que les
   * images déjà mesurées à la caméra ne soient pas perdues au profit d'une
   * fenêtre qui ne se remplira plus.
   */
  setInputMode(mode) {
    const next = mode === 'touch' ? 'touch' : 'camera';
    if (next === this._currentMode) return;
    if (this._framesSinceWindow >= CONFIG.MIN_TAIL_FRAMES) this._closeWindow();
    else this._framesSinceWindow = 0;
    this._currentMode = next;
    this._modesSeen.add(next);
  }

  /** Analyse la fenêtre qui vient de se remplir et n'en garde que le résultat. */
  _closeWindow() {
    const n = Math.min(this._framesSinceWindow, this._frameBuffer.length);
    const window = this._frameBuffer.slice(-n);
    this._framesSinceWindow = 0;
    if (window.length < CONFIG.MIN_FRAMES_REQUIRED) return;
    this._windowResults.push(_runDetectors(window));
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
    this._totalFrames++;
    this._framesSinceWindow++;

    // Buffer circulaire
    if (this._frameBuffer.length > CONFIG.MAX_BUFFER_FRAMES) {
      this._frameBuffer.shift();
    }

    /* A window closes as soon as it is full, while its frames are still in the
       ring. Only the result survives. */
    if (this._framesSinceWindow >= CONFIG.WINDOW_FRAMES) {
      this._closeWindow();
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

    // ── Formater et retourner ─────────────────────────────────────────────────
    this._currentResults = formatOutput(_runDetectors(buffer), this._sessionMeta);
    return this._currentResults;
  }

  // ── Accès aux résultats ─────────────────────────────────────────────────────

  /** Métadonnées de session enrichies, transmises au formateur. */
  _sessionContext() {
    const modes = [...this._modesSeen];
    const touchOnly = modes.length === 1 && modes[0] === 'touch';
    return {
      ...this._sessionMeta,
      inputModes: modes,
      windows: this._windowResults.length,
      totalFrames: this._totalFrames,
      /* Named so the report can say WHY nothing was measured. */
      noDataReason: touchOnly
        ? 'Touch mode — the camera was not opened, so no reflex can be observed'
        : this._totalFrames === 0
          ? 'No camera frame reached the engine during this session'
          : 'No usable observation in the frames received',
    };
  }

  /** Retourne les derniers résultats calculés */
  getCurrentResults() {
    return this._currentResults;
  }

  /** Retourne le nombre de frames dans le buffer glissant */
  getFrameCount() {
    return this._frameBuffer.length;
  }

  /** Retourne le nombre total de frames reçues depuis le début de la session */
  getTotalFrameCount() {
    return this._totalFrames;
  }

  /** Nombre de fenêtres complètes déjà analysées */
  getWindowCount() {
    return this._windowResults.length;
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

    /* Unmeasured reflexes are NOT sent as scores. `_labelToAiScore` inverts the
       retention score, so a reflex with no data (retention 0) went to Supabase
       as 100 — "perfectly integrated" — for every reflex the camera never
       observed. Eight rows of invented good news per session. They are still
       returned, flagged, so the dashboard can say "not measured" instead of
       silently showing nothing. */
    return Object.values(engineOutput.reflexes).map(r => {
      const measured = r.measured !== false && typeof r.score === 'number';
      return {
        reflex:          r.reflex_key,
        measured,
        score:           measured ? _retentionToAiScore(r.score) : null,
        /* The measured confidence, not a word derived from the label. A score
           computed on a tenth of the frames used to be reported as "High"
           purely because the label came out "strong". */
        confidence:      _confidenceToLevel(r.confidence),
        confidence_value: Number((r.confidence ?? 0).toFixed(3)),
        impact:          r.education?.explanation?.slice(0, 100) || '',
        label:           r.label,
        explanation:     r.education?.explanation || '',
        activities:      measured ? (r.education?.activities || []) : [],
        podcast:         r.education?.podcast    || null,
        indicators_found: [],
        exercises:       [],
        /* Nothing is actionable on a measurement that was never taken, or one
           the engine itself does not trust. */
        actionable:      measured
          && (r.confidence ?? 0) >= MIN_REPORTABLE_CONFIDENCE
          && (r.label === 'strong' || r.label === 'moderate'),
      };
    });
  }
}

// ── Helpers internes ──────────────────────────────────────────────────────────

/** Convertit un score de rétention [0-100] en score aiEngine (10–100, 100 = intégré) */
function _retentionToAiScore(retentionScore) {
  return Math.max(10, Math.min(100, 100 - retentionScore));
}

/** Niveau de confiance texte, dérivé de la confiance RÉELLEMENT mesurée */
function _confidenceToLevel(confidence) {
  const c = confidence ?? 0;
  if (c >= 0.7) return 'High';
  if (c >= MIN_REPORTABLE_CONFIDENCE) return 'Medium';
  return 'Low';
}

// ── Singleton exporté ─────────────────────────────────────────────────────────

/** Instance partagée du moteur (singleton pour usage en React) */
export const reflexEngine = new ReflexEngine();

/** Ré-exporter les métadonnées éducatives pour usage direct */
export { REFLEX_EDUCATION, formatOutput, MIN_REPORTABLE_CONFIDENCE };
