/**
 * FingerPianoDifficulty.jsx
 * Level selection screen for Finger Piano game.
 *
 * Presents 3 difficulty levels with finger previews.
 * Navigates to /play/finger-piano-game?level=<1|2|3> on selection.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Play } from 'lucide-react';
import '../styles/FingerPianoGame.css';

// ── Finger names for preview ───────────────────────────────────────────────
const FINGER_NAMES = {
  thumb:  { emoji: '👍', name: 'Thumb' },
  index:  { emoji: '👆', name: 'Index' },
  middle: { emoji: '🖕', name: 'Middle' },
  ring:   { emoji: '💍', name: 'Ring' },
  little: { emoji: '🤙', name: 'Little' },
};

// ── Level card metadata ────────────────────────────────────────────────────
const LEVEL_CARDS = [
  {
    level: 1,
    emoji: '🌱',
    name: 'Beginner',
    desc: 'Learn the basics! Use 3 fingers at a slow pace with large, colorful keys and lots of guidance.',
    color: '#10B981',
    gradient: 'linear-gradient(135deg, #10B981, #059669)',
    borderColor: 'rgba(16, 185, 129, 0.5)',
    fingers: ['thumb', 'index', 'middle'],
  },
  {
    level: 2,
    emoji: '⚡',
    name: 'Intermediate',
    desc: 'Use all 5 fingers at medium speed! Keys change faster and some visual cues are hidden.',
    color: '#E8841A',
    gradient: 'linear-gradient(135deg, #E8841A, #D97706)',
    borderColor: 'rgba(232, 132, 26, 0.5)',
    fingers: ['thumb', 'index', 'middle', 'ring', 'little'],
  },
  {
    level: 3,
    emoji: '🔥',
    name: 'Expert',
    desc: 'Fast sequences and rhythm challenges! Master all fingers with minimal cues and time bonuses.',
    color: '#EF4444',
    gradient: 'linear-gradient(135deg, #EF4444, #DC2626)',
    borderColor: 'rgba(239, 68, 68, 0.5)',
    fingers: ['thumb', 'index', 'middle', 'ring', 'little'],
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
export default function FingerPianoDifficulty() {
  const navigate = useNavigate();

  const handleSelectLevel = (level) => {
    navigate(`/play/finger-piano-game?level=${level}`);
  };

  return (
    <div className="fp-difficulty-page">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="fp-difficulty-header">
        <button className="fp-difficulty-back" onClick={() => navigate('/play')}>
          <ArrowLeft size={18} />
          Back to Games
        </button>

        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="fp-difficulty-title">🎹 Finger Piano</h1>
          <p className="fp-difficulty-subtitle">
            Choose your challenge level and play the piano with your fingers!
          </p>
        </motion.div>
      </div>

      {/* ── Level Cards ────────────────────────────────────────────────── */}
      <motion.div
        className="fp-difficulty-grid"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {LEVEL_CARDS.map((card) => (
          <motion.div
            key={card.level}
            className="fp-level-card"
            variants={cardVariants}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => handleSelectLevel(card.level)}
            style={{ '--level-color': card.color, '--level-glow': card.borderColor }}
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

            <div className="fp-level-emoji">{card.emoji}</div>
            <div className="fp-level-name">
              Level {card.level} — {card.name}
            </div>
            <div className="fp-level-desc">{card.desc}</div>

            {/* ── Finger preview tags ──────────────────────────────────── */}
            <div className="fp-level-fingers">
              {card.fingers.map((f) => (
                <span key={f} className="fp-level-finger-tag">
                  {FINGER_NAMES[f]?.emoji} {FINGER_NAMES[f]?.name}
                </span>
              ))}
            </div>

            {/* ── Play button ──────────────────────────────────────────── */}
            <button
              className="fp-level-play-btn"
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
