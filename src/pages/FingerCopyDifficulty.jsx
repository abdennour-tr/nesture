/**
 * FingerCopyDifficulty.jsx
 * Level selection screen for Magic Finger Copy game.
 *
 * Presents 3 difficulty levels with gesture previews.
 * Navigates to /play/finger-copy-game?level=<1|2|3> on selection.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Play } from 'lucide-react';
import { LEVELS, GESTURE_INFO } from '../hooks/useGestureDetection';
import '../styles/FingerCopyGame.css';

// ── Level card metadata ────────────────────────────────────────────────────
const LEVEL_CARDS = [
  {
    level: 1,
    emoji: '🌱',
    name: 'Beginner',
    desc: 'Basic finger positions — master one gesture at a time. Perfect for getting started!',
    color: '#10B981',
    gradient: 'linear-gradient(135deg, #10B981, #059669)',
    gestures: LEVELS[1].gestures,
  },
  {
    level: 2,
    emoji: '⚡',
    name: 'Intermediate',
    desc: 'Advanced gestures requiring fine motor control and finger precision.',
    color: '#E8841A',
    gradient: 'linear-gradient(135deg, #E8841A, #D97706)',
    gestures: ['ok_sign', 'pinch', 'thumbs_up', 'two_fingers', 'open_hand'],
  },
  {
    level: 3,
    emoji: '🔥',
    name: 'Expert',
    desc: 'Gesture sequences — perform 3 gestures in order! Test your speed and memory.',
    color: '#EF4444',
    gradient: 'linear-gradient(135deg, #EF4444, #DC2626)',
    sequences: LEVELS[3].sequences,
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
export default function FingerCopyDifficulty() {
  const navigate = useNavigate();

  const handleSelectLevel = (level) => {
    navigate(`/play/finger-copy-game?level=${level}`);
  };

  return (
    <div className="fc-difficulty-page">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="fc-difficulty-header">
        <button className="fc-difficulty-back" onClick={() => navigate('/play')}>
          <ArrowLeft size={18} />
          Back to Games
        </button>

        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="fc-difficulty-title">🖐️ Magic Finger Copy</h1>
          <p className="fc-difficulty-subtitle">
            Choose your challenge level and start imitating gestures!
          </p>
        </motion.div>
      </div>

      {/* ── Level Cards ────────────────────────────────────────────────── */}
      <motion.div
        className="fc-difficulty-grid"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {LEVEL_CARDS.map((card) => (
          <motion.div
            key={card.level}
            className="fc-level-card"
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

            <div className="fc-level-emoji">{card.emoji}</div>
            <div className="fc-level-name">
              Level {card.level} — {card.name}
            </div>
            <div className="fc-level-desc">{card.desc}</div>

            {/* ── Gesture preview tags ─────────────────────────────────── */}
            <div className="fc-level-gestures">
              {card.gestures
                ? card.gestures.map((g) => (
                    <span key={g} className="fc-level-gesture-tag">
                      {GESTURE_INFO[g]?.emoji} {GESTURE_INFO[g]?.name}
                    </span>
                  ))
                : /* Level 3: show sequences */
                  card.sequences?.map((seq, i) => (
                    <span key={i} className="fc-level-gesture-tag">
                      {seq.map((g) => GESTURE_INFO[g]?.emoji).join(' → ')}
                    </span>
                  ))}
            </div>

            {/* ── Play button ──────────────────────────────────────────── */}
            <button
              className="fc-level-play-btn"
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
