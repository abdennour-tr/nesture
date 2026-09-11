/**
 * Nesture AI – Primitive Reflex Analysis Engine v2.0 (JavaScript)
 *
 * Moteur post-session basé sur des règles.
 * Mappe les données gestuelles d'une session vers des scores de réflexes
 * et génère des recommandations OT enrichies de métadonnées éducatives.
 *
 * Détection de patrons développementaux (non diagnostique)
 */

import { REFLEX_EDUCATION } from './reflexEngine/outputFormatter.js';

const REFLEX_RULES = [
  {
    name: 'Moro',
    impact: 'Startle / sensory hypersensitivity',
    indicators: ['high_fail_rate', 'frequent_withdrawal', 'high_head_hand_coupling'],
    exercises: ['ex-001', 'ex-002', 'ex-003'],
  },
  {
    name: 'ATNR',
    impact: 'Difficulty crossing the midline',
    indicators: ['midline_avoidance', 'left_right_asymmetry', 'head_hand_coupling'],
    exercises: ['ex-004', 'ex-005', 'ex-006'],
  },
  {
    name: 'STNR',
    impact: 'Posture / stability in sitting position',
    indicators: ['frequent_breaks', 'postural_fatigue', 'early_fatigue'],
    exercises: ['ex-007', 'ex-008'],
  },
  {
    name: 'TLR',
    impact: 'Balance / postural tone',
    indicators: ['slow_response', 'spatial_drift', 'poor_trajectory'],
    exercises: ['ex-009', 'ex-010'],
  },
  /* ── Spinal Galant is NOT inferred from gameplay ──────────────────────────
     It used to sit here, scored from `erratic_control`, `high_variability` and
     `high_invalid_rate` — that is, from cursor wobble, session fatigue and
     mis-hits.

     Spinal Galant is elicited by stroking the skin alongside the spine. A
     camera pointed at a seated child's hands and face cannot observe it under
     any circumstances, and the three indicators above have a hundred other
     causes: an unfamiliar game, a tired child, a slow laptop. Scoring a reflex
     from them puts a finding in a therapist's report that no observation
     supports.

     It remains in REFLEX_EDUCATION so the questionnaire and a practitioner's
     own observation can still record it — see OBSERVATION_UNAVAILABLE in
     services/reflexProfiles.js. It is simply no longer guessed at from play. */
  {
    name: 'Palmar Grasp',
    impact: 'Fine motor skills / grip precision',
    indicators: ['slow_timing', 'missed_accurate_grabs', 'precision_difficulty'],
    exercises: ['ex-013', 'ex-014', 'ex-015'],
  },
  // ── Nouveaux réflexes v2.0 ─────────────────────────────────────────────────
  {
    name: 'VOR',
    impact: 'Visual stabilization / oculomotor tracking',
    indicators: ['poor_trajectory', 'spatial_drift', 'slow_response'],
    exercises: ['ex-016', 'ex-017'],
  },
  {
    name: 'Babkin',
    impact: 'Hand-mouth dissociation / oral motor skills',
    indicators: ['high_head_hand_coupling', 'precision_difficulty', 'erratic_control'],
    exercises: ['ex-018', 'ex-019'],
  },
  {
    name: 'Hand-to-Mouth',
    impact: 'Oral sensory regulation / hand-mouth behavior',
    indicators: ['frequent_withdrawal', 'high_fail_rate', 'erratic_control'],
    exercises: ['ex-020', 'ex-021'],
  },
  {
    name: 'Eye Coordination',
    impact: 'Binocular coordination / visual processing',
    indicators: ['spatial_drift', 'poor_trajectory', 'slow_response'],
    exercises: ['ex-022', 'ex-023'],
  },
  {
    name: 'Visual Tracking',
    impact: 'Visual attention / reading / spatial awareness',
    indicators: ['slow_response', 'spatial_drift', 'high_variability'],
    exercises: ['ex-024', 'ex-025'],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeFloat(val, def = 0.0) {
  if (val === null || val === undefined || val === '') return def;
  const n = parseFloat(val);
  return isNaN(n) ? def : n;
}

function safeInt(val, def = 0) {
  if (val === null || val === undefined || val === '') return def;
  const n = parseInt(parseFloat(val));
  return isNaN(n) ? def : n;
}

// ── Core ──────────────────────────────────────────────────────────────────────

function _calculateMetrics(session, gestures) {
  const total    = Math.max(safeInt(session.total_attempts, 0), 1);
  const perfect  = safeInt(session.perfect_grabs, 0);
  const failed   = safeInt(session.failed_grabs, 0);
  const skipped  = safeInt(session.skipped, 0);
  const accuracy = perfect / total;
  const avgRt    = safeFloat(session.avg_response_time_ms, 4000);
  const smoothness = safeFloat(session.trajectory_smoothness, 0.5);
  const fatigue    = safeFloat(session.fatigue_index, 0.5);
  const midline    = safeInt(session.midline_crossings, 0);

  let avgHhc;
  if (gestures && gestures.length > 0) {
    const hhcVals = gestures
      .filter(g => g.head_hand_coupling !== undefined && g.head_hand_coupling !== null)
      .map(g => safeFloat(g.head_hand_coupling, 0.5));
    avgHhc = hhcVals.length > 0
      ? hhcVals.reduce((a, b) => a + b, 0) / hhcVals.length
      : 0.5;
  } else {
    avgHhc = safeFloat(session.head_hand_coupling, 0.5);
  }

  return {
    accuracy,
    fail_rate:             failed / total,
    skip_rate:             skipped / total,
    avg_response_time_ms:  avgRt,
    trajectory_smoothness: smoothness,
    fatigue_index:         fatigue,
    midline_crossings:     midline,
    avg_head_hand_coupling: avgHhc,
    total_attempts:        total,
    perfect_grabs:         perfect,
    failed_grabs:          failed,
    skipped,
    duration_seconds:      safeInt(session.duration_seconds, 0),
  };
}

function _detectIndicators(m) {
  return {
    // Moro
    high_fail_rate:           m.fail_rate > 0.50,
    frequent_withdrawal:      m.skip_rate > 0.15,
    high_head_hand_coupling:  m.avg_head_hand_coupling > 0.70,
    // ATNR
    midline_avoidance:        m.midline_crossings < 5,
    left_right_asymmetry:     false,
    head_hand_coupling:       m.avg_head_hand_coupling > 0.60,
    // STNR
    frequent_breaks:          m.skip_rate > 0.12,
    postural_fatigue:         m.fatigue_index > 0.55,
    early_fatigue:            m.fatigue_index > 0.65,
    // TLR
    slow_response:            m.avg_response_time_ms > 8000,
    spatial_drift:            m.trajectory_smoothness < 0.45,
    poor_trajectory:          m.trajectory_smoothness < 0.40,
    /* Kept because other rules reference them (Babkin reads `erratic_control`,
       Visual Tracking reads `high_variability`). They no longer feed a Spinal
       Galant score — see the note in REFLEX_RULES. */
    erratic_control:          m.trajectory_smoothness < 0.42,
    high_variability:         m.fatigue_index > 0.60,
    high_invalid_rate:        (m.total_attempts > 0 &&
                               (m.invalid || 0) / m.total_attempts > 0.15),
    // Palmar Grasp
    slow_timing:              m.avg_response_time_ms > 6000,
    missed_accurate_grabs:    m.fail_rate > 0.30 && m.trajectory_smoothness > 0.55,
    precision_difficulty:     m.fail_rate > 0.25,
  };
}

function _scoreReflexes(indicators, metrics) {
  return REFLEX_RULES.map(rule => {
    const found  = rule.indicators.filter(ind => indicators[ind] === true);
    const count  = found.length;
    const confidence = count >= 3 ? 'High' : (count === 2 ? 'Medium' : 'Low');

    const accPenalty    = (1 - metrics.accuracy) * 25;
    const smoothPenalty = (1 - metrics.trajectory_smoothness) * 15;
    const rtS           = metrics.avg_response_time_ms / 1000;
    const rtPenalty     = Math.min(10, Math.max(0, (rtS - 2.0) * 2));
    const indicatorPenalty = count * 15;

    const baseScore = 100 - accPenalty - smoothPenalty - rtPenalty - indicatorPenalty;
    const score     = Math.max(10, Math.min(100, Math.round(baseScore)));

    // ── Génération du label v2.0 ──────────────────────────────────────────────
    // score aiEngine : 100 = integrated, 10 = strong retention
    const label = score < 35 ? 'strong'
      : score < 55 ? 'moderate'
      : score < 75 ? 'weak'
      : 'none';

    // ── Educational Metadata ────────────────────────────────────────────────
    const edu = REFLEX_EDUCATION[rule.name] || {};

    return {
      reflex:           rule.name,
      impact:           rule.impact,
      confidence,
      score,
      label,
      indicators_found: found,
      exercises:        rule.exercises,
      actionable:       confidence === 'High' || confidence === 'Medium',
      // Educational Metadata
      education: {
        full_name:    edu.fullName    || rule.name,
        explanation:  edu.explanation || '',
        activities:   edu.activities  || [],
        podcast:      edu.podcast     || null,
        category:     edu.category    || '',
      },
      disclaimer: 'Developmental patterns detection (non-diagnostic)',
    };
  });
}

function _generateRecommendations(reflexScores) {
  const recs = [];
  const seen = new Set();

  const priority = [
    ...reflexScores.filter(r => r.confidence === 'High'),
    ...reflexScores.filter(r => r.confidence === 'Medium'),
  ];

  for (const reflex of priority) {
    for (const exId of reflex.exercises) {
      if (!seen.has(exId)) {
        recs.push({
          exercise_id:   exId,
          target_reflex: reflex.reflex,
          reason:        `Supports integration of the ${reflex.reflex} reflex (${reflex.impact})`,
          label:         reflex.label,
          activities:    reflex.education?.activities || [],
        });
        seen.add(exId);
      }
      if (recs.length >= 5) break;
    }
    if (recs.length >= 5) break;
  }

  return recs.slice(0, 5);
}

function _generateNarrative(metrics, reflexScores) {
  const accuracyPct = Math.round(metrics.accuracy * 100);
  const rtS         = (metrics.avg_response_time_ms / 1000).toFixed(1);
  const highFlags   = reflexScores.filter(r => r.confidence === 'High');
  const mediumFlags = reflexScores.filter(r => r.confidence === 'Medium');

  let summary;
  if (metrics.accuracy >= 0.80) {
    summary = `Excellent session! Accuracy reached ${accuracyPct}% with an average response time of ${rtS} seconds — both indicators show significant improvement. `;
  } else if (metrics.accuracy >= 0.65) {
    summary = `Good session with ${accuracyPct}% accuracy and an average response time of ${rtS}s. Motor coordination is progressing steadily. `;
  } else {
    summary = `This session presented some challenges — accuracy at ${accuracyPct}% with ${rtS}s average response time. This is normal — every session provides valuable data. `;
  }

  if (highFlags.length > 0) {
    const names = highFlags.slice(0, 2).map(r => r.reflex).join(' and ');
    summary += `AI identified the ${names} pattern as the main focus of work this week. `;
  } else if (mediumFlags.length > 0) {
    const names = mediumFlags.slice(0, 2).map(r => r.reflex).join(' and ');
    summary += `The ${names} patterns show activity to monitor. `;
  } else {
    summary += "No significant reflex patterns were detected this session. ";
  }

  summary += "The recommended exercises below are tailored to the motor patterns observed today.";
  return summary;
}

function _calculateLpi(metrics, reflexScores) {
  const accComponent    = metrics.accuracy * 40;
  const rtComponent     = Math.max(0, (1 - metrics.avg_response_time_ms / 10000)) * 25;
  const smoothComponent = metrics.trajectory_smoothness * 20;
  /* Les réflexes non mesurés valent null : les sommer donnait NaN, et le LPI
     affiché devenait « NaN » ou 0 selon la coercition en aval. */
  const scored          = reflexScores.filter(r => typeof r.score === 'number');
  const reflexAvg       = scored.length ? scored.reduce((s, r) => s + r.score, 0) / scored.length : null;
  /* Sans réflexe mesuré, la composante réflexe est retirée et les 15 points
     redistribués : un LPI amputé de 15 points par une caméra éteinte serait une
     pénalité infligée à l'enfant pour un choix de mode de saisie. */
  if (reflexAvg === null) {
    const base = accComponent + rtComponent + smoothComponent; // sur 85
    return Math.min(100, Math.round(base * (100 / 85)));
  }
  const reflexComponent = (reflexAvg / 100) * 15;
  return Math.min(100, Math.round(accComponent + rtComponent + smoothComponent + reflexComponent));
}

// ── Point d'entrée principal ──────────────────────────────────────────────────

/**
 * Analyse post-session — compatible avec le pipeline supabaseDB.endSession()
 *
 * @param {Object} session  - résumé de session (champs string, format CSV)
 * @param {Array}  gestures - liste de gestes enregistrés
 * @param {Object} [reflexEngineOutput] - sortie optionnelle du moteur temps réel
 * @returns {Object} résultat d'analyse structuré
 */
/**
 * Y a-t-il eu la moindre observation caméra sur laquelle fonder un réflexe ?
 *
 * `_scoreReflexes` dérive les onze réflexes de quatre nombres de séance —
 * précision, fluidité, temps de réponse, quelques booléens — et ne regarde
 * jamais la caméra. Il produisait donc onze scores complets pour une partie
 * jouée entièrement au doigt sur l'écran, caméra éteinte : un bilan de
 * réflexes primitifs construit sur des données qui n'existaient pas.
 * `safeFloat(..., 0.5)` y contribuait en remplaçant silencieusement chaque
 * mesure absente par une valeur médiane plausible.
 */
function _hasCameraEvidence(session, reflexEngineOutput) {
  if (reflexEngineOutput?.reflexes) {
    const anyMeasured = Object.values(reflexEngineOutput.reflexes)
      .some(r => r && r.measured === true);
    if (anyMeasured) return true;
    // Le moteur a tourné et n'a rien pu mesurer : c'est une réponse, pas un trou.
    return false;
  }
  // Séances plus anciennes, sans sortie du moteur : on se rabat sur les champs
  // qui n'existent que si la caméra a réellement tourné.
  return [session?.trajectory_smoothness, session?.head_hand_coupling,
          session?.midline_crossings]
    .some(v => v !== null && v !== undefined);
}

/** Réflexe non mesuré — jamais un score, jamais un label rassurant. */
function _notMeasured(rule, reason) {
  const edu = REFLEX_EDUCATION[rule.reflex] || {};
  return {
    ...rule,
    measured:   false,
    score:      null,
    label:      'not_measured',
    confidence: 'Low',
    actionable: false,
    indicators_found: [],
    not_measured_reason: reason,
    education: rule.education || {
      full_name: edu.fullName || rule.reflex,
      explanation: edu.explanation || '',
      activities: [], podcast: edu.podcast || null, category: edu.category || '',
    },
  };
}

export function analyseSession(session, gestures, reflexEngineOutput = null) {
  const metrics      = _calculateMetrics(session, gestures);
  const indicators   = _detectIndicators(metrics);
  let reflexScores   = _scoreReflexes(indicators, metrics)
    .map(r => ({ ...r, measured: true, source: 'heuristic' }));

  const cameraUsed = reflexEngineOutput
    ? reflexEngineOutput.camera_used !== false
    : true;
  const hasEvidence = _hasCameraEvidence(session, reflexEngineOutput);

  if (!hasEvidence) {
    /* Rien d'observable : les onze réflexes ressortent « non mesurés », avec la
       raison — « mode tactile » et « caméra en panne » ne se lisent pas pareil. */
    const reason = reflexEngineOutput?.summary?.no_data_reason
      || (!cameraUsed
        ? 'Touch mode — the camera was not opened, so no reflex can be observed'
        : 'No camera observation was available for this session');
    reflexScores = reflexScores.map(rs => _notMeasured(rs, reason));
  } else if (reflexEngineOutput && reflexEngineOutput.reflexes) {
    // ── Fusion avec les données temps réel ─────────────────────────────────
    reflexScores = reflexScores.map(rs => {
      const realtimeKey = Object.keys(reflexEngineOutput.reflexes).find(
        k => k.toLowerCase() === rs.reflex.toLowerCase()
      );
      if (!realtimeKey) return rs;

      const rt = reflexEngineOutput.reflexes[realtimeKey];
      /* Un réflexe que le moteur n'a pas pu mesurer ne peut pas être sauvé par
         l'heuristique : celle-ci ne regarde pas la caméra non plus. Sans cette
         garde, `(100 - null) * 0.6` valait 60 et transformait une absence de
         mesure en un score. */
      if (!rt || rt.measured === false || typeof rt.score !== 'number') {
        return _notMeasured(rs, rt?.detail?.reason || 'Not observable in this session');
      }

      // Pondérer : 60% données temps réel, 40% règles post-session
      const blendedScore = Math.round(
        (100 - rt.score) * 0.6 + rs.score * 0.4
      );
      return {
        ...rs,
        source:     'engine+heuristic',
        score:      Math.max(10, Math.min(100, blendedScore)),
        label:      rt.label || rs.label,
        confidence: rt.confidence >= 0.7 ? 'High' : rt.confidence >= 0.35 ? 'Medium' : 'Low',
        actionable: (rt.confidence ?? 0) >= 0.35 && (rt.label === 'strong' || rt.label === 'moderate'),
        realtime:   { score: rt.score, label: rt.label, confidence: rt.confidence, detail: rt.detail },
      };
    });
  }

  const recommendations = _generateRecommendations(reflexScores);
  const narrative       = _generateNarrative(metrics, reflexScores);
  const lpi             = _calculateLpi(metrics, reflexScores);

  const measuredCount = reflexScores.filter(r => r.measured !== false).length;
  return {
    metrics,
    reflex_scores:   reflexScores,
    /* Ce que l'écran de résultats a besoin de savoir pour ne pas afficher une
       grille vide qui ressemble à une panne. */
    reflexes_measured: measuredCount,
    camera_used:       cameraUsed,
    input_modes:       reflexEngineOutput?.input_modes || null,
    reflex_status:     measuredCount === 0
      ? (cameraUsed ? 'Not Measured' : 'Not Applicable (touch mode)')
      : (reflexEngineOutput?.summary?.overall_status || null),
    reflex_not_measured_reason: measuredCount === 0
      ? (reflexScores[0]?.not_measured_reason || null) : null,
    recommendations,
    narrative,
    lpi_score:       lpi,
    scenario:        metrics.accuracy >= 0.70 ? 'happy_path' : 'alternate_path',
    disclaimer:      'Developmental patterns detection (non-diagnostic)',
  };
}

export { REFLEX_RULES };
