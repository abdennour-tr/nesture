import React from 'react';
import { motion } from 'framer-motion';

export default function LoadingScreen({ message = 'Loading…' }) {
  return (
    <div style={styles.root}>
      <motion.div
        style={styles.card}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
      >
        {/* Animated logo */}
        <motion.div
          style={styles.logoIcon}
          animate={{ rotate: [0, 10, -10, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          N
        </motion.div>

        {/* Pulsing dots */}
        <div style={styles.dots}>
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              style={styles.dot}
              animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
            />
          ))}
        </div>

        <div style={styles.message}>{message}</div>
      </motion.div>
    </div>
  );
}

const styles = {
  root: {
    position: 'fixed', inset: 0,
    background: '#EEF6F8',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 9999,
  },
  card: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 20,
    padding: '40px 56px',
    background: '#fff',
    borderRadius: 24,
    boxShadow: '0 12px 48px rgba(13,94,107,0.14)',
  },
  logoIcon: {
    width: 56, height: 56,
    background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
    borderRadius: 16,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'Inter, sans-serif',
    fontWeight: 800, fontSize: '1.6rem', color: '#fff',
  },
  dots: { display: 'flex', gap: 8 },
  dot: {
    width: 8, height: 8, borderRadius: '50%',
    background: '#0D5E6B',
  },
  message: {
    fontSize: '0.875rem', color: '#9CA3AF',
    fontWeight: 500,
  },
};
