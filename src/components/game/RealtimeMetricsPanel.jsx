import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * RealtimeMetricsPanel
 * Displays live session metrics in the game view sidebar.
 *
 * Props:
 *   score       – { perfect, failed, total }
 *   metrics     – { avgResponseTime, accuracy, smoothness, fatigue }
 *   sessionTime – seconds elapsed
 *   lastGesture – { letter, result }
 */
export default function RealtimeMetricsPanel({ score, metrics, sessionTime, lastGesture }) {
  const accuracyPct  = score.total > 0 ? Math.round((score.perfect / score.total) * 100) : 0;
  const formatTime   = (s) => `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  const fatiguePct   = Math.round((metrics.fatigue || 0) * 100);
  const smoothPct    = Math.round((metrics.smoothness || 0) * 100);
  const rtSec        = ((metrics.avgResponseTime || 0) / 1000).toFixed(1);

  const fatigueColor = fatiguePct > 60 ? '#EF4444' : fatiguePct > 35 ? '#F59E0B' : '#10B981';
  const accColor     = accuracyPct > 75 ? '#10B981' : accuracyPct > 50 ? '#F59E0B' : '#EF4444';

  return (
    <div style={styles.panel}>
      <div style={styles.title}>Live Metrics</div>

      {/* Accuracy ring */}
      <div style={styles.ringWrap}>
        <svg viewBox="0 0 80 80" style={{ width: 80, height: 80 }}>
          <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
          <circle cx="40" cy="40" r="34" fill="none"
            stroke={accColor} strokeWidth="6"
            strokeDasharray={`${2 * Math.PI * 34}`}
            strokeDashoffset={`${2 * Math.PI * 34 * (1 - accuracyPct / 100)}`}
            strokeLinecap="round"
            transform="rotate(-90 40 40)"
            style={{ transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s ease' }}
          />
          <text x="40" y="44" textAnchor="middle"
            style={{ fontFamily:'Inter,sans-serif', fontWeight:800, fontSize:'1.1rem', fill: accColor }}>
            {accuracyPct}%
          </text>
        </svg>
        <div style={styles.ringLabel}>Accuracy</div>
      </div>

      {/* Metrics grid */}
      <div style={styles.grid}>
        {[
          { label: 'Speed',     value: `${rtSec}s`, color: '#0D5E6B' },
          { label: 'Time',      value: formatTime(sessionTime), color: '#E8841A' },
          { label: 'Perfect',   value: score.perfect, color: '#10B981' },
          { label: 'Total',     value: score.total,   color: '#C8E8ED' },
        ].map((m) => (
          <div key={m.label} style={styles.metricCell}>
            <div style={{ ...styles.metricVal, color: m.color }}>{m.value}</div>
            <div style={styles.metricLbl}>{m.label}</div>
          </div>
        ))}
      </div>

      {/* Smoothness bar */}
      <div style={styles.barSection}>
        <div style={styles.barRow}>
          <span style={styles.barLabel}>Smoothness</span>
          <span style={{ ...styles.barPct, color: '#8B5CF6' }}>{smoothPct}%</span>
        </div>
        <div style={styles.track}>
          <motion.div style={{ ...styles.fill, background: '#8B5CF6' }}
            animate={{ width: `${smoothPct}%` }} transition={{ duration: 0.4 }} />
        </div>
      </div>

      {/* Fatigue bar */}
      <div style={styles.barSection}>
        <div style={styles.barRow}>
          <span style={styles.barLabel}>Fatigue</span>
          <span style={{ ...styles.barPct, color: fatigueColor }}>{fatiguePct}%</span>
        </div>
        <div style={styles.track}>
          <motion.div style={{ ...styles.fill, background: fatigueColor }}
            animate={{ width: `${fatiguePct}%` }} transition={{ duration: 0.4 }} />
        </div>
      </div>

      {/* Last gesture feedback */}
      <AnimatePresence mode="wait">
        {lastGesture && (
          <motion.div key={`${lastGesture.letter}-${Date.now()}`}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{
              ...styles.feedback,
              background: lastGesture.result === 'Perfect' ? 'rgba(16,185,129,0.15)'
                : lastGesture.result === 'Failed' ? 'rgba(239,68,68,0.1)'
                : 'rgba(255,255,255,0.05)',
              border: `1px solid ${lastGesture.result === 'Perfect' ? 'rgba(16,185,129,0.35)'
                : lastGesture.result === 'Failed' ? 'rgba(239,68,68,0.25)'
                : 'rgba(255,255,255,0.08)'}`,
            }}
          >
            <span style={{ fontSize: '1.2rem' }}>
              {lastGesture.result === 'Perfect' ? '✅' : lastGesture.result === 'Failed' ? '◯' : '↷'}
            </span>
            <div>
              <div style={{ color: '#fff', fontWeight: 600, fontSize: '0.8rem' }}>
                {lastGesture.letter === ' ' ? 'SPACE' : lastGesture.letter === '⌫' ? 'DELETE' : lastGesture.letter}
              </div>
              <div style={{ color: '#9CA3AF', fontSize: '0.7rem' }}>{lastGesture.result}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const styles = {
  panel: {
    padding: '16px 14px',
    display: 'flex', flexDirection: 'column', gap: 12,
    background: '#0D1A1D',
  },
  title: {
    fontFamily: 'Inter, sans-serif',
    fontWeight: 700, fontSize: '0.72rem',
    color: '#C8E8ED',
    textTransform: 'uppercase', letterSpacing: '0.1em',
  },
  ringWrap: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
  },
  ringLabel: { fontSize: '0.7rem', color: '#9CA3AF' },
  grid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
  },
  metricCell: {
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 8, padding: '8px 6px', textAlign: 'center',
  },
  metricVal: {
    fontFamily: 'Inter, sans-serif',
    fontWeight: 800, fontSize: '1rem',
  },
  metricLbl: { fontSize: '0.62rem', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em' },
  barSection: { display: 'flex', flexDirection: 'column', gap: 4 },
  barRow: { display: 'flex', justifyContent: 'space-between' },
  barLabel: { fontSize: '0.7rem', color: '#9CA3AF' },
  barPct: { fontSize: '0.7rem', fontWeight: 600 },
  track: {
    height: 5, background: 'rgba(255,255,255,0.08)',
    borderRadius: 3, overflow: 'hidden',
  },
  fill: {
    height: '100%', borderRadius: 3,
  },
  feedback: {
    borderRadius: 10, padding: '10px 12px',
    display: 'flex', alignItems: 'center', gap: 8,
    marginTop: 4,
  },
};
