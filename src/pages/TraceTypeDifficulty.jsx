/**
 * TraceTypeDifficulty.jsx
 * Level selection screen for Trace → Find → Type game.
 *
 * Presents 3 difficulty levels with letter previews.
 * Navigates to /play/trace-type-game?level=<1|2|3> on selection.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Play } from 'lucide-react';
import '../styles/TraceTypeGame.css';

// ── Level card metadata ────────────────────────────────────────────────────
const LEVEL_CARDS = [
  {
    level: 1,
    emoji: '🌱',
    name: 'Beginner',
    desc: 'Start with basic letters! Larger tracing guides and a simplified keyboard to build confidence.',
    color: '#10B981',
    gradient: 'linear-gradient(135deg, #10B981, #059669)',
    letters: 'ABCDEFGHI'.split(''),
  },
  {
    level: 2,
    emoji: '⚡',
    name: 'Intermediate',
    desc: 'Take on more complex letters with standard tracing and a full QWERTY keyboard.',
    color: '#E8841A',
    gradient: 'linear-gradient(135deg, #E8841A, #D97706)',
    letters: 'JKLMNOPQR'.split(''),
  },
  {
    level: 3,
    emoji: '🔥',
    name: 'Expert',
    desc: 'Master the final letters with precision tracing, timed challenges, and bonus points!',
    color: '#EF4444',
    gradient: 'linear-gradient(135deg, #EF4444, #DC2626)',
    letters: 'STUVWXYZ'.split(''),
  },
];

// ── Animation variants ─────────────────────────────────────────────────────
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.12, delayChildren: 0.1 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 30, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring', stiffness: 200, damping: 20 },
  },
};

// ═══════════════════════════════════════════════════════════════════════════
export default function TraceTypeDifficulty() {
  const navigate = useNavigate();

  const handleSelectLevel = (level) => {
    navigate(`/play/trace-type-game?level=${level}`);
  };

  return (
    <div className="tt-difficulty-page">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="tt-difficulty-header">
        <button className="tt-difficulty-back" onClick={() => navigate('/play')}>
          <ArrowLeft size={18} />
          Back to Games
        </button>

        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="tt-difficulty-title">✏️ Trace → Find → Type</h1>
          <p className="tt-difficulty-subtitle">
            Learn letters in 3 fun steps — trace, find on the keyboard, then type!
          </p>
        </motion.div>
      </div>

      {/* ── Level Cards ────────────────────────────────────────────────── */}
      <motion.div
        className="tt-difficulty-grid"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {LEVEL_CARDS.map((card) => (
          <motion.div
            key={card.level}
            className="tt-level-card"
            variants={cardVariants}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => handleSelectLevel(card.level)}
            style={{ '--level-color': card.color }}
          >
            {/* Color bar at top */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 4,
                background: card.gradient,
                borderRadius: '24px 24px 0 0',
              }}
            />

            <div className="tt-level-emoji">{card.emoji}</div>
            <div className="tt-level-name">
              Level {card.level} — {card.name}
            </div>
            <div className="tt-level-desc">{card.desc}</div>

            {/* ── Letter preview tags ─────────────────────────────────── */}
            <div className="tt-level-letters">
              {card.letters.map((letter) => (
                <span key={letter} className="tt-level-letter-tag">
                  {letter}
                </span>
              ))}
            </div>

            {/* ── Play button ──────────────────────────────────────────── */}
            <button
              className="tt-level-play-btn"
              style={{ background: card.gradient }}
              onClick={(e) => {
                e.stopPropagation();
                handleSelectLevel(card.level);
              }}
            >
              <Play size={18} />
              Start Level {card.level}
            </button>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
