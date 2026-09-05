import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { motion } from 'framer-motion';

// ── Couleur unique par réflexe ─────────────────────────────────────────────────
const REFLEX_META = {
  'Moro':            { color: '#EF4444', bg: '#FEE2E2', desc: 'Startle / hypersensitivity',      category: 'Survival' },
  'ATNR':            { color: '#F59E0B', bg: '#FEF9C3', desc: 'Midline crossing',                category: 'Posture' },
  'STNR':            { color: '#8B5CF6', bg: '#EDE9FE', desc: 'Posture / sitting',               category: 'Posture' },
  'TLR':             { color: '#3B82F6', bg: '#DBEAFE', desc: 'Balance / postural tone',         category: 'Vestibular' },
  'Spinal Galant':   { color: '#10B981', bg: '#D1FAE5', desc: 'Trunk coordination',              category: 'Trunk' },
  'Palmar Grasp':    { color: '#0D9488', bg: '#CCFBF1', desc: 'Fine motor / grip',               category: 'Grip' },
  'VOR':             { color: '#EC4899', bg: '#FCE7F3', desc: 'Vestibulo-ocular stabilization',  category: 'Vestibular' },
  'Babkin':          { color: '#F97316', bg: '#FFEDD5', desc: 'Hand-mouth link',                 category: 'Oral-motor' },
  'Hand-to-Mouth':   { color: '#84CC16', bg: '#ECFCCB', desc: 'Rooting / oral seeking',         category: 'Oral-motor' },
  'Eye Coordination':{ color: '#06B6D4', bg: '#CFFAFE', desc: 'Binocular coordination',          category: 'Oculomotor' },
  'Visual Tracking': { color: '#A855F7', bg: '#F3E8FF', desc: 'Visual pursuit latency',          category: 'Oculomotor' },
};

// ── Label → couleur badge ──────────────────────────────────────────────────────
const LABEL_COLORS = {
  'strong':       { bg: '#FEE2E2', text: '#EF4444' },
  'moderate':     { bg: '#FEF3C7', text: '#D97706' },
  'weak':         { bg: '#ECFCCB', text: '#65A30D' },
  'none':         { bg: '#DCFCE7', text: '#16A34A' },
  'not_measured': { bg: '#F3F4F6', text: '#6B7280' },
};

const LABEL_TEXT = {
  'strong':       'Strong',
  'moderate':     'Moderate',
  'weak':         'Mild',
  'none':         'Integrated',
  'not_measured': 'Not measured',
};

/* ── The score scale, stated once ───────────────────────────────────────────
   The number this card receives is an INTEGRATION score: 100 means the reflex
   is well integrated, 10 means strongly retained. The card's own fallback used
   to read it the other way round — `score >= 65 ? 'strong'` — so a child who
   scored 89, an excellent result, had every card on the results screen labelled
   "STRONG" in red. The panel read as an alarming finding when it was in fact
   the opposite, and because SessionResults never passed `label`, this fallback
   was what every parent actually saw.

   The thresholds below are the ones aiEngine itself uses, in the same
   direction. */
function labelFromIntegrationScore(score) {
  if (typeof score !== 'number') return 'not_measured';
  return score < 35 ? 'strong'
    : score < 55 ? 'moderate'
    : score < 75 ? 'weak'
    : 'none';
}

export default function ReflexScoreCard({ reflex, score, confidence, label, trend, compact, measured }) {
  const meta     = REFLEX_META[reflex] || { color: '#6B7280', bg: '#F3F4F6', icon: '🧠', desc: '', category: '' };

  /* A reflex with nothing behind it is rendered as such — not as a 0, which
     the scale above would read as "strongly retained". */
  const isMeasured = measured !== false && score !== null && score !== undefined && !Number.isNaN(Number(score));
  const numScore = isMeasured ? Number(score) : null;

  const resolvedLabel = !isMeasured
    ? 'not_measured'
    : (label && label !== 'not_measured' ? label : labelFromIntegrationScore(numScore));
  const lblStyle  = LABEL_COLORS[resolvedLabel] || LABEL_COLORS['not_measured'];
  const labelText = LABEL_TEXT[resolvedLabel] || resolvedLabel;
  /* Confidence is how much the measurement can be trusted — high confidence is
     good news about the measurement, whatever the finding. It was coloured red
     for "High" and green for "Low", which reads as the opposite. */
  const confColor = confidence === 'High' ? '#16A34A' : confidence === 'Medium' ? '#D97706' : '#9CA3AF';

  const TrendIcon  = trend === 'improving' ? TrendingUp : trend === 'declining' ? TrendingDown : Minus;
  const trendColor = trend === 'improving' ? '#10B981'  : trend === 'declining' ? '#EF4444'    : '#9CA3AF';

  // ── Compact ───────────────────────────────────────────────────────────────────
  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ y: -3, boxShadow: `0 10px 28px ${meta.color}30` }}
        style={{
          background: isMeasured ? meta.bg : '#F8FAFC',
          opacity: isMeasured ? 1 : 0.85,
          borderRadius: 12,
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          borderLeft: `4px solid ${isMeasured ? meta.color : '#CBD5E1'}`,
          boxShadow: isMeasured ? `0 2px 10px ${meta.color}18` : 'none',
        }}
      >
        {/* Name + label badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: '0.78rem', fontWeight: 700,
            color: '#1F2937', flex: 1,
            fontFamily: 'Inter, sans-serif',
          }}>
            {reflex}
          </span>
          <span style={{
            padding: '2px 7px', borderRadius: 99,
            background: lblStyle.bg, color: lblStyle.text,
            fontSize: '0.65rem', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
          }}>
            {labelText}
          </span>
        </div>

        {/* Category */}
        <div style={{ fontSize: '0.68rem', color: meta.color, fontWeight: 600 }}>
          {meta.category} · {meta.desc}
        </div>

        {/* Score */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
          {isMeasured ? (
            <>
              <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: '1.4rem', color: meta.color }}>
                {numScore}
              </span>
              <span style={{ fontSize: '0.7rem', color: '#9CA3AF' }}>/100</span>
            </>
          ) : (
            <span style={{ fontSize: '0.78rem', color: '#9CA3AF', fontWeight: 600, fontStyle: 'italic' }}>
              No observation this session
            </span>
          )}
        </div>

        {/* Progress bar — a bar at 0% would read as a measured floor. */}
        <div style={{ height: 5, background: 'rgba(0,0,0,0.08)', borderRadius: 99, overflow: 'hidden' }}>
          {isMeasured && (
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${numScore}%` }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
              style={{ height: '100%', background: meta.color, borderRadius: 99 }}
            />
          )}
        </div>
      </motion.div>
    );
  }

  // ── Full card ─────────────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3, boxShadow: `0 12px 32px ${meta.color}25` }}
      style={{
        background: meta.bg, borderRadius: 14, padding: '16px',
        display: 'flex', flexDirection: 'column', gap: 8,
        borderLeft: `4px solid ${meta.color}`,
        boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: '0.92rem', color: '#1F2937' }}>
            {reflex}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#6B7280', marginTop: 1 }}>{meta.desc}</div>
        </div>
        <TrendIcon size={16} color={trendColor} />
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
        {isMeasured ? (
          <>
            <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: '2rem', color: meta.color }}>
              {numScore}
            </span>
            <span style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>/100</span>
          </>
        ) : (
          <span style={{ fontSize: '0.85rem', color: '#9CA3AF', fontWeight: 600, fontStyle: 'italic' }}>
            No observation this session
          </span>
        )}
      </div>

      <div style={{ height: 6, background: 'rgba(0,0,0,0.08)', borderRadius: 3, overflow: 'hidden' }}>
        {isMeasured && (
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${numScore}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            style={{ height: '100%', borderRadius: 3, background: meta.color }}
          />
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ padding: '2px 9px', borderRadius: 99, background: lblStyle.bg, color: lblStyle.text, fontSize: '0.7rem', fontWeight: 700 }}>
          {labelText}
        </span>
        {isMeasured && (
          <span style={{ padding: '2px 8px', borderRadius: 99, background: confColor + '22', color: confColor, fontSize: '0.7rem', fontWeight: 600 }}>
            {confidence} confidence
          </span>
        )}
      </div>
    </motion.div>
  );
}
