/**
 * PosturePrepCard.jsx
 * "Getting ready…" — the touch-mode preparation card.
 *
 * The camera-mode games show HandGate ("Show one of your hands to start
 * playing") while they wait for a hand. Touch mode has nothing playable to
 * wait for — the round can start the instant the child is ready — but it
 * still opens the camera in the background to record posture (see
 * TouchModePose.jsx), and a camera turning on with nothing on screen saying
 * so is exactly the gap TouchModePose's own doc comment calls out. This card
 * is that on-screen tell for the moment right before a touch round starts:
 * same full-screen card language as HandGate, same dark overlay, but built
 * around the upper-body tracking illustration instead of the hand one, and
 * with copy that matches what is actually happening (posture tracking runs
 * automatically, nothing for the child to hold up to a camera).
 *
 * This component only renders the card — a game decides when `visible` is
 * true (typically a brief "preparing" phase right before 'playing'/'waiting'
 * begins) and what happens on `onContinue`.
 */
import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {boolean}  visible     show the card
 * @param {boolean}  isTracking  posture capture running — drives the badge
 * @param {function} [onContinue] "Start playing" — dismisses the card and
 *   begins the round. The child taps it themselves; the card does not
 *   close on its own.
 * @param {function} [onSkip]    "Play without posture tracking" — falls back
 *   to touch mode with no camera at all, for a device with no camera or a
 *   parent who wants that off for this round.
 * @param {function} [onExit]    "Back" — leaves the game.
 */
export default function PosturePrepCard({
  visible, isTracking = false, onContinue, onSkip, onExit,
}) {
  const reduced = useMemo(prefersReducedMotion, []);
  const linkBtn = {
    background: 'transparent',
    border: '1px solid rgba(255, 255, 255, 0.18)',
    borderRadius: 999,
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: '0.9rem',
    fontWeight: 600,
    padding: '10px 18px',
    minHeight: 44,
    cursor: 'pointer',
  };
  const primaryBtn = {
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    border: 'none',
    borderRadius: 999,
    color: '#fff',
    fontSize: '0.95rem',
    fontWeight: 700,
    padding: '12px 28px',
    minHeight: 46,
    cursor: 'pointer',
    boxShadow: '0 8px 20px rgba(99, 102, 241, 0.35)',
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="posture-prep"
          className="tt-hand-detect-overlay posture-prep-overlay"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            background: 'rgba(8, 10, 22, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'tween', duration: 0.2 }}
            style={{
              background: '#151726',
              border: '1px solid rgba(99, 102, 241, 0.2)',
              borderRadius: 24,
              padding: '40px 48px',
              maxWidth: 520,
              width: '90%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 24,
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
            }}
          >
            {/* Message */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#fff', marginBottom: 4 }}>
                <span aria-hidden="true" style={{ color: 'rgba(255,255,255,0.4)' }}>«</span>
                {' '}Getting ready{' '}
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#fff' }}>
                to play{' '}
                <span aria-hidden="true" style={{ color: 'rgba(255,255,255,0.4)' }}>»</span>
              </div>
              <p style={{
                margin: '10px 0 0 0', fontSize: '0.9rem', lineHeight: 1.5,
                color: 'rgba(255,255,255,0.6)',
              }}>
                We'll gently track your posture in the background while you play with touch.
                No pose to hold — just sit comfortably.
              </p>
            </div>

            {/* Upper-body illustration */}
            <div
              style={{
                position: 'relative',
                width: 200,
                height: 175,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <motion.div
                animate={reduced ? { opacity: 0.2 } : { opacity: [0.1, 0.3, 0.1] }}
                transition={reduced ? { duration: 0 } : { duration: 2, repeat: Infinity, ease: 'linear' }}
                style={{
                  position: 'absolute',
                  width: '100%',
                  height: '100%',
                  borderRadius: '50%',
                  background: '#6366f1',
                }}
              />
              <img
                src="/upper-body-wireframe.png"
                alt="A holographic tracking outline of a person's head, shoulders and chest"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  position: 'relative',
                  zIndex: 2,
                  borderRadius: 16,
                }}
              />
            </div>

            {/* Loading dots */}
            <div aria-hidden="true" style={{ display: 'flex', gap: 6, marginTop: -12 }}>
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  animate={reduced ? { opacity: 0.6 } : { opacity: [0.3, 1, 0.3] }}
                  transition={reduced ? { duration: 0 } : { duration: 1, repeat: Infinity, delay: i * 0.2 }}
                  style={{ width: 8, height: 8, borderRadius: '50%', background: '#8b8eff' }}
                />
              ))}
            </div>

            {/* Tracking badge */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                borderRadius: 20,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <div style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: isTracking ? '#10B981' : '#F59E0B',
              }}
              />
              <span style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 500 }}>
                {isTracking ? 'Posture tracking active' : 'Preparing camera…'}
              </span>
            </div>

            {onContinue && (
              <button type="button" className="posture-prep-continue" style={primaryBtn} onClick={onContinue}>
                Start playing
              </button>
            )}

            {(onSkip || onExit) && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                {onSkip && (
                  <button type="button" className="posture-prep-skip" style={linkBtn} onClick={onSkip}>
                    Play without posture tracking
                  </button>
                )}
                {onExit && (
                  <button type="button" className="posture-prep-exit" style={linkBtn} onClick={onExit}>
                    Back
                  </button>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
