import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock } from 'lucide-react';

export default function SessionTimeoutModal({ isOpen, countdown, onStayConnected }) {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div style={styles.overlay}>
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          style={styles.card}
        >
          <div style={styles.iconContainer}>
            <Clock size={36} color="#E8841A" className="pulse-icon" />
          </div>
          
          <h3 style={styles.title}>Inactivity Warning</h3>
          
          <p style={styles.text}>
            You have been inactive for a while. To protect your privacy, you will be automatically logged out in:
          </p>

          <div style={styles.countdownContainer}>
            <span style={styles.countdownNumber}>{countdown}</span>
            <span style={styles.countdownUnit}>seconds</span>
          </div>

          {/* Progress bar representing remaining warning time */}
          <div style={styles.progressBg}>
            <motion.div
              initial={{ width: '100%' }}
              animate={{ width: `${(countdown / 60) * 100}%` }}
              transition={{ duration: 1, ease: 'linear' }}
              style={styles.progressFill}
            />
          </div>

          <div style={styles.actions}>
            <button
              onClick={onStayConnected}
              style={styles.button}
              onMouseEnter={(e) => {
                e.target.style.background = '#0D5E6B';
                e.target.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = '#1A8FA0';
                e.target.style.transform = 'translateY(0)';
              }}
            >
              Stay Connected
            </button>
          </div>

          <style>{`
            @keyframes pulse-clock {
              0%, 100% { transform: scale(1); }
              50% { transform: scale(1.1); }
            }
            .pulse-icon {
              animation: pulse-clock 2s infinite ease-in-out;
            }
          `}</style>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(10, 25, 47, 0.85)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99999,
  },
  card: {
    background: '#FFFFFF',
    borderRadius: 24,
    padding: '36px 32px',
    width: '90%',
    maxWidth: 420,
    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    border: '1px solid rgba(26, 143, 160, 0.1)',
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: '50%',
    background: 'rgba(232, 132, 26, 0.1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: 'Inter, sans-serif',
    fontSize: '1.4rem',
    fontWeight: 800,
    color: '#0A192F',
    margin: '0 0 12px 0',
  },
  text: {
    fontFamily: 'Inter, sans-serif',
    fontSize: '0.9rem',
    color: '#4A5568',
    lineHeight: 1.5,
    margin: '0 0 24px 0',
  },
  countdownContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: 16,
  },
  countdownNumber: {
    fontFamily: 'Inter, sans-serif',
    fontSize: '3.5rem',
    fontWeight: 900,
    color: '#E8841A',
    lineHeight: 1,
  },
  countdownUnit: {
    fontFamily: 'Inter, sans-serif',
    fontSize: '0.75rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    color: '#A0AEC0',
    letterSpacing: '0.1em',
    marginTop: 4,
  },
  progressBg: {
    width: '100%',
    height: 6,
    background: '#E2E8F0',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 28,
  },
  progressFill: {
    height: '100%',
    background: '#E8841A',
    borderRadius: 3,
  },
  actions: {
    width: '100%',
  },
  button: {
    width: '100%',
    padding: '14px',
    background: '#1A8FA0',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 12,
    fontFamily: 'Inter, sans-serif',
    fontWeight: 700,
    fontSize: '0.95rem',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: '0 4px 12px rgba(26, 143, 160, 0.3)',
  },
};
