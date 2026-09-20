/**
 * HandGate.jsx
 * "Show one of your hands to start playing" — the camera-mode start gate.
 *
 * Client feedback: "trace -> find -> type -> why is it shown here but not in
 * others". Only Trace → Find → Type waited for a hand before starting; every
 * other one-hand camera game ran its 3-2-1 and started the round (and the
 * clock) whether or not the camera could see the child. A child who was still
 * settling in lost the first seconds of every round, and those seconds were
 * scored.
 *
 * The card was extracted from TraceTypeGame so every one-hand camera game
 * shows the same screen. The game decides when to open it (a 'waiting' phase)
 * and closes it itself as soon as a hand is detected — see
 * `useHandGate` below for the shared rule.
 *
 * Used by: Trace → Find → Type, Pop the Bubble, Follow the Ladybug,
 * Pinch the Coin, Magic Finger Copy.
 * Not used by: Finger Piano (some levels need BOTH hands), Trace the Shape
 * (already waits for the finger on its green start dot), LetterQuest (has
 * its own calibration screen, which includes a hand check).
 */
import React, { useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/* Same check as CalibrationScreen: the pulsing background and dots stop for
   children who have asked the system to reduce motion. */
const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * The shared gate rule. While `phase === 'waiting'`:
 *   - a detected hand (≥ 9 landmarks: thumb + index are what every game reads)
 *     opens the gate → `onHand()`;
 *   - a camera that could not start (simulation mode) must not strand the
 *     child behind a card that can never close → `onHand()` too;
 *   - `bypass` (e.g. the child switched to touch while the card was up)
 *     opens it as well: touch play needs no hand in front of the camera.
 */
export function useHandGate({ phase, landmarks, isSimulationMode = false, bypass = false, onHand }) {
  useEffect(() => {
    if (phase !== 'waiting') return;
    if ((landmarks && landmarks.length >= 9) || isSimulationMode || bypass) onHand();
  }, [phase, landmarks, isSimulationMode, bypass, onHand]);
}

/** The phase a round starts in: camera rounds wait for a hand first. */
export const firstPhaseFor = (mode) => (mode === 'camera' ? 'waiting' : 'countdown');

/**
 * @param {boolean}  visible     show the card (the game's 'waiting' phase)
 * @param {boolean}  isTracking  camera/tracker running — drives the badge
 * @param {function} [onUseTouch] offered as "Play with touch instead" when the
 *   game has a touch mode. The card covers the whole screen, header included,
 *   so without these a child whose hand is not picked up had no way off it
 *   except the browser's Back button.
 * @param {function} [onExit]    "Back" — leaves the game.
 */
export default function HandGate({ visible, isTracking = false, onUseTouch, onExit }) {
  const reduced = useMemo(prefersReducedMotion, []);
  const linkBtn = {
    background: 'transparent',
    border: '1px solid rgba(255, 255, 255, 0.18)',
    borderRadius: 999,
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: '0.9rem',
    fontWeight: 600,
    padding: '10px 18px',
    minHeight: 44,            // touch-target size
    cursor: 'pointer',
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="hand-gate"
          className="tt-hand-detect-overlay hand-gate-overlay"
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
                {' '}Show one of your hands{' '}
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#fff' }}>
                to start playing{' '}
                <span aria-hidden="true" style={{ color: 'rgba(255,255,255,0.4)' }}>»</span>
              </div>
            </div>

            {/* Hand illustration */}
            <div
              style={{
                position: 'relative',
                width: 180,
                height: 220,
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
                src="/hand-wireframe.png"
                alt="An open hand held up to the camera"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  position: 'relative',
                  zIndex: 2,
                }}
              />
            </div>

            {/* Loading dots */}
            <div aria-hidden="true" style={{ display: 'flex', gap: 6, marginTop: 10 }}>
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
              }} />
              <span style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 500 }}>
                {isTracking ? 'MediaPipe™ Active' : 'Initializing Tracking...'}
              </span>
            </div>

            {(onUseTouch || onExit) && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                {onUseTouch && (
                  <button type="button" className="hand-gate-touch" style={linkBtn} onClick={onUseTouch}>
                    Play with touch instead
                  </button>
                )}
                {onExit && (
                  <button type="button" className="hand-gate-exit" style={linkBtn} onClick={onExit}>
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
