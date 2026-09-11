/**
 * GameResults.jsx
 * ---------------------------------------------------------------------------
 * ONE score page for every game on the platform.
 *
 * Each game keeps its own scoring maths — a pinch is not a trace and should not
 * be scored like one — and hands the finished numbers to this component. What
 * is shared is the SHAPE of the report and the language it uses, so a parent
 * who has read one game's report can read all of them, and a therapist
 * comparing two sessions is comparing like with like.
 *
 * The page reads top to bottom as one argument:
 *
 *   1. How did it go?     headline score, stars, whether the round was finished
 *   2. What made it up?   the weighted sub-scores behind that headline
 *   3. What happened?     raw session detail (time, attempts, errors)
 *   4. What is it FOR?    the reflex patterns this activity works on, with a
 *                         measurement beside any the camera could actually see
 *
 * Section 4 is the point of the platform, so it is part of the report rather
 * than an appendix — but it is careful about the difference between what the
 * activity TARGETS and what this session MEASURED. See services/reflexProfiles.js.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { RotateCcw, Home, Info, Download } from 'lucide-react';
import {
  getGameProfile, buildReflexSections, hasAnyMeasurement, REPORT_DISCLAIMER,
} from '../../services/reflexProfiles';
import { downloadGameReport } from '../../services/reportBuilder';
import '../../styles/GameResults.css';

const TIER_LABEL = { primary: 'Main focus', secondary: 'Also works on' };

/** Percent, or an em dash when the value was never measured (never 0, never 100). */
const pct = (v) => (v == null ? '—' : `${Math.round(v)}%`);

function StarRow({ earned = 0, total = 3 }) {
  return (
    <div className="gr-stars" role="img" aria-label={`${earned} of ${total} stars`}>
      {Array.from({ length: total }, (_, i) => (
        <motion.span
          key={i}
          className={i < earned ? 'gr-star on' : 'gr-star off'}
          initial={{ scale: 0, rotate: -140 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.15 + i * 0.12, type: 'spring', stiffness: 260, damping: 16 }}
        >
          {i < earned ? '★' : '☆'}
        </motion.span>
      ))}
    </div>
  );
}

/** The headline number as a ring. Renders a dash, not a zero, when unmeasured. */
function ScoreRing({ value, caption }) {
  const measured = value != null && Number.isFinite(value);
  return (
    <div className={`gr-ring ${measured ? '' : 'is-empty'}`} style={{ '--pct': measured ? value : 0 }}>
      <div className="gr-ring-inner">
        <span className="gr-ring-value">{measured ? Math.round(value) : '—'}</span>
        <span className="gr-ring-caption">{caption}</span>
      </div>
    </div>
  );
}

function Breakdown({ rows }) {
  if (!rows?.length) return null;
  return (
    <ul className="gr-bars">
      {rows.map(({ label, value, weight }) => (
        <li className="gr-bar" key={label}>
          <div className="gr-bar-head">
            <span className="gr-bar-label">
              {label}
              {weight ? <em className="gr-bar-weight">{weight}</em> : null}
            </span>
            <strong className={`gr-bar-value ${value == null ? 'is-empty' : ''}`}>{pct(value)}</strong>
          </div>
          <div className="gr-bar-track">
            <motion.div
              className="gr-bar-fill"
              initial={{ width: 0 }}
              animate={{ width: `${value == null ? 0 : value}%` }}
              transition={{ duration: 0.65, delay: 0.25, ease: 'easeOut' }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function MetricTiles({ metrics }) {
  if (!metrics?.length) return null;
  return (
    <div className="gr-tiles">
      {metrics.map(({ icon, value, label }) => (
        <div className="gr-tile" key={label}>
          {icon ? <div className="gr-tile-icon" aria-hidden="true">{icon}</div> : null}
          <div className="gr-tile-value">{value}</div>
          <div className="gr-tile-label">{label}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * One reflex, exactly as services/reflexProfiles.js prepared it. This component
 * decides how the finding looks and never what it is — the PDF renders the same
 * entries, so anything worked out here would be a second opinion.
 */
function ReflexCard({ entry }) {
  const { key, name, tier, why, measured, score, statusText, statusHint, tone, blockedReason } = entry;
  return (
    <li className={`gr-reflex ${measured ? `is-${tone}` : 'is-target'}`}>
      <div className="gr-reflex-top">
        <div className="gr-reflex-id">
          <span className="gr-reflex-key">{key}</span>
          {name && name !== key ? <span className="gr-reflex-name">{name}</span> : null}
        </div>
        {tier ? <span className={`gr-tier gr-tier-${tier}`}>{TIER_LABEL[tier] || tier}</span> : null}
      </div>

      {why ? <p className="gr-reflex-why">{why}</p> : null}

      {measured ? (
        <div className="gr-reflex-measure">
          <div className="gr-reflex-status">
            <span className={`gr-dot gr-dot-${tone}`} aria-hidden="true" />
            <span className="gr-reflex-status-text">{statusText}</span>
            <span className="gr-reflex-status-hint">{statusHint}</span>
          </div>
          <div className="gr-reflex-track" aria-hidden="true">
            <motion.div
              className={`gr-reflex-fill tone-${tone}`}
              initial={{ width: 0 }}
              animate={{ width: `${score}%` }}
              transition={{ duration: 0.6, delay: 0.3, ease: 'easeOut' }}
            />
          </div>
        </div>
      ) : (
        <div className="gr-reflex-note">
          {blockedReason || 'Practised this round — no clear observation to score.'}
        </div>
      )}
    </li>
  );
}

export default function GameResults({
  gameId,
  emoji = '🎉',
  title,
  subtitle,
  endedEarly = false,
  headline,                 // { value, caption }
  stars,                    // { earned, total }
  breakdown = [],           // [{ label, value, weight }]
  metrics = [],             // [{ icon, value, label }]
  reflexMeasurements = null,// { [reflexKey]: formatted reflex from the engine }
  notMeasuredReason,
  onPlayAgain,
  onExit,
  playAgainLabel = 'Play again',
  exitLabel = 'Back to games',
  actionsExtra = null,
  /* Set false to hide the download, or pass `pdfExtras` to add the things only
     some games carry (learner name, session id, narrative, exercises). The PDF
     is drawn from the same model this component renders, so the two cannot
     drift — see services/reportBuilder.js. */
  downloadable = true,
  pdfExtras = null,
  children,
  className = '',
}) {
  const profile = getGameProfile(gameId);
  /* Assembled once, in services/reflexProfiles.js, and handed to the PDF
     unchanged, so the print-out states the same findings as the screen. */
  const sections = buildReflexSections(gameId, reflexMeasurements);
  const anyMeasured = hasAnyMeasurement(sections);

  const handleDownload = React.useCallback(() => {
    downloadGameReport({
      gameId,
      gameName: profile?.name || gameId,
      title: title || (endedEarly ? 'Session stopped early' : 'Session complete'),
      subtitle,
      endedEarly,
      headline,
      breakdown,
      metrics,
      sections,
      notMeasuredReason: anyMeasured ? null : notMeasuredReason,
    }, pdfExtras || {});
  }, [gameId, profile, title, subtitle, endedEarly, headline, breakdown,
      metrics, sections, anyMeasured, notMeasuredReason, pdfExtras]);

  return (
    <div className={`gr-root ${className}`}>
      <motion.div
        className="gr-card"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 190, damping: 22 }}
      >
        {/* ── 1. How did it go? ─────────────────────────────────────────── */}
        <header className="gr-head">
          <div className="gr-head-emoji" aria-hidden="true">{emoji}</div>
          <div className="gr-head-text">
            <h1 className="gr-title">
              {title || (endedEarly ? 'Session stopped early' : 'Session complete')}
            </h1>
            {subtitle ? <p className="gr-subtitle">{subtitle}</p> : null}
            {profile ? <p className="gr-game-name">{profile.name}</p> : null}
          </div>
          {stars ? <StarRow earned={stars.earned} total={stars.total ?? 3} /> : null}
        </header>

        {endedEarly && (
          <div className="gr-flag">
            <Info size={15} aria-hidden="true" />
            <span>
              This round was stopped before the end, so the scores below cover
              only the part that was played.
            </span>
          </div>
        )}

        {/* ── 2. What made up the score? ────────────────────────────────── */}
        {(headline || breakdown.length > 0) && (
          <section className="gr-section gr-performance">
            {headline ? (
              <ScoreRing value={headline.value} caption={headline.caption || 'Score'} />
            ) : null}
            <div className="gr-performance-bars">
              <h2 className="gr-section-title">Performance</h2>
              <Breakdown rows={breakdown} />
            </div>
          </section>
        )}

        {/* ── 3. What happened? ─────────────────────────────────────────── */}
        {metrics.length > 0 && (
          <section className="gr-section gr-detail">
            <h2 className="gr-section-title">Session detail</h2>
            <MetricTiles metrics={metrics} />
          </section>
        )}

        {/* ── 4. What is the activity for? ──────────────────────────────── */}
        {sections.map((section, i) => (
          <section className="gr-section gr-reflexes" key={section.group}>
            <h2 className="gr-section-title">{section.title}</h2>
            <p className="gr-section-blurb">{section.blurb}</p>

            {i === 0 && !anyMeasured && notMeasuredReason && (
              <div className="gr-flag gr-flag-quiet">
                <Info size={15} aria-hidden="true" />
                <span>{notMeasuredReason}</span>
              </div>
            )}

            <ul className="gr-reflex-list">
              {section.entries.map((e) => <ReflexCard key={e.key} entry={e} />)}
            </ul>
          </section>
        ))}

        {children}

        <p className="gr-disclaimer">{REPORT_DISCLAIMER}</p>

        {/* ── Actions ───────────────────────────────────────────────────── */}
        {(onPlayAgain || onExit || actionsExtra || downloadable) && (
          <div className="gr-actions">
            {onPlayAgain && (
              <button type="button" className="gr-btn gr-btn-primary" onClick={onPlayAgain}>
                <RotateCcw size={18} aria-hidden="true" />
                {playAgainLabel}
              </button>
            )}
            {downloadable && (
              <button type="button" className="gr-btn gr-btn-secondary" onClick={handleDownload}>
                <Download size={18} aria-hidden="true" />
                Download report
              </button>
            )}
            {actionsExtra}
            {onExit && (
              <button type="button" className="gr-btn gr-btn-secondary" onClick={onExit}>
                <Home size={18} aria-hidden="true" />
                {exitLabel}
              </button>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
