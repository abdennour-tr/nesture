import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Star, Trophy, Clock, LogOut, ArrowLeft, AlertTriangle, Info, Video, Hand } from 'lucide-react';
import { useAuthStore } from '../store';
import api from '../services/api';
import toast from 'react-hot-toast';
import BetaBadge from '../components/shared/BetaBadge';
import BetaFooter from '../components/shared/BetaFooter';

// ── PRD v4.0 — 5 difficulty modes ──────────────────────────────────────────────
const LEVELS = [
  {
    key: 'easy',
    label: 'Easy',
    desc: 'Short words: 3–4 letters (CAT, DOG, SUN…)',
    emoji: '🌱',
    color: '#10B981',
    compatibleSizes: ['big', 'medium', 'standard'],
  },
  {
    key: 'medium',
    label: 'Medium',
    desc: 'Words: 4–6 letters (PLANT, CLOUD, WATER…)',
    emoji: '⚡',
    color: '#E8841A',
    compatibleSizes: ['big', 'medium', 'standard'],
  },
  {
    key: 'complex_words',
    label: 'Complex – Words',
    desc: 'Words: 6–8 letters (JOURNEY, SCIENCE…)',
    emoji: '🔥',
    color: '#EF4444',
    compatibleSizes: ['big', 'medium', 'standard'],
  },
  {
    key: 'complex_sentences',
    label: 'Complex – Sentences',
    desc: 'Short phrases (I WANT TO GO…). Standard keys only.',
    emoji: '📝',
    color: '#8B5CF6',
    compatibleSizes: ['standard'],
  },
  {
    key: 'self_expression',
    label: 'Self Expression',
    desc: 'Free canvas — no prompt, no score. Standard keys only.',
    emoji: '💬',
    color: '#0EA5E9',
    compatibleSizes: ['standard'],
    isBeta: true,
  },
];

// ── PRD v4.0 — 3 keyboard sizes ───────────────────────────────────────────────
const KEYBOARD_SIZES = [
  {
    key: 'big',
    label: 'Beginner',
    desc: '8 visible letters — large touches',
    visibleKeys: 8,
    keyW: 32,
    keyH: 22,
  },
  {
    key: 'medium',
    label: 'Intermediate',
    desc: '12 visible letters — intermediate',
    visibleKeys: 12,
    keyW: 24,
    keyH: 18,
  },
  {
    key: 'standard',
    label: 'Advanced',
    desc: '26 letters — full QWERTY keyboard',
    visibleKeys: 26,
    keyW: 16,
    keyH: 12,
  },
];

// Default keyboard for each difficulty
const DIFFICULTY_KB_DEFAULTS = {
  easy: 'big',
  medium: 'medium',
  complex_words: 'medium',
  complex_sentences: 'standard',
  self_expression: 'standard',
};

/* ── Input modes ───────────────────────────────────────────────────────────
   Camera is the therapeutic exercise; touch is the way the same exercise stays
   reachable when the camera is not. Touch is not a lesser mode — it opens no
   webcam at all, so it works on a machine that has none. */
const INPUT_MODES = [
  {
    key: 'camera',
    label: 'Hand in air',
    desc: 'Point your finger and hold the position',
    icon: Video,
    color: '#0D5E6B',
    tintBg: '#EEF6F8',
    ring: 'rgba(13,94,107,0.12)',
  },
  {
    key: 'touch',
    label: 'Touch',
    desc: 'Tap the keys directly, no camera',
    icon: Hand,
    color: '#7C3AED',
    tintBg: '#F5F1FE',
    ring: 'rgba(124,58,237,0.12)',
  },
];

export default function DifficultySelection() {
  const { user, profile, logout } = useAuthStore();
  const userId = profile?.id || user?.id;
  const navigate = useNavigate();
  const [difficulty, setDifficulty] = useState('easy');
  const [keyboardSize, setKeyboardSize] = useState('big');
  /* How the child will select letters. Camera by default — holding the finger
     in the air IS the exercise — but a session on a device with no webcam, in
     a room too dark to track, or with a child whose arm cannot be held up, is
     still a session worth having. */
  const [inputMode, setInputMode] = useState('camera');

  // Learner stats (dynamic)
  const [learnerSessions, setLearnerSessions] = useState([]);
  const [statsLoading, setStatsLoading] = useState(true);

  const [atlasRecommendation, setAtlasRecommendation] = useState(null);

  useEffect(() => {
    async function fetchAtlasAndStats() {
      try {
        let childId = null;
        if (profile?.role === 'parent') {
          const res = await api.get(`/learners/by-parent/${userId}`);
          if (res.data && res.data.length > 0) childId = res.data[0].id;
        } else if (profile?.role === 'learner') {
          const res = await api.get(`/learners/by-auth/${userId}`);
          if (res.data) childId = res.data.id;
        } else {
          // Practitioner demo? Check local storage or just get first.
          const res = await api.get(`/learners/by-ot/${userId}`);
          if (res.data && res.data.length > 0) childId = res.data[0].id;
        }

        if (childId) {
          // Fetch learner sessions for stats
          try {
            const sessRes = await api.get(`/sessions/learner/${childId}?limit=500`);
            setLearnerSessions(sessRes.data || []);
          } catch (e) {
            console.error('Could not fetch learner sessions', e);
          }

          // Fetch Atlas recommendation
          try {
            const atlas = await api.get(`/atlas-profiles/${childId}`);
            if (atlas?.data?.calibration_parameters) {
              const calib = atlas.data.calibration_parameters;
              
              // Map AI string outputs ("Big keys", "Easy", etc.) to internal keys
              let mappedDiff = 'medium';
              if (calib.recommended_difficulty?.includes('Easy')) mappedDiff = 'easy';
              else if (calib.recommended_difficulty?.includes('Complex')) mappedDiff = 'complex_words';
              
              let mappedKb = 'medium';
              if (calib.recommended_keyboard_size?.includes('Big')) mappedKb = 'big';
              else if (calib.recommended_keyboard_size?.includes('Standard')) mappedKb = 'standard';

              // Support both direct keys (if saved manually) or AI-generated keys
              const finalDiff = calib.difficulty || mappedDiff;
              const finalKb = calib.keyboardSize || mappedKb;

              if (calib.recommended_difficulty || calib.recommended_keyboard_size || calib.difficulty || calib.keyboardSize) {
                const rec = {
                  difficulty: finalDiff,
                  keyboardSize: finalKb,
                  narrative: calib.clinical_narrative || 'Optimised for your finger trajectory and motor pattern history.'
                };
                setAtlasRecommendation(rec);
                // Pre-fill selection
                setDifficulty(finalDiff);
                setKeyboardSize(finalKb);
              }
            }
          } catch (e) {
            console.warn('Could not fetch Atlas recommendations for children stats page', e);
          }
        }
      } catch (err) {
        console.error('Failed to resolve learner', err);
      } finally {
        setStatsLoading(false);
      }
    }
    fetchAtlasAndStats();
  }, [userId, profile]);

  const handleLogout = () => {
    logout();
    toast.success('Logged out');
    navigate('/login');
  };

  // When difficulty changes, auto-select the recommended keyboard
  const handleDifficultyChange = (key) => {
    setDifficulty(key);
    const lvl = LEVELS.find(l => l.key === key);
    const defaultKb = DIFFICULTY_KB_DEFAULTS[key];
    // If current keyboard is incompatible, force to default
    if (lvl && !lvl.compatibleSizes.includes(keyboardSize)) {
      setKeyboardSize(defaultKb);
      toast('Keyboard switched to Standard — required for this mode.', { icon: 'ℹ️', duration: 2500 });
    } else {
      setKeyboardSize(defaultKb);
    }
  };

  // When keyboard changes, check compatibility
  const handleKeyboardChange = (key) => {
    const lvl = LEVELS.find(l => l.key === difficulty);
    if (lvl && !lvl.compatibleSizes.includes(key)) {
      toast.error(`${lvl.label} mode requires Standard keys.`);
      return;
    }
    setKeyboardSize(key);
  };

  const currentLevel = LEVELS.find(l => l.key === difficulty);
  const currentKb = KEYBOARD_SIZES.find(k => k.key === keyboardSize);
  const currentMode = INPUT_MODES.find(m => m.key === inputMode);
  const isSelfExpression = difficulty === 'self_expression';

  // Compute dynamic stats from current learner's sessions
  const sessionCount = learnerSessions.length;
  const bestAccuracy = sessionCount > 0
    ? Math.round(Math.max(...learnerSessions.map(s => parseFloat(s.accuracy_score || 0))) * 100)
    : 0;
  const avgDurationMinutes = sessionCount > 0
    ? Math.round(learnerSessions.reduce((a, s) => a + (parseFloat(s.duration_seconds) || 0), 0) / sessionCount / 60)
    : 0;

  return (
    <div style={styles.root} className="ds-root">
      <style>{`
        @media (max-width: 1024px) {
          .ds-level-grid { grid-template-columns: repeat(3, 1fr) !important; }
        }
        @media (max-width: 640px) {
          .ds-root { padding: 80px 12px 24px !important; align-items: flex-start !important; }
          #ds-card { padding: 24px 18px !important; margin: 0 !important; border-radius: 16px !important; width: 100% !important; }
          #kb-grid { grid-template-columns: 1fr !important; }
          #stats-row { flex-direction: column !important; gap: 8px !important; }
          #greeting { flex-direction: column; text-align: center; }
          #avatar { margin: 0 auto; }
          .ds-logout-btn { top: 12px !important; right: 12px !important; padding: 6px 12px !important; font-size: 0.75rem !important; }
          .ds-back-btn { top: 12px !important; left: 12px !important; padding: 6px 12px !important; font-size: 0.75rem !important; }
          .ds-level-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 400px) {
          .ds-level-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      {/* Background decoration */}
      <div style={styles.bgCircle1} />
      <div style={styles.bgCircle2} />

      {/* Logout button top-right */}
      <button onClick={handleLogout} style={styles.logoutBtn} className="ds-logout-btn" title="Sign out">
        <LogOut size={16} />
        Sign Out
      </button>

      {/* Back button top-left */}
      <button onClick={() => navigate('/play')} style={styles.backBtn} className="ds-back-btn" title="Back to Games">
        <ArrowLeft size={16} />
        Back
      </button>

      <motion.div id="ds-card" style={styles.card}
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div id="greeting" style={styles.greeting}>
          <div id="avatar" style={styles.avatar}>{profile?.first_name?.[0] || user?.user_metadata?.first_name?.[0] || 'L'}</div>
          <div>
            <div style={styles.hi}>NesturePlay Options</div>
            <div style={styles.subtitle}>Choose your difficulty and keyboard size</div>
          </div>
        </div>

        {/* Atlas recommendation badge (shown when Atlas profile sets defaults) */}
        {atlasRecommendation && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            style={styles.atlasBadge}
          >
            <Info size={14} color="#0D5E6B" />
            <span>
              Atlas suggests <strong>{LEVELS.find(l => l.key === atlasRecommendation.difficulty)?.label}</strong> +{' '}
              <strong>{KEYBOARD_SIZES.find(k => k.key === atlasRecommendation.keyboardSize)?.label}</strong>
            </span>
          </motion.div>
        )}

        {/* Stats strip */}
        <div id="stats-row" style={styles.statsRow}>
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

        {/* ── Difficulty picker (5 modes) ── */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Content Difficulty</div>
          <div style={styles.sectionHint}>Controls word complexity and content type</div>
          <div style={{ ...styles.levelGrid5, gridTemplateColumns: 'repeat(5, 1fr)' }} className="ds-level-grid">
            {LEVELS.map((lvl) => {
              const isActive = difficulty === lvl.key;
              return (
                <motion.button
                  key={lvl.key}
                  onClick={() => handleDifficultyChange(lvl.key)}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  style={{
                    ...styles.levelBtn,
                    ...(isActive ? { borderColor: lvl.color, background: `${lvl.color}12`, boxShadow: `0 0 0 3px ${lvl.color}18` } : {}),
                  }}
                >
                  <div style={styles.levelEmoji}>{lvl.emoji}</div>
                  <div style={{ ...styles.levelLabel, color: isActive ? lvl.color : '#1F2937' }}>
                    {lvl.label}
                  </div>
                  <div style={styles.levelDesc}>{lvl.desc}</div>
                  {lvl.isBeta && (
                    <span style={styles.betaTag}>BETA</span>
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* ── Input mode picker ── */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Input Mode</div>
          <div style={styles.sectionHint}>How the child selects letters</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {INPUT_MODES.map((m) => {
              const isActive = inputMode === m.key;
              const Icon = m.icon;
              return (
                <motion.button
                  key={m.key}
                  onClick={() => setInputMode(m.key)}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  style={{
                    ...styles.kbBtn,
                    ...(isActive ? { background: m.tintBg, borderColor: m.color, boxShadow: `0 0 0 3px ${m.ring}` } : {}),
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  }}
                >
                  <Icon size={22} color={isActive ? m.color : '#9CA3AF'} />
                  <div style={{ ...styles.levelLabel, color: isActive ? m.color : '#374151' }}>{m.label}</div>
                  <div style={{ ...styles.levelDesc, marginTop: 0 }}>{m.desc}</div>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* ── Keyboard size picker (3 sizes) ── */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Keyboard Size</div>
          <div style={styles.sectionHint}>Controls the number of visible keys (letters always include the target word)</div>
          <div id="kb-grid" style={{ ...styles.kbGrid, gridTemplateColumns: 'repeat(3, 1fr)' }} className="ds-level-grid">
            {KEYBOARD_SIZES.map((kb) => {
              const isActive = keyboardSize === kb.key;
              const isIncompatible = currentLevel && !currentLevel.compatibleSizes.includes(kb.key);
              return (
                <motion.button
                  key={kb.key}
                  onClick={() => handleKeyboardChange(kb.key)}
                  whileHover={!isIncompatible ? { y: -2 } : {}}
                  whileTap={!isIncompatible ? { scale: 0.97 } : {}}
                  style={{
                    ...styles.kbBtn,
                    ...(isActive ? styles.kbBtnActive : {}),
                    ...(isIncompatible ? styles.kbBtnDisabled : {}),
                  }}
                  disabled={isIncompatible}
                >
                  {/* Visual key size preview */}
                  <div style={styles.kbPreview}>
                    {Array.from({ length: Math.min(kb.visibleKeys, 5) }).map((_, i) => (
                      <div key={i} style={{
                        width: kb.keyW,
                        height: kb.keyH,
                        borderRadius: 4,
                        background: isActive ? '#0D5E6B' : isIncompatible ? '#E5E7EB' : '#D1D5DB',
                        transition: 'all 0.2s',
                      }} />
                    ))}
                    {kb.visibleKeys > 5 && (
                      <span style={{ fontSize: '0.6rem', color: '#9CA3AF', fontWeight: 600 }}>+{kb.visibleKeys - 5}</span>
                    )}
                  </div>
                  <div style={{ ...styles.kbLabel, color: isActive ? '#0D5E6B' : isIncompatible ? '#D1D5DB' : '#374151' }}>
                    {kb.label}
                  </div>
                  <div style={{ ...styles.kbDesc, color: isIncompatible ? '#D1D5DB' : '#9CA3AF' }}>
                    {kb.desc}
                  </div>
                  {isIncompatible && (
                    <div style={styles.incompatibleTag}>
                      <AlertTriangle size={10} /> Incompatible
                    </div>
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Self Expression info banner */}
        <AnimatePresence>
          {isSelfExpression && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              style={styles.selfExprBanner}
            >
              <div style={{ fontSize: '1.2rem' }}>💬</div>
              <div>
                <div style={{ fontWeight: 700, color: '#0369A1', fontSize: '0.85rem', marginBottom: 2 }}>Self Expression Mode</div>
                <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.5 }}>
                  Free canvas with no prompt or score. Type freely, use Speak (text-to-speech), Save your messages, and Clear to start over.
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Current config summary */}
        <div style={styles.configSummary}>
          <span style={styles.configLabel}>Your config:</span>
          <span style={{ ...styles.configBadge, borderColor: currentLevel?.color, color: currentLevel?.color }}>
            {currentLevel?.emoji} {currentLevel?.label}
          </span>
          <span style={styles.configPlus}>+</span>
          <span style={styles.configBadge}>
            ⌨️ {currentKb?.label} ({currentKb?.visibleKeys} keys)
          </span>
          <span style={styles.configPlus}>+</span>
          <span style={{
            ...styles.configBadge,
            color: currentMode?.color,
            background: currentMode?.tintBg,
            borderColor: currentMode?.color,
          }}>
            {inputMode === 'camera' ? '✋' : '👆'} {currentMode?.label}
          </span>
        </div>

        {/* Start button */}
        <motion.button
          onClick={() => navigate(`/play/game?difficulty=${difficulty}&keyboardSize=${keyboardSize}&mode=${inputMode}`)}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          style={styles.startBtn}
        >
          <Play size={20} fill="white" />
          {isSelfExpression ? 'Open Canvas' : 'Start Session'}
        </motion.button>

        <p style={styles.tip}>
          💡 Tip: {isSelfExpression
            ? 'Self Expression mode has no time limit. Express yourself freely!'
            : 'Find a comfortable position before you start. Take your time!'
          }
        </p>
      </motion.div>

    </div>
  );
}

const styles = {
  root: {
    minHeight: '100vh',
    background: '#EEF6F8',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 24,
    position: 'relative',
    overflowY: 'auto',
  },
  logoutBtn: {
    position: 'absolute', top: 20, right: 24,
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 16px',
    background: 'rgba(107,114,128,0.1)',
    border: '1px solid rgba(107,114,128,0.2)',
    borderRadius: 10,
    color: '#6B7280',
    fontSize: '0.82rem', fontWeight: 500,
    cursor: 'pointer',
    zIndex: 10,
    transition: 'all 0.15s',
  },
  backBtn: {
    position: 'absolute', top: 20, left: 24,
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 16px',
    background: 'rgba(107,114,128,0.1)',
    border: '1px solid rgba(107,114,128,0.2)',
    borderRadius: 10,
    color: '#6B7280',
    fontSize: '0.82rem', fontWeight: 500,
    cursor: 'pointer',
    zIndex: 10,
    transition: 'all 0.15s',
  },
  bgCircle1: {
    position: 'absolute', width: 500, height: 500,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(13,94,107,0.08) 0%, transparent 70%)',
    top: -100, left: -100,
  },
  bgCircle2: {
    position: 'absolute', width: 400, height: 400,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(232,132,26,0.07) 0%, transparent 70%)',
    bottom: -80, right: -80,
  },
  card: {
    background: '#fff',
    borderRadius: 24,
    padding: '36px 32px',
    maxWidth: '100%', width: '100%',
    boxShadow: '0 12px 48px rgba(13,94,107,0.14)',
    position: 'relative', zIndex: 1,
    maxHeight: '92vh',
    overflowY: 'auto',
  },
  greeting: {
    display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20,
  },
  avatar: {
    width: 52, height: 52, borderRadius: '50%',
    background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'Inter, sans-serif',
    fontWeight: 800, fontSize: '1.4rem', color: '#fff',
    flexShrink: 0,
  },
  hi: {
    fontFamily: 'Inter, sans-serif',
    fontWeight: 800, fontSize: '1.4rem', color: '#0D5E6B',
  },
  subtitle: {
    fontSize: '0.88rem', color: '#6B7280', marginTop: 2,
  },
  atlasBadge: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 14px',
    background: 'linear-gradient(135deg, #F0FAFB, #E0F4F7)',
    border: '1.5px solid #B2DFE6',
    borderRadius: 12,
    fontSize: '0.82rem', color: '#0D5E6B',
    marginBottom: 16,
  },
  statsRow: {
    display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap',
  },
  statChip: {
    flex: 1, display: 'flex', alignItems: 'center', gap: 8,
    background: '#EEF6F8', borderRadius: 12, padding: '10px 12px',
    minWidth: 120,
  },
  statIcon: { color: '#0D5E6B' },
  statVal: {
    fontFamily: 'Inter, sans-serif',
    fontWeight: 700, fontSize: '0.95rem', color: '#0D5E6B',
  },
  statLbl: { fontSize: '0.68rem', color: '#9CA3AF' },
  section: { marginBottom: 18 },
  sectionTitle: {
    fontFamily: 'Inter, sans-serif',
    fontWeight: 700, fontSize: '0.88rem', color: '#374151',
    marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em',
  },
  sectionHint: {
    fontSize: '0.75rem', color: '#9CA3AF', marginBottom: 10,
  },
  // 5-column grid that wraps on small screens
  levelGrid5: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
    gap: 8,
  },
  levelBtn: {
    padding: '12px 8px',
    background: '#F9FAFB',
    border: '2px solid #E5E7EB',
    borderRadius: 12,
    cursor: 'pointer', textAlign: 'center',
    transition: 'all 0.15s',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
  },
  levelEmoji: { fontSize: '1.4rem', marginBottom: 2 },
  levelLabel: {
    fontFamily: 'Inter, sans-serif',
    fontWeight: 700, fontSize: '0.78rem',
  },
  levelDesc: { fontSize: '0.62rem', color: '#9CA3AF', marginTop: 2, lineHeight: 1.4 },
  betaTag: {
    position: 'absolute', top: 4, right: 4,
    fontSize: '0.5rem', fontWeight: 800,
    background: 'linear-gradient(135deg, #F59E0B, #D97706)',
    color: '#fff', padding: '1px 5px', borderRadius: 8,
    letterSpacing: '0.1em',
  },

  // Keyboard size grid
  kbGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 },
  kbBtn: {
    padding: '14px 10px',
    background: '#F9FAFB',
    border: '2px solid #E5E7EB',
    borderRadius: 12,
    cursor: 'pointer', textAlign: 'center',
    transition: 'all 0.15s',
    position: 'relative',
  },
  kbBtnActive: {
    background: '#EEF6F8',
    borderColor: '#0D5E6B',
    boxShadow: '0 0 0 3px rgba(13,94,107,0.12)',
  },
  kbBtnDisabled: {
    opacity: 0.45,
    cursor: 'not-allowed',
    background: '#FAFAFA',
  },
  kbPreview: {
    display: 'flex', gap: 3, justifyContent: 'center', alignItems: 'center', marginBottom: 8,
    flexWrap: 'wrap',
  },
  kbLabel: {
    fontFamily: 'Inter, sans-serif',
    fontWeight: 700, fontSize: '0.85rem',
  },
  kbDesc: { fontSize: '0.64rem', color: '#9CA3AF', marginTop: 3 },
  incompatibleTag: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
    fontSize: '0.58rem', fontWeight: 700, color: '#DC2626',
    background: '#FEF2F2', border: '1px solid #FECACA',
    borderRadius: 6, padding: '2px 6px',
    marginTop: 6,
  },

  selfExprBanner: {
    display: 'flex', alignItems: 'flex-start', gap: 10,
    padding: '14px 16px',
    background: 'linear-gradient(135deg, #F0F9FF, #E0F2FE)',
    border: '1.5px solid #7DD3FC',
    borderRadius: 14,
    marginBottom: 16,
    overflow: 'hidden',
  },

  configSummary: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginBottom: 16, flexWrap: 'wrap',
    padding: '10px 16px',
    background: '#F9FAFB',
    borderRadius: 12,
    border: '1px solid #E5E7EB',
  },
  configLabel: {
    fontSize: '0.78rem', color: '#9CA3AF', fontWeight: 600,
  },
  configBadge: {
    fontSize: '0.78rem', fontWeight: 700, color: '#0D5E6B',
    background: '#EEF6F8', padding: '4px 10px', borderRadius: 8,
    border: '1px solid #C8E8ED',
  },
  configPlus: {
    fontSize: '0.82rem', color: '#9CA3AF', fontWeight: 700,
  },
  startBtn: {
    width: '100%', padding: '16px',
    background: 'linear-gradient(135deg, #0D5E6B 0%, #1A8FA0 100%)',
    border: 'none', borderRadius: 14,
    color: '#fff',
    fontFamily: 'Inter, sans-serif',
    fontWeight: 800, fontSize: '1.05rem',
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    boxShadow: '0 6px 20px rgba(13,94,107,0.3)',
    marginBottom: 16,
  },
  tip: {
    textAlign: 'center',
    fontSize: '0.82rem', color: '#9CA3AF',
  },
};
