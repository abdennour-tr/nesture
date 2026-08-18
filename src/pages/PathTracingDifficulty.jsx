import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Play, Star, Trophy, Clock, LogOut, ArrowLeft } from 'lucide-react';
import { useAuthStore } from '../store';
import api from '../services/api';
import toast from 'react-hot-toast';
import BetaBadge from '../components/shared/BetaBadge';
import BetaFooter from '../components/shared/BetaFooter';

// ── PathTracer — 3 difficulty levels ────────────────────────────────────────────
const LEVELS = [
  { key: 'easy', label: 'Facile', desc: 'Formes simples : cercle, carré, triangle, étoile, cœur', emoji: '🌟', color: '#10B981' },
  { key: 'medium', label: 'Moyen', desc: 'Lettres et chiffres : A, B, S, 2, 8, Z', emoji: '🔥', color: '#E8841A' },
  { key: 'hard', label: 'Difficile', desc: 'Patterns complexes : spirale, vagues, zigzag', emoji: '🚀', color: '#EF4444' },
];

// SVG path data for each difficulty preview
const PREVIEW_PATHS = {
  easy: 'M 25 5 A 20 20 0 1 1 24.99 5 Z',
  medium: 'M 5 45 L 25 5 L 45 45 M 13 30 L 37 30',
  hard: 'M 25 25 C 25 20 30 15 35 15 C 40 15 45 20 45 25 C 45 35 35 40 25 40 C 15 40 5 30 5 25 C 5 10 20 0 30 0',
};

// Unique animation key-frame name generator (inline via <style>)
const DASH_ANIM_CSS = `
@keyframes pt-draw-path {
  from { stroke-dashoffset: 200; }
  to   { stroke-dashoffset: 0; }
}
`;

export default function PathTracingDifficulty() {
  const { user, profile, logout } = useAuthStore();
  const userId = profile?.id || user?.id;
  const navigate = useNavigate();
  const [difficulty, setDifficulty] = useState('easy');

  // Learner stats (dynamic)
  const [learnerSessions, setLearnerSessions] = useState([]);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        let childId = null;
        if (profile?.role === 'parent') {
          const res = await api.get(`/learners/by-parent/${userId}`);
          if (res.data && res.data.length > 0) childId = res.data[0].id;
        } else if (profile?.role === 'learner') {
          const res = await api.get(`/learners/by-auth/${userId}`);
          if (res.data) childId = res.data.id;
        } else {
          const res = await api.get(`/learners/by-ot/${userId}`);
          if (res.data && res.data.length > 0) childId = res.data[0].id;
        }

        const learnerId = childId || profile?.learner_id || userId;

        if (learnerId) {
          try {
            const sessRes = await api.get(`/sessions/learner/${learnerId}?limit=500`);
            const allSessions = sessRes.data || [];
            // Filter for pathtracer sessions only
            const ptSessions = allSessions.filter(s => s.game_type === 'pathtracer');
            setLearnerSessions(ptSessions.length > 0 ? ptSessions : allSessions);
          } catch (e) {
            console.error('Could not fetch learner sessions', e);
          }
        }
      } catch (err) {
        console.error('Failed to resolve learner', err);
      } finally {
        setStatsLoading(false);
      }
    }
    fetchStats();
  }, [userId, profile]);

  const handleLogout = () => {
    logout();
    toast.success('Logged out');
    navigate('/login');
  };

  const currentLevel = LEVELS.find(l => l.key === difficulty);

  // Compute dynamic stats
  const sessionCount = learnerSessions.length;
  const bestAccuracy = sessionCount > 0
    ? Math.round(Math.max(...learnerSessions.map(s => parseFloat(s.accuracy_score || 0))) * 100)
    : 0;
  const avgDurationMinutes = sessionCount > 0
    ? Math.round(learnerSessions.reduce((a, s) => a + (parseFloat(s.duration_seconds) || 0), 0) / sessionCount / 60)
    : 0;

  return (
    <div style={styles.root} className="pt-root">
      <style>{DASH_ANIM_CSS}{`
        @media (max-width: 640px) {
          .pt-root { padding: 80px 12px 24px !important; align-items: flex-start !important; }
          #pt-card { padding: 24px 18px !important; margin: 0 !important; border-radius: 16px !important; width: 100% !important; }
          #pt-level-grid { grid-template-columns: 1fr !important; }
          #pt-stats-row { flex-direction: column !important; gap: 8px !important; }
          #pt-greeting { flex-direction: column; text-align: center; }
          #pt-avatar { margin: 0 auto; }
          .pt-logout-btn { top: 12px !important; right: 12px !important; padding: 6px 12px !important; font-size: 0.75rem !important; }
          .pt-back-btn { top: 12px !important; left: 12px !important; padding: 6px 12px !important; font-size: 0.75rem !important; }
        }
      `}</style>

      {/* Background decoration */}
      <div style={styles.bgCircle1} />
      <div style={styles.bgCircle2} />

      {/* Logout button top-right */}
      <button onClick={handleLogout} style={styles.logoutBtn} className="pt-logout-btn" title="Sign out">
        <LogOut size={16} />
        Sign Out
      </button>

      {/* Back button top-left */}
      <button onClick={() => navigate('/play')} style={styles.backBtn} className="pt-back-btn" title="Back to Games">
        <ArrowLeft size={16} />
        Back
      </button>

      <motion.div
        id="pt-card"
        style={styles.card}
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        {/* Header: avatar + title */}
        <div id="pt-greeting" style={styles.greeting}>
          <div id="pt-avatar" style={styles.avatar}>
            {profile?.first_name?.[0] || user?.user_metadata?.first_name?.[0] || 'L'}
          </div>
          <div>
            <div style={styles.hi}>PathTracer Options</div>
            <div style={styles.subtitle}>Choose your tracing difficulty</div>
          </div>
        </div>

        {/* Stats strip */}
        <div id="pt-stats-row" style={styles.statsRow}>
          {[
            { icon: <Trophy size={16} />, value: statsLoading ? '—' : `${bestAccuracy}%`, label: 'Best accuracy' },
            { icon: <Star size={16} />,   value: statsLoading ? '—' : `${sessionCount}`,  label: 'Sessions done' },
            { icon: <Clock size={16} />,  value: statsLoading ? '—' : `${avgDurationMinutes}m`, label: 'Avg duration' },
          ].map((s) => (
            <div key={s.label} style={styles.statChip}>
              <span style={styles.statIcon}>{s.icon}</span>
              <div>
                <div style={styles.statVal}>{s.value}</div>
                <div style={styles.statLbl}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Difficulty picker (3 levels) ── */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Path Difficulty</div>
          <div style={styles.sectionHint}>Controls the complexity of shapes you'll trace</div>
          <div id="pt-level-grid" style={styles.levelGrid}>
            {LEVELS.map((lvl) => {
              const isActive = difficulty === lvl.key;
              return (
                <motion.button
                  key={lvl.key}
                  onClick={() => setDifficulty(lvl.key)}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  style={{
                    ...styles.levelBtn,
                    ...(isActive
                      ? {
                          borderColor: lvl.color,
                          background: `${lvl.color}12`,
                          boxShadow: `0 0 0 3px ${lvl.color}18`,
                        }
                      : {}),
                  }}
                >
                  {/* Animated SVG path preview */}
                  <div style={styles.svgPreviewWrap}>
                    <svg
                      viewBox="0 0 50 50"
                      width="48"
                      height="48"
                      style={{ overflow: 'visible' }}
                    >
                      {/* Ghost outline */}
                      <path
                        d={PREVIEW_PATHS[lvl.key]}
                        fill="none"
                        stroke="#E5E7EB"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {/* Animated drawing */}
                      <path
                        d={PREVIEW_PATHS[lvl.key]}
                        fill="none"
                        stroke={isActive ? lvl.color : '#9CA3AF'}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeDasharray="200"
                        strokeDashoffset="200"
                        style={{
                          animation: 'pt-draw-path 2s ease forwards',
                          animationDelay: '0.3s',
                        }}
                        key={`${lvl.key}-${isActive}`} // reset animation on selection change
                      />
                    </svg>
                  </div>

                  <div style={styles.levelEmoji}>{lvl.emoji}</div>
                  <div style={{ ...styles.levelLabel, color: isActive ? lvl.color : '#1F2937' }}>
                    {lvl.label}
                  </div>
                  <div style={styles.levelDesc}>{lvl.desc}</div>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Current config summary */}
        <div style={styles.configSummary}>
          <span style={styles.configLabel}>Your config:</span>
          <span style={{ ...styles.configBadge, borderColor: currentLevel?.color, color: currentLevel?.color }}>
            {currentLevel?.emoji} {currentLevel?.label}
          </span>
        </div>

        {/* Start button */}
        <motion.button
          onClick={() => navigate(`/play/path-game?difficulty=${difficulty}`)}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          style={styles.startBtn}
        >
          <Play size={20} fill="white" />
          Start Session
        </motion.button>

        <p style={styles.tip}>
          💡 Tip: Tracez lentement en suivant le chemin. La précision compte plus que la vitesse !
        </p>
      </motion.div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────────
const styles = {
  root: {
    minHeight: '100vh',
    background: '#EEF6F8',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    position: 'relative',
    overflowY: 'auto',
  },
  logoutBtn: {
    position: 'absolute',
    top: 20,
    right: 24,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 16px',
    background: 'rgba(107,114,128,0.1)',
    border: '1px solid rgba(107,114,128,0.2)',
    borderRadius: 10,
    color: '#6B7280',
    fontSize: '0.82rem',
    fontWeight: 500,
    cursor: 'pointer',
    zIndex: 10,
    transition: 'all 0.15s',
  },
  backBtn: {
    position: 'absolute',
    top: 20,
    left: 24,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 16px',
    background: 'rgba(107,114,128,0.1)',
    border: '1px solid rgba(107,114,128,0.2)',
    borderRadius: 10,
    color: '#6B7280',
    fontSize: '0.82rem',
    fontWeight: 500,
    cursor: 'pointer',
    zIndex: 10,
    transition: 'all 0.15s',
  },
  bgCircle1: {
    position: 'absolute',
    width: 500,
    height: 500,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%)',
    top: -100,
    left: -100,
  },
  bgCircle2: {
    position: 'absolute',
    width: 400,
    height: 400,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(124,58,237,0.07) 0%, transparent 70%)',
    bottom: -80,
    right: -80,
  },
  card: {
    background: '#fff',
    borderRadius: 24,
    padding: '36px 32px',
    maxWidth: 640,
    width: '100%',
    boxShadow: '0 12px 48px rgba(139,92,246,0.14)',
    position: 'relative',
    zIndex: 1,
    maxHeight: '92vh',
    overflowY: 'auto',
  },
  greeting: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 20,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #7C3AED, #8B5CF6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'Inter, sans-serif',
    fontWeight: 800,
    fontSize: '1.4rem',
    color: '#fff',
    flexShrink: 0,
  },
  hi: {
    fontFamily: 'Inter, sans-serif',
    fontWeight: 800,
    fontSize: '1.4rem',
    color: '#7C3AED',
  },
  subtitle: {
    fontSize: '0.88rem',
    color: '#6B7280',
    marginTop: 2,
  },
  statsRow: {
    display: 'flex',
    gap: 10,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  statChip: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: '#F5F3FF',
    borderRadius: 12,
    padding: '10px 12px',
    minWidth: 120,
  },
  statIcon: { color: '#7C3AED' },
  statVal: {
    fontFamily: 'Inter, sans-serif',
    fontWeight: 700,
    fontSize: '0.95rem',
    color: '#7C3AED',
  },
  statLbl: { fontSize: '0.68rem', color: '#9CA3AF' },
  section: { marginBottom: 18 },
  sectionTitle: {
    fontFamily: 'Inter, sans-serif',
    fontWeight: 700,
    fontSize: '0.88rem',
    color: '#374151',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  sectionHint: {
    fontSize: '0.75rem',
    color: '#9CA3AF',
    marginBottom: 10,
  },
  levelGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 10,
  },
  levelBtn: {
    padding: '14px 10px',
    background: '#F9FAFB',
    border: '2px solid #E5E7EB',
    borderRadius: 12,
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'all 0.15s',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  svgPreviewWrap: {
    width: 56,
    height: 56,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#F3F4F6',
    borderRadius: 12,
    marginBottom: 4,
  },
  levelEmoji: { fontSize: '1.4rem', marginBottom: 2 },
  levelLabel: {
    fontFamily: 'Inter, sans-serif',
    fontWeight: 700,
    fontSize: '0.82rem',
  },
  levelDesc: {
    fontSize: '0.64rem',
    color: '#9CA3AF',
    marginTop: 2,
    lineHeight: 1.4,
  },
  configSummary: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
    flexWrap: 'wrap',
    padding: '10px 16px',
    background: '#F9FAFB',
    borderRadius: 12,
    border: '1px solid #E5E7EB',
  },
  configLabel: {
    fontSize: '0.78rem',
    color: '#9CA3AF',
    fontWeight: 600,
  },
  configBadge: {
    fontSize: '0.78rem',
    fontWeight: 700,
    color: '#7C3AED',
    background: '#F5F3FF',
    padding: '4px 10px',
    borderRadius: 8,
    border: '1px solid #DDD6FE',
  },
  startBtn: {
    width: '100%',
    padding: '16px',
    background: 'linear-gradient(135deg, #7C3AED, #8B5CF6)',
    border: 'none',
    borderRadius: 14,
    color: '#fff',
    fontFamily: 'Inter, sans-serif',
    fontWeight: 800,
    fontSize: '1.05rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    boxShadow: '0 6px 20px rgba(139,92,246,0.3)',
    marginBottom: 16,
  },
  tip: {
    textAlign: 'center',
    fontSize: '0.82rem',
    color: '#9CA3AF',
  },
};
