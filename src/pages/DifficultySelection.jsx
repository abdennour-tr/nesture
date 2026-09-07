/**
 * DifficultySelection.jsx — LetterQuest's "NesturePlay Options" screen.
 *
 * Restyled onto the shared game shell (GameShell.css) so it belongs to the same
 * product as every other level screen: same dark palette, same top bar, same
 * panels, same input-mode pills, same Start button.
 *
 * NOTHING WAS REMOVED. LetterQuest's setup is genuinely richer than
 * "Easy / Medium / Hard" and all of it is still here:
 *
 *   • 5 content difficulties (incl. Self Expression, tagged BETA)
 *   • 3 keyboard sizes, with the visual key-size preview
 *   • keyboard/difficulty COMPATIBILITY — incompatible sizes stay disabled and
 *     labelled, and changing difficulty still auto-selects its default keyboard
 *   • camera / touch input mode
 *   • the Atlas recommendation badge and its pre-filled selection
 *   • the learner stats strip (best accuracy, sessions, average duration)
 *   • the Self Expression explainer banner
 *   • the live "Your config" summary
 *   • the Start button relabelling to "Open Canvas" in Self Expression
 *   • the contextual tip, Back and Sign out
 *
 * It also obeys the same no-scroll rule as every other level screen, at any
 * window size. Three pickers plus a stats strip do not fit a laptop viewport at
 * fixed sizes, so every vertical measurement is a `vh`-based clamp and the page
 * gets denser on a short window instead of growing past it. The stats chips sit
 * in the TOP BAR — they are context, not a choice — and the option descriptions
 * clamp to two lines, then disappear, before anything else is sacrificed. The
 * Start button never shrinks out of reach.
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Star, Trophy, Clock, LogOut, ArrowLeft, AlertTriangle, Info,
  Video, Hand,
} from 'lucide-react';
import { useAuthStore } from '../store';
import api from '../services/api';
import toast from 'react-hot-toast';
import '../styles/GameShell.css';

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
  { key: 'big',      label: 'Beginner',     desc: '8 visible letters — large touches',   visibleKeys: 8,  keyW: 32, keyH: 22 },
  { key: 'medium',   label: 'Intermediate', desc: '12 visible letters — intermediate',   visibleKeys: 12, keyW: 24, keyH: 18 },
  { key: 'standard', label: 'Advanced',     desc: '26 letters — full QWERTY keyboard',   visibleKeys: 26, keyW: 16, keyH: 12 },
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
   webcam at all, so it works on a machine that has none.

   The wording matches every other game (see INPUT_MODES in gameShell.js): the
   client read "touch action" as "pinch the screen", so the labels say which
   device is meant. */
const INPUT_MODES = [
  { key: 'camera', label: 'Camera (hand)',  desc: 'Point your finger and hold the position', icon: Video },
  { key: 'touch',  label: 'Touch / Mouse',  desc: 'Tap the keys directly, no camera',        icon: Hand  },
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
                  narrative: calib.clinical_narrative || 'Optimised for your finger trajectory and motor pattern history.',
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
    const lvl = LEVELS.find((l) => l.key === key);
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
    const lvl = LEVELS.find((l) => l.key === difficulty);
    if (lvl && !lvl.compatibleSizes.includes(key)) {
      toast.error(`${lvl.label} mode requires Standard keys.`);
      return;
    }
    setKeyboardSize(key);
  };

  const currentLevel = LEVELS.find((l) => l.key === difficulty);
  const currentKb = KEYBOARD_SIZES.find((k) => k.key === keyboardSize);
  const currentMode = INPUT_MODES.find((m) => m.key === inputMode);
  const isSelfExpression = difficulty === 'self_expression';

  // Compute dynamic stats from current learner's sessions
  const sessionCount = learnerSessions.length;
  const bestAccuracy = sessionCount > 0
    ? Math.round(Math.max(...learnerSessions.map((s) => parseFloat(s.accuracy_score || 0))) * 100)
    : 0;
  const avgDurationMinutes = sessionCount > 0
    ? Math.round(learnerSessions.reduce((a, s) => a + (parseFloat(s.duration_seconds) || 0), 0) / sessionCount / 60)
    : 0;

  /* Context, not a choice — so these live in the top bar and leave the page
     body for the three things the learner actually picks. */
  const statChips = [
    { icon: <Trophy size={16} />, value: statsLoading ? '—' : `${bestAccuracy}%`, label: 'Best accuracy' },
    { icon: <Star size={16} />, value: statsLoading ? '—' : `${sessionCount}`, label: 'Sessions done' },
    { icon: <Clock size={16} />, value: statsLoading ? '—' : `${avgDurationMinutes}m`, label: 'Avg duration' },
  ];

  return (
    <div className="gs-page gs-page--options">
      {/* ── Top bar — the same one every game and level screen shows ────── */}
      <div className="gs-topbar">
        <div className="gs-topbar-left">
          <button className="gs-back" onClick={() => navigate('/play')}>
            <ArrowLeft size={18} /> Games
          </button>
          <span className="gs-game-title">
            <span className="gs-title-icon">🗺️</span>
            LetterQuest
          </span>
        </div>

        <div className="gs-actions">
          <div className="gs-stats-inline">
            {statChips.map((s) => (
              <div key={s.label} className="gs-stat-chip" title={s.label}>
                {s.icon}
                <div>
                  <div className="gs-stat-val">{s.value}</div>
                  <div className="gs-stat-lbl">{s.label}</div>
                </div>
              </div>
            ))}
          </div>
          <button className="gs-back" onClick={handleLogout} title="Sign out">
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </div>

      <motion.div
        className="gs-content"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <div className="gs-head">
          <h1>NesturePlay Options</h1>
          <p>Choose your difficulty, keyboard size and how you want to play.</p>
        </div>

        {/* Atlas recommendation badge (shown when Atlas profile sets defaults) */}
        {atlasRecommendation && (
          <motion.div
            className="gs-note"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Info size={16} />
            <span>
              Atlas suggests <strong>{LEVELS.find((l) => l.key === atlasRecommendation.difficulty)?.label}</strong>
              {' + '}
              <strong>{KEYBOARD_SIZES.find((k) => k.key === atlasRecommendation.keyboardSize)?.label}</strong>
            </span>
          </motion.div>
        )}

        {/* ── Difficulty picker (5 modes) ── */}
        <div className="gs-section">
          <div className="gs-section-title">Content Difficulty</div>
          <div className="gs-section-hint">Controls word complexity and content type</div>
          <div className="gs-opt-grid" style={{ '--cols': 5 }}>
            {LEVELS.map((lvl) => (
              <motion.button
                key={lvl.key}
                className={`gs-opt ${difficulty === lvl.key ? 'active' : ''}`}
                style={{ '--opt': lvl.color }}
                onClick={() => handleDifficultyChange(lvl.key)}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.97 }}
              >
                <span className="gs-opt-emoji">{lvl.emoji}</span>
                <span className="gs-opt-label">{lvl.label}</span>
                <span className="gs-opt-desc">{lvl.desc}</span>
                {lvl.isBeta && <span className="gs-opt-tag">BETA</span>}
              </motion.button>
            ))}
          </div>
        </div>

        {/* ── Input mode — the same pills as every other game ── */}
        <div className="gs-section">
          <div className="gs-section-title">How to play</div>
          <div className="gs-section-hint">{currentMode?.desc}</div>
          <div className="gs-mode-row" style={{ marginBottom: 0 }}>
            {INPUT_MODES.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.key}
                  className={`gs-mode-btn ${inputMode === m.key ? 'active' : ''}`}
                  onClick={() => setInputMode(m.key)}
                  aria-pressed={inputMode === m.key}
                >
                  <Icon size={18} /> {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Keyboard size picker (3 sizes) ── */}
        <div className="gs-section">
          <div className="gs-section-title">Keyboard Size</div>
          <div className="gs-section-hint">
            Controls the number of visible keys (letters always include the target word)
          </div>
          <div className="gs-opt-grid" style={{ '--cols': 3 }}>
            {KEYBOARD_SIZES.map((kb) => {
              const isActive = keyboardSize === kb.key;
              /* Some content modes only work with the full keyboard. Those
                 sizes stay visible but disabled and labelled, so the constraint
                 is explained rather than silently enforced. */
              const isIncompatible = currentLevel && !currentLevel.compatibleSizes.includes(kb.key);
              return (
                <motion.button
                  key={kb.key}
                  className={`gs-opt ${isActive ? 'active' : ''}`}
                  style={{ '--opt': 'var(--gs-accent)' }}
                  onClick={() => handleKeyboardChange(kb.key)}
                  whileHover={!isIncompatible ? { y: -2 } : {}}
                  whileTap={!isIncompatible ? { scale: 0.97 } : {}}
                  disabled={isIncompatible}
                >
                  {/* Visual key size preview */}
                  <span className="gs-key-preview">
                    {Array.from({ length: Math.min(kb.visibleKeys, 5) }).map((_, i) => (
                      <i key={i} style={{ width: kb.keyW, height: kb.keyH }} />
                    ))}
                    {kb.visibleKeys > 5 && (
                      <span className="gs-key-more">+{kb.visibleKeys - 5}</span>
                    )}
                  </span>
                  <span className="gs-opt-label">{kb.label}</span>
                  <span className="gs-opt-desc">{kb.desc}</span>
                  {isIncompatible && (
                    <span className="gs-opt-tag gs-opt-tag--warn">
                      <AlertTriangle size={9} /> Incompatible
                    </span>
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
              className="gs-note"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <span style={{ fontSize: '1.2rem' }}>💬</span>
              <div>
                <div className="gs-note-title">Self Expression Mode</div>
                Free canvas with no prompt or score. Type freely, use Speak
                (text-to-speech), Save your messages, and Clear to start over.
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Current config summary */}
        <div className="gs-summary">
          <span className="gs-summary-label">Your config</span>
          <span className="gs-summary-badge" style={{ '--bd': currentLevel?.color, '--fg': currentLevel?.color }}>
            {currentLevel?.emoji} {currentLevel?.label}
          </span>
          <span className="gs-summary-plus">+</span>
          <span className="gs-summary-badge">
            ⌨️ {currentKb?.label} ({currentKb?.visibleKeys} keys)
          </span>
          <span className="gs-summary-plus">+</span>
          <span className="gs-summary-badge" style={{ '--bd': 'var(--gs-accent)', '--fg': 'var(--gs-accent)' }}>
            {inputMode === 'camera' ? '✋' : '👆'} {currentMode?.label}
          </span>
        </div>

        {/* Start button */}
        <motion.button
          className="gs-start-btn"
          onClick={() => navigate(`/play/game?difficulty=${difficulty}&keyboardSize=${keyboardSize}&mode=${inputMode}`)}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          <Play size={20} fill="currentColor" />
          {isSelfExpression ? 'Open Canvas' : 'Start Session'}
        </motion.button>

        <p className="gs-foot">
          💡 Tip: {isSelfExpression
            ? 'Self Expression mode has no time limit. Express yourself freely!'
            : 'Find a comfortable position before you start. Take your time!'}
        </p>
      </motion.div>
    </div>
  );
}
