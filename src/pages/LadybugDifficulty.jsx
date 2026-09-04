/**
 * LadybugDifficulty.jsx
 * Level + control-mode selection for "Follow the Ladybug".
 *
 * Navigates to /play/ladybug-game?level=<easy|medium|hard>&mode=<camera|touch>
 * The mode can still be flipped mid-game from the in-game header, so this is a
 * starting preference rather than a lock.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Play, Hand, MousePointer2 } from 'lucide-react';
import '../styles/LadybugGame.css';

/* ── Level metadata (mirrors LEVELS in LadybugGame.jsx) ─────────────────── */
const LEVEL_CARDS = [
  {
    key: 'easy',
    emoji: '🌱',
    name: 'Easy',
    color: '#38A169',
    desc: 'A gentle, slow ladybug on a wide, forgiving path. Perfect for building confidence.',
    specs: ['Slow pace', 'Wide path', '1 curve'],
    preview: 'M8 27 Q 55 4 102 27 T 196 27',
  },
  {
    key: 'medium',
    emoji: '⚡',
    name: 'Medium',
    color: '#DD6B20',
    desc: 'A quicker ladybug with tighter tolerance and a more playful, wavier route.',
    specs: ['Steady pace', 'Narrower path', '1.5 curves'],
    preview: 'M8 27 Q 40 2 72 27 T 136 27 T 196 27',
  },
  {
    key: 'hard',
    emoji: '🔥',
    name: 'Hard',
    color: '#E53E3E',
    desc: 'A fast ladybug that changes speed on a narrow, twisting path. For steady hands!',
    specs: ['Fast + variable', 'Tight path', '2 curves'],
    preview: 'M8 27 Q 32 1 56 27 T 104 27 T 152 27 T 196 27',
  },
];

/* ── Motion variants ────────────────────────────────────────────────────── */
const container = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.12, delayChildren: 0.08 } },
};
const card = {
  hidden: { opacity: 0, y: 34, scale: 0.94 },
  visible: {
    opacity: 1, y: 0, scale: 1,
    transition: { type: 'spring', stiffness: 210, damping: 21 },
  },
};

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function LadybugDifficulty() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('camera');

  const start = (level) => navigate(`/play/ladybug-game?level=${level}&mode=${mode}`);

  return (
    <div className="lb-diff-page">
      <button className="lb-diff-back" onClick={() => navigate('/play')}>
        <ArrowLeft size={18} />
        Back to Games
      </button>

      <motion.div
        className="lb-diff-head"
        initial={{ opacity: 0, y: -22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="lb-diff-title">🐞 Follow the Ladybug</h1>
        <p className="lb-diff-sub">
          Trace the moving bug with your index finger — stay on the path and walk it
          all the way to the leaf!
        </p>
      </motion.div>

      {/* ── Control mode ─────────────────────────────────────────────── */}
      <motion.div
        className="lb-mode-row"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16 }}
      >
        <button
          className={`lb-mode-btn ${mode === 'camera' ? 'active' : ''}`}
          onClick={() => setMode('camera')}
          aria-pressed={mode === 'camera'}
        >
          <Hand size={19} /> Camera
        </button>
        <button
          className={`lb-mode-btn ${mode === 'touch' ? 'active' : ''}`}
          onClick={() => setMode('touch')}
          aria-pressed={mode === 'touch'}
        >
          <MousePointer2 size={19} /> Touch
        </button>
      </motion.div>

      {/* ── Level cards ──────────────────────────────────────────────── */}
      <motion.div
        className="lb-diff-grid"
        variants={container}
        initial="hidden"
        animate="visible"
      >
        {LEVEL_CARDS.map((c) => (
          <motion.div
            key={c.key}
            className="lb-diff-card"
            style={{ '--lvl': c.color }}
            variants={card}
            whileHover={{ scale: 1.03, y: -6 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => start(c.key)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') start(c.key); }}
          >
            <span className="lb-diff-emoji">{c.emoji}</span>
            <h2 className="lb-diff-name">{c.name}</h2>
            <p className="lb-diff-desc">{c.desc}</p>

            <svg className="lb-diff-preview" viewBox="0 0 204 54" preserveAspectRatio="none">
              <path d={c.preview} />
            </svg>

            <div className="lb-diff-specs">
              {c.specs.map((s) => (
                <span key={s} className="lb-diff-spec">{s}</span>
              ))}
            </div>

            <button
              className="lb-diff-play"
              onClick={(e) => { e.stopPropagation(); start(c.key); }}
            >
              <Play size={18} /> Start {c.name}
            </button>
          </motion.div>
        ))}
      </motion.div>

      <motion.p
        style={{
          textAlign: 'center', marginTop: 30, color: 'rgba(255,255,255,0.82)',
          fontSize: '0.9rem', fontWeight: 600,
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
      >
        💡 You can switch between Camera and Touch at any time during the game.
      </motion.p>
    </div>
  );
}
