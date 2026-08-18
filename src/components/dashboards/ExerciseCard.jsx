import React, { useState } from 'react';
import { Play, Plus, Check } from 'lucide-react';

const REFLEX_COLORS = {
  'Moro':          '#EF4444',
  'ATNR':          '#F59E0B',
  'STNR':          '#8B5CF6',
  'TLR':           '#3B82F6',
  'Spinal Galant': '#10B981',
  'Palmar Grasp':  '#0D5E6B',
};

/**
 * ExerciseCard
 * Renders one OT exercise. Supports:
 *   - "Watch" video placeholder button
 *   - Optional "Prescribe" button (for OT view)
 *
 * Props:
 *   exercise      – { id, name, target_reflex, description, duration_minutes, difficulty_level }
 *   onPrescribe   – optional callback(exerciseId) — shows prescribe button if provided
 *   compact       – renders a smaller card
 */
export default function ExerciseCard({ exercise, onPrescribe, compact = false }) {
  const [prescribed, setPrescribed] = useState(false);
  const [showVideo,  setShowVideo]  = useState(false);

  const color = REFLEX_COLORS[exercise.target_reflex] || '#0D5E6B';

  const handlePrescribe = async () => {
    if (onPrescribe) {
      await onPrescribe(exercise.id);
      setPrescribed(true);
      setTimeout(() => setPrescribed(false), 3000);
    }
  };

  if (compact) {
    return (
      <div style={{ ...styles.compact, borderLeft: `3px solid ${color}` }}>
        <div style={styles.compactTop}>
          <span style={styles.compactName}>{exercise.name}</span>
          <span style={{ fontSize: '0.7rem', color: '#9CA3AF' }}>{exercise.duration_minutes} min</span>
        </div>
        <div style={styles.compactMeta}>
          <span style={{ ...styles.reflexBadge, background: color + '20', color }}>
            {exercise.target_reflex}
          </span>
          <span style={{ ...styles.diffBadge }}>
            {exercise.difficulty_level}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.card}>
      {/* Top bar */}
      <div style={styles.topBar}>
        <span style={{ ...styles.reflexBadge, background: color + '20', color }}>
          {exercise.target_reflex}
        </span>
        <span style={styles.duration}>{exercise.duration_minutes} min</span>
      </div>

      {/* Name */}
      <div style={styles.name}>{exercise.name}</div>

      {/* Description */}
      <p style={styles.desc}>{exercise.description}</p>

      {/* Video placeholder */}
      {showVideo ? (
        <div style={styles.videoPlaceholder}>
          <div style={styles.videoIcon}>▶</div>
          <div style={{ fontSize: '0.78rem', color: '#9CA3AF' }}>
            Video content coming soon · Contact Manisha or Shilpi
          </div>
          <button onClick={() => setShowVideo(false)} style={styles.closeVideoBtn}>✕ Close</button>
        </div>
      ) : null}

      {/* Actions */}
      <div style={styles.actions}>
        <button onClick={() => setShowVideo(!showVideo)} style={styles.watchBtn}>
          <Play size={13} fill="white" /> Watch Video
        </button>
        {onPrescribe && (
          <button
            onClick={handlePrescribe}
            disabled={prescribed}
            style={{ ...styles.prescribeBtn, background: prescribed ? '#10B981' : '#0D5E6B' }}
          >
            {prescribed ? <Check size={13} /> : <Plus size={13} />}
            {prescribed ? 'Prescribed!' : 'Prescribe'}
          </button>
        )}
      </div>

      {/* Difficulty chip */}
      <div style={{ marginTop: 8 }}>
        <span className={`badge badge-${exercise.difficulty_level === 'easy' ? 'success' : exercise.difficulty_level === 'medium' ? 'warning' : 'danger'}`}>
          {exercise.difficulty_level}
        </span>
      </div>
    </div>
  );
}

const styles = {
  card: {
    background: '#fff',
    borderRadius: 14,
    padding: '16px',
    border: '1px solid #E5E7EB',
    display: 'flex', flexDirection: 'column', gap: 8,
    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
    transition: 'box-shadow 0.15s',
  },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  reflexBadge: {
    padding: '3px 9px', borderRadius: 99,
    fontSize: '0.72rem', fontWeight: 600,
  },
  duration: { fontSize: '0.75rem', color: '#9CA3AF', fontWeight: 500 },
  name: {
    fontFamily: 'Inter, sans-serif',
    fontWeight: 700, fontSize: '0.95rem', color: '#1F2937',
  },
  desc: {
    fontSize: '0.8rem', color: '#6B7280', lineHeight: 1.55,
    flex: 1,
  },
  videoPlaceholder: {
    background: '#F9FAFB', borderRadius: 10,
    padding: '14px', textAlign: 'center',
    border: '1px dashed #D1D5DB',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
  },
  videoIcon: {
    width: 36, height: 36, borderRadius: '50%',
    background: '#0D5E6B', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '0.9rem',
  },
  closeVideoBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: '0.72rem', color: '#9CA3AF', marginTop: 4,
  },
  actions: { display: 'flex', gap: 8, marginTop: 4 },
  watchBtn: {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '7px 13px',
    background: '#0D5E6B', color: '#fff',
    border: 'none', borderRadius: 8,
    fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
    transition: 'all 0.15s',
  },
  prescribeBtn: {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '7px 13px',
    color: '#fff',
    border: 'none', borderRadius: 8,
    fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
    transition: 'all 0.15s',
  },
  // Compact
  compact: {
    background: '#F9FAFB', borderRadius: 8, padding: '10px 12px',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  compactTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  compactName: { fontWeight: 600, fontSize: '0.82rem', color: '#1F2937' },
  compactMeta: { display: 'flex', gap: 6 },
  diffBadge: {
    padding: '2px 7px', borderRadius: 99,
    background: '#F3F4F6', color: '#6B7280',
    fontSize: '0.68rem', fontWeight: 500,
  },
};
