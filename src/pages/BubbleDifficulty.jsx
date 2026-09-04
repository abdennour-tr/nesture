/**
 * BubbleDifficulty.jsx
 * Level + control-mode selection for "Pop the Bubble".
 *
 * Navigates to /play/bubble-game?level=<easy|medium|hard>&mode=<camera|touch>
 * The mode can still be flipped mid-game from the in-game header, so this is a
 * starting preference rather than a lock.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Play, Hand, MousePointer2 } from 'lucide-react';
import '../styles/BubbleGame.css';

/* Preview circle sizes mirror the real bubble radii for each level, so the card
   shows the child (and the therapist) exactly how small the targets get. */
const LEVEL_CARDS = [
  {
    key: 'easy',
    emoji: '🌱',
    name: 'Easy',
    color: '#38A169',
    desc: 'Big, slow bubbles with plenty of time to aim. Perfect for building confidence.',
    specs: ['Big bubbles', 'Slow rise', '5 at a time'],
    sizes: [46, 38, 30],
  },
  {
    key: 'medium',
    emoji: '⚡',
    name: 'Medium',
    color: '#DD6B20',
    desc: 'Smaller bubbles rising faster, and more of them on screen at once.',
    specs: ['Medium bubbles', 'Faster rise', '7 at a time'],
    sizes: [34, 28, 22],
  },
  {
    key: 'hard',
    emoji: '🔥',
    name: 'Hard',
    color: '#E53E3E',
    desc: 'Small, quick bubbles that demand precise pointing. For steady hands!',
    specs: ['Small bubbles', 'Quick rise', '9 at a time'],
    sizes: [24, 19, 15],
  },
];

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
export default function BubbleDifficulty() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('camera');

  const start = (level) => navigate(`/play/bubble-game?level=${level}&mode=${mode}`);

  return (
    <div className="bg-diff-page">
      <button className="bg-diff-back" onClick={() => navigate('/play')}>
        <ArrowLeft size={18} />
        Back to Games
      </button>

      <motion.div
        className="bg-diff-head"
        initial={{ opacity: 0, y: -22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="bg-diff-title">🫧 Pop the Bubble</h1>
        <p className="bg-diff-sub">
          Point at the centre of each bubble with your index finger — the closer
          to the middle you aim, the more points you earn!
        </p>
      </motion.div>

      <motion.div
        className="bg-mode-row"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16 }}
      >
        <button
          className={`bg-mode-btn ${mode === 'camera' ? 'active' : ''}`}
          onClick={() => setMode('camera')}
          aria-pressed={mode === 'camera'}
        >
          <Hand size={19} /> Camera
        </button>
        <button
          className={`bg-mode-btn ${mode === 'touch' ? 'active' : ''}`}
          onClick={() => setMode('touch')}
          aria-pressed={mode === 'touch'}
        >
          <MousePointer2 size={19} /> Touch
        </button>
      </motion.div>

      <motion.div
        className="bg-diff-grid"
        variants={container}
        initial="hidden"
        animate="visible"
      >
        {LEVEL_CARDS.map((c) => (
          <motion.div
            key={c.key}
            className="bg-diff-card"
            style={{ '--lvl': c.color }}
            variants={card}
            whileHover={{ scale: 1.03, y: -6 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => start(c.key)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') start(c.key); }}
          >
            <span className="bg-diff-emoji">{c.emoji}</span>
            <h2 className="bg-diff-name">{c.name}</h2>
            <p className="bg-diff-desc">{c.desc}</p>

            <div className="bg-diff-preview">
              {c.sizes.map((s, i) => (
                <span key={i} style={{ width: s, height: s }} />
              ))}
            </div>

            <div className="bg-diff-specs">
              {c.specs.map((s) => (
                <span key={s} className="bg-diff-spec">{s}</span>
              ))}
            </div>

            <button
              className="bg-diff-play"
              onClick={(e) => { e.stopPropagation(); start(c.key); }}
            >
              <Play size={18} /> Start {c.name}
            </button>
          </motion.div>
        ))}
      </motion.div>

      <motion.p
        style={{
          textAlign: 'center', marginTop: 30, color: 'rgba(255,255,255,0.84)',
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
