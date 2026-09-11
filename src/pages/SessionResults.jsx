/**
 * SessionResults.jsx — LetterQuest's score page.
 *
 * This is the REFERENCE implementation of the platform report. It is built on
 * the shared <GameResults> component (components/game/GameResults.jsx), and
 * every other game's results screen follows the same shape.
 *
 * LetterQuest is the only game that can feed the head- and face-based reflex
 * detectors — it runs Face Mesh with iris, head pose and two hands — so it is
 * the only one that passes real measurements into the reflex section. The
 * others declare what their activity trains and measure what their sensors
 * allow. See services/reflexProfiles.js.
 *
 * Two things about the data that are easy to get wrong:
 *
 *   `reflexEngineOutput.reflexes[key].score`  is a RETENTION score.
 *                                             High = the pattern is still active.
 *   `analysis.reflex_scores[i].score`         is an INTEGRATION score, already
 *                                             inverted by toAiEngineFormat.
 *                                             High = integrated = good.
 *
 * They point in opposite directions. GameResults expects retention, so the
 * engine output is preferred and the fallback below re-inverts.
 */
import React from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import GameResults from '../components/game/GameResults';
import { useAuthStore } from '../store';
import { reflexMapFromStoredRows } from '../services/reflexProfiles';
import api from '../services/api';

/* Where "Play again" sends each game that finishes on this route. */
const REPLAY_ROUTE = {
  letterquest: '/play/difficulty',
  'path-tracing': '/play/path-difficulty',
};

const FEEDBACK_OPTIONS = [
  { rating: 1, emoji: '😫', label: 'Too hard' },
  { rating: 2, emoji: '😕', label: 'Difficult' },
  { rating: 3, emoji: '😐', label: 'Medium' },
  { rating: 4, emoji: '🙂', label: 'Good' },
  { rating: 5, emoji: '🤩', label: 'Great!' },
];

/** Seconds → m:ss, so the report reads like a clock rather than a number. */
function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Whatever this session carried, expressed in retention scores.
 * The engine output is preferred; stored rows are inverted back by the shared
 * helper so the screen and the PDF cannot disagree about direction.
 */
function buildReflexMap(reflexEngineOutput, analysis) {
  if (reflexEngineOutput?.reflexes) return reflexEngineOutput.reflexes;
  return reflexMapFromStoredRows(analysis?.reflex_scores);
}

export default function SessionResults() {
  const { sessionId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const [feedbackSubmitted, setFeedbackSubmitted] = React.useState(false);
  const profile = useAuthStore((st) => st.profile);

  const analysis = state?.analysis;
  const reflexEngineOutput = state?.reflexEngineOutput;
  /* This route is shared: LetterQuest and Path Tracing both land here, and both
     run the full tracking stack. The sender says which game it was; anything
     that does not say is LetterQuest, which is the only game that used this
     route before Path Tracing joined it. */
  const gameId = state?.gameId || 'letterquest';

  const submitFeedback = async (rating) => {
    try {
      await api.post(`/sessions/${sessionId}/feedback`, { rating });
      setFeedbackSubmitted(true);
      toast.success('Feedback saved successfully!');
    } catch { toast.error('Could not save feedback'); }
  };

  const metrics = analysis?.metrics || {};
  const isHappyPath = analysis?.scenario === 'happy_path';
  const accuracyPct = Math.round((metrics.accuracy || 0) * 100);
  const reflexMap = buildReflexMap(reflexEngineOutput, analysis);

  /* Why the reflex section may be empty. A touch-mode round never opened the
     camera and a webcam failure looks identical without this sentence. */
  const notMeasuredReason = analysis?.camera_used === false
    ? 'This round was played in touch mode, so the camera never ran. Play in '
      + '“hand in air” mode to measure reflex patterns.'
    : (analysis?.reflex_not_measured_reason
      || 'The camera did not get a clear enough view to measure reflex patterns this round.');

  /* The components behind the LPI. No weights are shown because the LPI is not
     a weighted mean of these — claiming one would be inventing a formula. */
  const breakdown = [
    { label: 'Letter accuracy', value: metrics.accuracy != null ? metrics.accuracy * 100 : null },
    {
      label: 'Movement smoothness',
      value: metrics.trajectory_smoothness != null ? metrics.trajectory_smoothness * 100 : null,
    },
    {
      label: 'Stamina through the round',
      value: metrics.fatigue_index != null ? (1 - metrics.fatigue_index) * 100 : null,
    },
  ];

  const tiles = [
    { icon: '🎯', value: `${accuracyPct}%`, label: 'Accuracy' },
    { icon: '⚡', value: `${((metrics.avg_response_time_ms || 0) / 1000).toFixed(1)}s`, label: 'Avg response' },
    { icon: '✅', value: metrics.perfect_grabs ?? 0, label: 'Perfect selections' },
    { icon: '🔤', value: metrics.total_attempts ?? 0, label: 'Total attempts' },
    { icon: '↔️', value: metrics.midline_crossings ?? 0, label: 'Midline crossings' },
    { icon: '⏱️', value: formatDuration(metrics.duration_seconds), label: 'Time played' },
  ];

  return (
    <GameResults
      gameId={gameId}
      emoji={isHappyPath ? '🏆' : '💪'}
      title={isHappyPath ? 'Great session!' : 'Session complete'}
      subtitle={isHappyPath
        ? 'You’re improving — keep it up!'
        : 'Every session builds strength. Well done!'}
      headline={{ value: analysis?.lpi_score ?? null, caption: 'LPI Score' }}
      breakdown={breakdown}
      metrics={tiles}
      reflexMeasurements={reflexMap}
      notMeasuredReason={notMeasuredReason}
      /* The download draws the model rendered above, plus the things only this
         route carries — the AI narrative and the recommended activities — so
         the print-out is the screen with nothing added and nothing lost. */
      pdfExtras={{
        learnerName: [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || undefined,
        sessionId,
        date: new Date().toISOString().slice(0, 10),
        narrative: analysis?.narrative,
        recommendations: analysis?.recommendations,
        exercises: analysis?.exercises,
      }}
      /* "Play again" goes back to this game's own difficulty picker rather than
         the games list, because this route is shared: LetterQuest and Path
         Tracing both end here and each has its own. */
      onPlayAgain={() => navigate(REPLAY_ROUTE[gameId] || '/play')}
      onExit={() => navigate('/play')}
      playAgainLabel="Play again"
      exitLabel="Back to games"
    >
      {analysis?.narrative && (
        <section className="gr-section">
          <h2 className="gr-section-title">What we noticed</h2>
          <div className="sr-narrative">
            <span className="sr-narrative-icon" aria-hidden="true">🧠</span>
            <p className="sr-narrative-text">{analysis.narrative}</p>
          </div>
        </section>
      )}

      <section className="gr-section">
        <h2 className="gr-section-title">How was this session?</h2>
        {feedbackSubmitted ? (
          <p className="gr-section-blurb">Thanks — that helps us adapt the next exercises.</p>
        ) : (
          <>
            <p className="gr-section-blurb">Your feedback helps us adapt the next exercises.</p>
            <div className="sr-feedback">
              {FEEDBACK_OPTIONS.map((opt) => (
                <button
                  key={opt.rating}
                  type="button"
                  className="sr-feedback-btn"
                  onClick={() => submitFeedback(opt.rating)}
                >
                  <span className="sr-feedback-emoji">{opt.emoji}</span>
                  <span className="sr-feedback-label">{opt.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </section>

    </GameResults>
  );
}
