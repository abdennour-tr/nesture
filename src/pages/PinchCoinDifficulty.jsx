/**
 * PinchCoinDifficulty.jsx
 * Mode selection (Camera / Touch) + difficulty selection for "Pinch the Coin".
 * Premium, warm, child-friendly design with smooth framer-motion animations.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Video, Hand, Sparkles, Camera, Fingerprint } from 'lucide-react';

const LEVELS = [
  {
    id: 1,
    name: 'Easy',
    desc: 'Very large coin · Gentle movement · Slow-paced',
    icon: '🌟',
    color: '#10B981',
    bg: 'linear-gradient(135deg, #D1FAE5, #A7F3D0)',
    border: '#6EE7B7',
    detail: '5 coins to collect'
  },
  {
    id: 2,
    name: 'Medium',
    desc: 'Smaller coin · Medium distance · More coins',
    icon: '⭐',
    color: '#F59E0B',
    bg: 'linear-gradient(135deg, #FEF3C7, #FDE68A)',
    border: '#FCD34D',
    detail: '10 coins to collect'
  },
  {
    id: 3,
    name: 'Hard',
    desc: 'Small coin · Precision needed · Faster timer',
    icon: '🔥',
    color: '#EF4444',
    bg: 'linear-gradient(135deg, #FEE2E2, #FECACA)',
    border: '#FCA5A5',
    detail: '15 coins to collect'
  }
];

export default function PinchCoinDifficulty() {
  const navigate = useNavigate();
  const [mode, setMode] = useState(null); // 'camera' or 'touch'
  const [hoveredMode, setHoveredMode] = useState(null);

  const handleLevelSelect = (levelId) => {
    navigate(`/play/pinch-coin-game?level=${levelId}&mode=${mode}`);
  };

  return (
    <div style={styles.root}>
      {/* Background decorations */}
      <div style={styles.bgDecor1} />
      <div style={styles.bgDecor2} />
      <div style={styles.bgDecor3} />

      {/* Header */}
      <div style={styles.header}>
        <motion.button
          whileHover={{ scale: 1.03, y: -1 }}
          whileTap={{ scale: 0.97 }}
          style={styles.backBtn}
          onClick={() => navigate('/play')}
        >
          <ArrowLeft size={20} /> Back to Games
        </motion.button>
        <div style={styles.titleBadge}>
          <Sparkles size={16} />
          <span>Pinch the Coin</span>
        </div>
      </div>

      <div style={styles.content}>
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 22 }}
          style={styles.card}
        >
          {/* Card header illustration */}
          <div style={styles.cardTop}>
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              style={styles.emojiHeader}
            >
              🪙
            </motion.div>
            <motion.div
              animate={{ rotate: [-3, 3, -3] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              style={styles.piggySmall}
            >
              🐷
            </motion.div>
          </div>

          <h1 style={styles.title}>Pinch the Coin!</h1>
          <p style={styles.subtitle}>
            Practice your pinch grip — pick up the golden coin and feed the piggy bank!
          </p>

          <AnimatePresence mode="wait">
            {!mode ? (
              /* ─── Step 1: Mode Selection ─── */
              <motion.div
                key="mode-selection"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                style={styles.stepContainer}
              >
                <div style={styles.stepHeader}>
                  <div style={styles.stepBadge}>Step 1</div>
                  <h2 style={styles.stepTitle}>Choose How to Play</h2>
                </div>

                <div style={styles.modeGrid}>
                  {/* Camera Mode */}
                  <motion.button
                    whileHover={{ y: -6, boxShadow: '0 16px 32px rgba(79, 70, 229, 0.2)' }}
                    whileTap={{ scale: 0.97 }}
                    onMouseEnter={() => setHoveredMode('camera')}
                    onMouseLeave={() => setHoveredMode(null)}
                    style={{
                      ...styles.modeBtn,
                      borderColor: hoveredMode === 'camera' ? '#818CF8' : '#E0E7FF',
                      background: hoveredMode === 'camera'
                        ? 'linear-gradient(135deg, #EEF2FF, #E0E7FF)'
                        : 'white'
                    }}
                    onClick={() => setMode('camera')}
                  >
                    <div style={{ ...styles.modeIconBox, background: 'linear-gradient(135deg, #C7D2FE, #A5B4FC)', color: '#4338CA' }}>
                      <Camera size={30} />
                    </div>
                    <div style={styles.modeTitle}>✋ Air Hand Tracking</div>
                    <div style={styles.modeDesc}>
                      Use your camera with MediaPipe to detect thumb + index finger pinch in the air.
                    </div>
                    <div style={styles.modeTech}>
                      <Video size={12} /> MediaPipe Hand Tracking
                    </div>
                  </motion.button>

                  {/* Touch Mode */}
                  <motion.button
                    whileHover={{ y: -6, boxShadow: '0 16px 32px rgba(219, 39, 119, 0.15)' }}
                    whileTap={{ scale: 0.97 }}
                    onMouseEnter={() => setHoveredMode('touch')}
                    onMouseLeave={() => setHoveredMode(null)}
                    style={{
                      ...styles.modeBtn,
                      borderColor: hoveredMode === 'touch' ? '#F9A8D4' : '#FCE7F3',
                      background: hoveredMode === 'touch'
                        ? 'linear-gradient(135deg, #FDF2F8, #FCE7F3)'
                        : 'white'
                    }}
                    onClick={() => setMode('touch')}
                  >
                    <div style={{ ...styles.modeIconBox, background: 'linear-gradient(135deg, #FBCFE8, #F9A8D4)', color: '#BE185D' }}>
                      <Fingerprint size={30} />
                    </div>
                    <div style={styles.modeTitle}>👆 Touch Mode</div>
                    <div style={styles.modeDesc}>
                      Touch and hold the coin on screen, then move it slightly to the right.
                    </div>
                    <div style={{ ...styles.modeTech, background: '#FDF2F8', color: '#DB2777' }}>
                      <Hand size={12} /> Touch & Drag
                    </div>
                  </motion.button>
                </div>

                <div style={styles.modeHint}>
                  💡 You can switch between Camera and Touch at any time during the game.
                </div>
              </motion.div>
            ) : (
              /* ─── Step 2: Level Selection ─── */
              <motion.div
                key="level-selection"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.3 }}
                style={styles.stepContainer}
              >
                <div style={styles.stepHeader}>
                  <div style={styles.stepBadge}>Step 2</div>
                  <h2 style={styles.stepTitle}>Choose Difficulty</h2>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    style={styles.changeModeBtn}
                    onClick={() => setMode(null)}
                  >
                    ← Change Mode
                  </motion.button>
                </div>

                <div style={styles.selectedModeBadge}>
                  {mode === 'camera' ? '✋ Air Hand Tracking' : '👆 Touch Mode'}
                </div>

                <div style={styles.levelList}>
                  {LEVELS.map((lvl, i) => (
                    <motion.button
                      key={lvl.id}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1, type: 'spring', stiffness: 260, damping: 20 }}
                      whileHover={{ scale: 1.02, y: -3, boxShadow: `0 12px 28px ${lvl.color}22` }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleLevelSelect(lvl.id)}
                      style={{ ...styles.levelBtn, borderColor: lvl.border, background: lvl.bg }}
                    >
                      <div style={{ ...styles.levelIcon, background: 'rgba(255,255,255,0.7)' }}>{lvl.icon}</div>
                      <div style={styles.levelInfo}>
                        <div style={{ ...styles.levelName, color: lvl.color }}>{lvl.name}</div>
                        <div style={styles.levelDesc}>{lvl.desc}</div>
                      </div>
                      <div style={{ ...styles.levelDetail, color: lvl.color }}>
                        {lvl.detail}
                      </div>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}

/* ══════════════ STYLES ══════════════ */
const styles = {
  root: {
    minHeight: '100vh',
    minHeight: '100dvh',
    background: 'linear-gradient(160deg, #FFF8F0 0%, #FFECD2 40%, #FCB69F 100%)',
    fontFamily: "'Inter', sans-serif",
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    overflow: 'hidden',
  },
  bgDecor1: {
    position: 'absolute', top: '-15%', right: '-10%',
    width: 400, height: 400, borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(251,191,36,0.12) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  bgDecor2: {
    position: 'absolute', bottom: '-20%', left: '-8%',
    width: 500, height: 500, borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(251,146,60,0.1) 0%, transparent 60%)',
    pointerEvents: 'none',
  },
  bgDecor3: {
    position: 'absolute', top: '40%', left: '50%',
    width: 300, height: 300, borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(255,237,213,0.2) 0%, transparent 60%)',
    pointerEvents: 'none', transform: 'translate(-50%, -50%)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '20px 28px',
    alignItems: 'center',
    position: 'relative',
    zIndex: 2,
  },
  backBtn: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'rgba(255,255,255,0.85)',
    backdropFilter: 'blur(10px)',
    border: '2px solid rgba(254,215,170,0.6)',
    padding: '10px 20px', borderRadius: 16,
    color: '#92400E', fontWeight: 700, fontSize: '0.9rem',
    cursor: 'pointer', transition: 'all 0.2s',
    boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
  },
  titleBadge: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'linear-gradient(135deg, #F59E0B, #D97706)',
    color: 'white', padding: '10px 20px', borderRadius: 24,
    fontWeight: 800, fontSize: '1rem',
    boxShadow: '0 4px 16px rgba(245, 158, 11, 0.35)',
    letterSpacing: '-0.01em',
  },
  content: {
    flex: 1, display: 'flex', alignItems: 'center',
    justifyContent: 'center', padding: '16px 24px 40px',
    position: 'relative', zIndex: 2,
  },
  card: {
    background: 'rgba(255, 255, 255, 0.88)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderRadius: 32, padding: '40px 36px',
    width: '100%', maxWidth: 720,
    boxShadow: '0 20px 60px rgba(180, 83, 9, 0.12)',
    border: '2px solid rgba(255,255,255,0.8)',
    textAlign: 'center',
  },
  cardTop: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 20, marginBottom: 16,
  },
  emojiHeader: {
    fontSize: '4.5rem',
    filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.12))',
    lineHeight: 1,
  },
  piggySmall: {
    fontSize: '3.5rem',
    filter: 'drop-shadow(0 6px 12px rgba(0,0,0,0.1))',
    lineHeight: 1,
  },
  title: {
    margin: '0 0 10px 0', color: '#78350F',
    fontSize: '2.2rem', fontWeight: 900,
    letterSpacing: '-0.02em',
  },
  subtitle: {
    margin: '0 0 32px 0', color: '#92400E',
    fontSize: '1.05rem', lineHeight: 1.5,
    maxWidth: 500, marginLeft: 'auto', marginRight: 'auto',
  },
  stepContainer: { textAlign: 'left' },
  stepHeader: {
    display: 'flex', alignItems: 'center', gap: 12,
    marginBottom: 20, flexWrap: 'wrap',
  },
  stepBadge: {
    background: 'linear-gradient(135deg, #F59E0B, #D97706)',
    color: 'white', padding: '4px 12px', borderRadius: 10,
    fontWeight: 800, fontSize: '0.75rem',
    textTransform: 'uppercase', letterSpacing: '0.05em',
  },
  stepTitle: {
    margin: 0, color: '#78350F', fontSize: '1.25rem',
    fontWeight: 800, flex: 1,
  },
  modeGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16,
  },
  modeBtn: {
    border: '2.5px solid', borderRadius: 22, padding: '24px 20px',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    textAlign: 'center', cursor: 'pointer',
    transition: 'all 0.25s ease',
    boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
  },
  modeIconBox: {
    width: 64, height: 64, borderRadius: 20,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
    boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
  },
  modeTitle: {
    fontWeight: 800, color: '#1E293B', fontSize: '1.15rem',
    marginBottom: 8,
  },
  modeDesc: {
    color: '#64748B', fontSize: '0.88rem', lineHeight: 1.5,
    marginBottom: 14,
  },
  modeTech: {
    display: 'flex', alignItems: 'center', gap: 6,
    background: '#EEF2FF', color: '#4F46E5',
    padding: '4px 12px', borderRadius: 8,
    fontSize: '0.72rem', fontWeight: 700,
  },
  modeHint: {
    marginTop: 16, textAlign: 'center',
    background: 'rgba(245, 158, 11, 0.08)',
    border: '1.5px solid rgba(245, 158, 11, 0.2)',
    color: '#92400E', fontWeight: 600, fontSize: '0.82rem',
    padding: '10px 16px', borderRadius: 12,
  },
  changeModeBtn: {
    background: 'rgba(245, 158, 11, 0.1)',
    border: '1.5px solid rgba(245, 158, 11, 0.3)',
    color: '#D97706', fontWeight: 700, fontSize: '0.8rem',
    cursor: 'pointer', padding: '6px 14px', borderRadius: 10,
    transition: 'all 0.2s',
  },
  selectedModeBadge: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: 'linear-gradient(135deg, #FEF3C7, #FDE68A)',
    padding: '8px 16px', borderRadius: 12,
    fontWeight: 700, fontSize: '0.9rem', color: '#92400E',
    marginBottom: 20,
    border: '1.5px solid #FCD34D',
  },
  levelList: {
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  levelBtn: {
    display: 'flex', alignItems: 'center', gap: 16,
    border: '2.5px solid', borderRadius: 20,
    padding: '18px 22px', cursor: 'pointer', textAlign: 'left',
    boxShadow: '0 4px 12px rgba(0,0,0,0.04)', width: '100%',
    transition: 'all 0.2s ease',
  },
  levelIcon: {
    fontSize: '2rem', width: 56, height: 56, borderRadius: 16,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
    boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
  },
  levelInfo: { flex: 1 },
  levelName: {
    fontWeight: 900, fontSize: '1.2rem', marginBottom: 3,
    letterSpacing: '-0.01em',
  },
  levelDesc: {
    color: '#64748B', fontSize: '0.85rem', lineHeight: 1.4,
  },
  levelDetail: {
    fontWeight: 700, fontSize: '0.75rem', whiteSpace: 'nowrap',
  },
};
