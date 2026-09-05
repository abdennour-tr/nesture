/**
 * CalibrationScreen.jsx — Letter Quest
 *
 * The screen the child meets BEFORE the game exists.
 *
 * What it replaces
 * ────────────────
 * Calibration used to run underneath a game that had already started: the
 * session was open, the timer was counting, a word was on screen and the dwell
 * loop was live — all while the cursor mapping was still provisional. Stray
 * selections from that window were scored as real attempts, and the only sign
 * anything was happening was a small overlay on a 250 px camera thumbnail.
 *
 * What this does instead
 * ──────────────────────
 *  1. Owns the whole screen. Nothing is scored, nothing is timed, no session
 *     exists yet. The game is created only once this screen hands over.
 *  2. Shows the child where their hand is, in raw camera space, before any
 *     mapping exists — so the dot follows the hand from the very first frame.
 *  3. Turns "move your hand around" into a visible target: a grid of tiles
 *     that light up as the hand sweeps through them. The child can see what is
 *     left to do, which is the difference between a task and a wait.
 *  4. Runs live preflight checks (camera, one hand, distance, light/confidence,
 *     frame rate) and refuses to start on a setup that will not work, naming
 *     the specific problem instead of letting the child fail at the game.
 *  5. Hands over on a 3-2-1 countdown, so the start of the game is an event.
 *
 * Everything here is measured. There is no fixed timer anywhere in this file
 * that can declare success on an empty camera.
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Hand, Gauge, Sun, Ruler, Check, X, RotateCcw, ArrowRight, ChevronLeft } from 'lucide-react';
import { soundManager } from '../utils/soundManager';

export const CAL_COLS = 4;
export const CAL_ROWS = 3;

/* The preflight thresholds. They are deliberately forgiving — this screen must
   not become a gate that keeps a child out of an exercise their therapist
   asked them to do — but they are real: below these, the dwell selection is
   not usable and letting the child through only produces a failed session. */
const MIN_FPS = 10;
const MIN_CONFIDENCE = 40;
/* Roughly 35 cm to 110 cm from the camera, derived from inter-eye distance. */
const MIN_DISTANCE_FACTOR = 0.55;
const MAX_DISTANCE_FACTOR = 1.9;

/* After this long with a tracked hand, the "use it as is" escape appears.
   A child who cannot sweep the full area still gets to play, with the mapping
   honestly limited to the reach that was actually observed. */
const MANUAL_ACCEPT_AFTER_MS = 15000;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ── One preflight row ──────────────────────────────────────────────────── */
function CheckRow({ icon: Icon, label, state, detail }) {
  const color = state === 'ok' ? '#10B981' : state === 'warn' ? '#F59E0B' : '#EF4444';
  return (
    <div style={S.checkRow}>
      <div style={{ ...S.checkIcon, background: `${color}1A`, border: `1px solid ${color}44`, color }}>
        <Icon size={15} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.checkLabel}>{label}</div>
        {detail && <div style={S.checkDetail}>{detail}</div>}
      </div>
      <div style={{ color, flexShrink: 0, display: 'flex' }}>
        {state === 'ok' ? <Check size={16} /> : <X size={16} />}
      </div>
    </div>
  );
}

export default function CalibrationScreen({
  /* The camera element MediaPipe is bound to stays mounted in GamePage for the
     whole session. If this screen owned it, React would unmount that <video>
     at hand-over and mount a new, empty one — the Camera helper would keep
     feeding MediaPipe a video element with no srcObject, and hand tracking
     would simply stop the instant the game started. The preview below shows
     the SAME MediaStream in a second element instead. */
  sourceVideoRef,
  cameraError,

  // Live tracking state
  isTracking,
  handCount = 0,
  /* The hand position arrives as a REF, read from this screen's own animation
     frame and written straight to the dot's transform. Passing it as a prop
     meant a re-render of this entire screen — twelve tiles, five check rows,
     the camera panel — on every camera frame, which is what made the dot feel
     heavy: the dot was fine, the page around it was rebuilding underneath. */
  rawCursorRef,
  coverageCells = [],
  coverageTarget = 0.75,
  calibrationProgress = 0,
  calibrationStatus = 'Calibrating...',
  trackingConfidence = 0,
  fps = 0,
  distanceFactor = 1,
  faceDetected = false,

  // Actions from the tracking hook
  recalibrate,
  finalizeCalibration,

  // Hand-over
  onReady,
  onExit,
  learnerName,
  difficultyLabel,
  savedCalibration,
  onUseSaved,
  /* The manual way out of this screen. Not an automatic fallback — the mode
     stays a deliberate choice — but a refused or missing camera must not be a
     dead end with no reachable control on it. */
  onSwitchToTouch,
}) {
  const [countdown, setCountdown] = useState(null);   // 3 | 2 | 1 | null
  const [handSeenAt, setHandSeenAt] = useState(null);
  const handedOver = useRef(false);
  const reduced = useMemo(prefersReducedMotion, []);

  /* ── The hand dot ───────────────────────────────────────────────────────
     One animation frame, one transform write, no React state and no layout:
     `translate3d` on a compositor layer rather than animated `left`/`top`
     percentages, which forced a layout pass on every move. */
  const fieldRef = useRef(null);
  const dotRef = useRef(null);
  useEffect(() => {
    let raf;
    let lastX = -1, lastY = -1;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dot = dotRef.current;
      const field = fieldRef.current;
      const pos = rawCursorRef?.current;
      if (!dot || !field || !pos) return;
      const w = field.clientWidth, h = field.clientHeight;
      const x = Math.max(0, Math.min(1, pos.x)) * w;
      const y = Math.max(0, Math.min(1, pos.y)) * h;
      /* Sub-pixel moves are not worth a style write. */
      if (Math.abs(x - lastX) < 0.4 && Math.abs(y - lastY) < 0.4) return;
      lastX = x; lastY = y;
      dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rawCursorRef]);

  /* Mirror the live MediaStream into this screen's own preview element. The
     stream object is shared, not duplicated — no second camera permission, no
     second decode pipeline, and nothing for the hand-over to break. */
  const previewRef = useRef(null);
  useEffect(() => {
    let raf;
    const attach = () => {
      const src = sourceVideoRef?.current?.srcObject;
      const el = previewRef.current;
      if (el && src && el.srcObject !== src) {
        el.srcObject = src;
        el.play?.().catch(() => { /* autoplay is muted+playsInline; ignore */ });
      }
      /* The stream appears a moment after mount, once getUserMedia resolves. */
      if (el && !el.srcObject) raf = requestAnimationFrame(attach);
    };
    attach();
    return () => cancelAnimationFrame(raf);
  }, [sourceVideoRef, cameraError]);

  const covered = coverageCells.filter(Boolean).length;
  const totalCells = CAL_COLS * CAL_ROWS;
  const coverageRatio = totalCells ? covered / totalCells : 0;

  /* ── Preflight ──────────────────────────────────────────────────────────
     Each check is derived from a live measurement, never from elapsed time. */
  const checks = useMemo(() => {
    const cameraOk = !cameraError;
    const handOk = isTracking && handCount >= 1;
    const oneHandOk = handCount <= 1;
    const distOk = !faceDetected
      ? true // no face reading yet — do not fail the child on a missing signal
      : distanceFactor >= MIN_DISTANCE_FACTOR && distanceFactor <= MAX_DISTANCE_FACTOR;
    const fpsOk = fps >= MIN_FPS;
    const confOk = trackingConfidence >= MIN_CONFIDENCE;

    return [
      {
        icon: Camera, label: 'Camera',
        state: cameraOk ? 'ok' : 'fail',
        detail: cameraOk ? 'Video feed active' : 'Access denied, or camera in use',
        blocking: !cameraOk,
      },
      {
        icon: Hand, label: 'Hand detected',
        state: handOk ? (oneHandOk ? 'ok' : 'warn') : 'fail',
        detail: !handOk
          ? 'Show your open hand to the camera'
          : oneHandOk ? 'One hand tracked' : 'Two hands seen — keep just one',
        blocking: !handOk,
      },
      {
        icon: Ruler, label: 'Distance',
        state: distOk ? 'ok' : 'warn',
        detail: !faceDetected
          ? 'No face detected — not measured'
          : distanceFactor < MIN_DISTANCE_FACTOR ? 'Move a little closer to the screen'
          : distanceFactor > MAX_DISTANCE_FACTOR ? 'Move back a little' : 'Good distance',
        blocking: false,
      },
      {
        icon: Sun, label: 'Light & tracking',
        state: confOk ? 'ok' : 'warn',
        detail: confOk ? `Reliability ${trackingConfidence}%` : `Reliability ${trackingConfidence}% — brighten the room`,
        blocking: false,
      },
      {
        icon: Gauge, label: 'Frame rate',
        state: fpsOk ? 'ok' : 'warn',
        detail: `${Math.round(fps)} frames/s${fpsOk ? '' : ' — close other tabs'}`,
        blocking: false,
      },
    ];
  }, [cameraError, isTracking, handCount, distanceFactor, faceDetected, fps, trackingConfidence]);

  const blocked = checks.some(c => c.blocking);
  const sweepDone = calibrationStatus === 'Calibrated' || coverageRatio >= coverageTarget;
  const readyToStart = !blocked && sweepDone;

  /* Remember when a hand first appeared, so the manual escape can be offered
     on hand time rather than on wall clock — a child staring at a camera that
     never saw them should not be offered a mapping built from nothing. */
  useEffect(() => {
    if (isTracking && handSeenAt === null) setHandSeenAt(Date.now());
    if (!isTracking && handSeenAt !== null && !sweepDone) {
      // keep the timestamp: brief drop-outs are normal
    }
  }, [isTracking, handSeenAt, sweepDone]);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (readyToStart || countdown !== null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [readyToStart, countdown]);

  const canManuallyAccept =
    !readyToStart && !blocked && handSeenAt !== null && now - handSeenAt > MANUAL_ACCEPT_AFTER_MS;

  /* ── Hand-over ──────────────────────────────────────────────────────────
     A 3-2-1 so the child knows the game is about to take over. The countdown
     is the only timer in this file and it starts strictly after the
     measurement has already succeeded. */
  const beginCountdown = useCallback(() => {
    if (countdown !== null || handedOver.current) return;
    setCountdown(3);
  }, [countdown]);

  useEffect(() => {
    if (!readyToStart || countdown !== null || handedOver.current) return;
    beginCountdown();
  }, [readyToStart, countdown, beginCountdown]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      handedOver.current = true;
      try { soundManager.playCountdownGo?.(); } catch { /* audio is optional */ }
      const bounds = finalizeCalibration?.() ?? null;
      onReady?.(bounds);
      return;
    }
    try { soundManager.playCountdown?.(); } catch { /* audio is optional */ }
    const id = setTimeout(() => setCountdown(c => (c === null ? null : c - 1)), 800);
    return () => clearTimeout(id);
  }, [countdown, finalizeCalibration, onReady]);

  const handleRestart = () => {
    setCountdown(null);
    handedOver.current = false;
    setHandSeenAt(null);
    recalibrate?.();
  };

  const handleAcceptAsIs = () => {
    if (handedOver.current) return;
    const bounds = finalizeCalibration?.();
    if (!bounds) return; // refuse rather than commit a mapping built on nothing
    handedOver.current = true;
    onReady?.(bounds);
  };

  /* The instruction shown large. It answers the only question the child has:
     what am I supposed to do right now. */
  const instruction = cameraError
    ? { title: 'Camera unavailable', sub: 'Allow camera access, or switch to touch mode to play without it.' }
    : !isTracking
      ? { title: 'Show your hand', sub: 'Open your hand in front of the camera, finger up.' }
      : !sweepDone
        ? { title: 'Sweep the whole area', sub: 'Move your finger slowly to light up every tile.' }
        : { title: 'Perfect!', sub: 'Starting the game…' };

  return (
    <div style={S.root} className="cal-root">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <header style={S.header}>
        <button onClick={onExit} style={S.backBtn} aria-label="Back">
          <ChevronLeft size={16} /> Back
        </button>
        <div style={S.headerCenter}>
          <div style={S.eyebrow}>Letter Quest · Setup</div>
          <h1 style={S.title}>Calibration</h1>
        </div>
        <div style={S.headerRight}>
          {learnerName && <span style={S.pill}>{learnerName}</span>}
          {difficultyLabel && <span style={{ ...S.pill, ...S.pillAccent }}>{difficultyLabel}</span>}
          {onSwitchToTouch && (
            <button onClick={onSwitchToTouch} style={S.touchBtn} title="Play by tapping the keys, with no camera">
              <Hand size={13} /> Touch mode
            </button>
          )}
        </div>
      </header>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <div style={S.body} className="cal-body">

        {/* Left: camera preview, small on purpose. The child watches the
            field, not themselves. */}
        <aside style={S.side} className="cal-side">
          <div style={S.sectionLabel}>Camera</div>
          <div style={S.cameraBox}>
            {cameraError ? (
              <div style={S.cameraError}>
                <Camera size={26} style={{ opacity: 0.5 }} />
                <div style={{ fontWeight: 700, marginTop: 8 }}>Camera unavailable</div>
                <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginTop: 4 }}>
                  Allow access so the hand can be tracked.
                </div>
              </div>
            ) : (
              <>
                <video ref={previewRef} autoPlay muted playsInline style={S.video} />
                <div style={{
                  ...S.camBadge,
                  color: isTracking ? '#10B981' : '#F59E0B',
                  borderColor: isTracking ? 'rgba(16,185,129,0.4)' : 'rgba(245,158,11,0.4)',
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: isTracking ? '#10B981' : '#F59E0B',
                  }} />
                  {isTracking ? `Hand tracked · ${trackingConfidence}%` : 'No hand'}
                </div>
              </>
            )}
          </div>

          <div style={S.sectionLabel}>Checks</div>
          <div style={S.checkList}>
            {checks.map(c => (
              <CheckRow key={c.label} icon={c.icon} label={c.label} state={c.state} detail={c.detail} />
            ))}
          </div>

          {savedCalibration && !sweepDone && (
            <button onClick={onUseSaved} style={S.savedBtn}>
              Reuse the previous calibration
            </button>
          )}
        </aside>

        {/* Center: the calibration field. This is the screen. */}
        <main style={S.main} className="cal-main">
          <div style={S.instructionBlock}>
            <motion.h2
              key={instruction.title}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              style={S.instructionTitle}
            >
              {instruction.title}
            </motion.h2>
            <p style={S.instructionSub}>{instruction.sub}</p>
          </div>

          <div style={S.fieldWrap}>
            <div style={S.field} className="cal-field" ref={fieldRef}>
              {/* Coverage tiles — plain divs with a CSS transition. They were
                  framer-motion components, so each one carried an animation
                  loop of its own and re-rendered with the screen; a tile that
                  changes twelve times in a whole calibration does not need
                  that machinery. */}
              <div style={S.grid}>
                {Array.from({ length: totalCells }).map((_, i) => {
                  const on = !!coverageCells[i];
                  return (
                    <div
                      key={i}
                      style={{
                        ...S.cell,
                        background: on ? 'rgba(16,185,129,0.20)' : 'rgba(255,255,255,0.035)',
                        border: on ? '2px solid rgba(16,185,129,0.65)' : '2px dashed rgba(34,211,238,0.22)',
                        boxShadow: on ? '0 0 22px rgba(16,185,129,0.25) inset' : 'none',
                      }}
                    >
                      {on && <Check size={18} color="#10B981" />}
                    </div>
                  );
                })}
              </div>

              {/* The live hand dot, in RAW camera space — it follows the hand
                  before any mapping exists, which is the whole point. Kept
                  mounted and hidden rather than unmounted, so appearing costs
                  an opacity change instead of a mount. */}
              <div
                ref={dotRef}
                style={{ ...S.handDot, opacity: isTracking ? 1 : 0 }}
              >
                <span style={S.handDotCore} />
              </div>

              {/* Waiting state */}
              {!isTracking && !cameraError && (
                <div style={S.waiting}>
                  <motion.div
                    animate={reduced ? {} : { y: [0, -8, 0] }}
                    transition={{ repeat: Infinity, duration: 1.8 }}
                    style={{ fontSize: '3rem' }}
                  >
                    ✋
                  </motion.div>
                  <div style={S.waitingText}>Waiting for your hand…</div>
                </div>
              )}

              {/* Countdown */}
              <AnimatePresence>
                {countdown !== null && countdown > 0 && (
                  <motion.div
                    key={countdown}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.5 }}
                    transition={{ duration: 0.3 }}
                    style={S.countdown}
                  >
                    {countdown}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Progress + actions */}
          <div style={S.footer}>
            <div style={S.progressRow}>
              <span style={S.progressLabel}>
                Area covered · {covered}/{totalCells}
              </span>
              <span style={S.progressPct}>
                {Math.round(Math.min(1, calibrationProgress) * 100)}%
              </span>
            </div>
            <div style={S.progressTrack}>
              <motion.div
                animate={{ width: `${Math.round(Math.min(1, calibrationProgress) * 100)}%` }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                style={{
                  ...S.progressFill,
                  background: readyToStart
                    ? 'linear-gradient(90deg,#059669,#10B981)'
                    : 'linear-gradient(90deg,#0D5E6B,#22d3ee)',
                }}
              />
            </div>

            <div style={S.actions}>
              <button onClick={handleRestart} style={S.ghostBtn}>
                <RotateCcw size={14} /> Start over
              </button>

              {canManuallyAccept && (
                <button onClick={handleAcceptAsIs} style={S.secondaryBtn}>
                  Use as is
                </button>
              )}

              <button
                onClick={beginCountdown}
                disabled={!readyToStart || countdown !== null}
                style={{
                  ...S.primaryBtn,
                  opacity: readyToStart && countdown === null ? 1 : 0.4,
                  cursor: readyToStart && countdown === null ? 'pointer' : 'not-allowed',
                }}
              >
                {countdown !== null ? 'Starting…' : 'Start'} <ArrowRight size={16} />
              </button>
            </div>

            <div style={S.hint}>
              Nothing is recorded or scored on this screen. The game only starts
              once your hand is properly tracked.
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────── */
const S = {
  root: {
    position: 'fixed', inset: 0, zIndex: 4000,
    background: 'radial-gradient(1200px 600px at 50% -10%, #123038 0%, #0F1E22 55%, #0B1618 100%)',
    display: 'flex', flexDirection: 'column',
    fontFamily: 'Inter, system-ui, sans-serif', color: '#E0F2FE',
    overflow: 'hidden',
  },

  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 22px', borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0, gap: 12,
  },
  backBtn: {
    display: 'flex', alignItems: 'center', gap: 4,
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    color: '#9CA3AF', borderRadius: 10, padding: '7px 12px',
    fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', flex: '0 0 auto',
  },
  headerCenter: { textAlign: 'center', flex: 1, minWidth: 0 },
  eyebrow: {
    fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.16em',
    textTransform: 'uppercase', color: '#0D5E6B',
  },
  title: {
    margin: '2px 0 0', fontSize: '1.15rem', fontWeight: 800,
    letterSpacing: '-0.01em', color: '#E0F2FE',
  },
  headerRight: { display: 'flex', gap: 6, flex: '0 0 auto' },
  pill: {
    fontSize: '0.68rem', fontWeight: 700, padding: '5px 11px', borderRadius: 99,
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.09)',
    color: '#9CA3AF', whiteSpace: 'nowrap',
  },
  pillAccent: {
    background: 'rgba(232,132,26,0.12)', border: '1px solid rgba(232,132,26,0.3)',
    color: '#E8841A',
  },
  touchBtn: {
    display: 'flex', alignItems: 'center', gap: 5,
    background: 'rgba(139,92,246,0.14)', border: '1px solid rgba(139,92,246,0.35)',
    color: '#A78BFA', borderRadius: 99, padding: '5px 12px',
    fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  },

  body: { flex: 1, minHeight: 0, display: 'flex', gap: 20, padding: 20 },

  side: {
    width: 290, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8,
    overflowY: 'auto',
  },
  sectionLabel: {
    fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.14em',
    textTransform: 'uppercase', color: '#0D5E6B', marginTop: 6,
  },
  cameraBox: {
    width: '100%', aspectRatio: '16 / 9', borderRadius: 14, overflow: 'hidden',
    position: 'relative', background: '#0D1A1D',
    border: '1px solid rgba(255,255,255,0.07)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  video: { width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' },
  overlayCanvas: {
    position: 'absolute', inset: 0, width: '100%', height: '100%',
    objectFit: 'cover', transform: 'scaleX(-1)', pointerEvents: 'none',
  },
  cameraError: { padding: 16, textAlign: 'center', color: '#9CA3AF' },
  camBadge: {
    position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
    display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
    background: 'rgba(0,0,0,0.66)', border: '1px solid',
    padding: '4px 11px', borderRadius: 99, fontSize: '0.7rem', fontWeight: 700,
  },

  checkList: { display: 'flex', flexDirection: 'column', gap: 6 },
  checkRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 11, padding: '9px 11px',
  },
  checkIcon: {
    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  checkLabel: { fontSize: '0.79rem', fontWeight: 700, color: '#E0F2FE' },
  checkDetail: { fontSize: '0.68rem', color: '#9CA3AF', marginTop: 1, lineHeight: 1.35 },

  savedBtn: {
    marginTop: 10, width: '100%', padding: '10px 12px', borderRadius: 11,
    background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.32)',
    color: '#A78BFA', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
  },

  main: {
    flex: 1, minWidth: 0, minHeight: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
  },
  instructionBlock: { textAlign: 'center', flexShrink: 0 },
  instructionTitle: {
    margin: 0, fontSize: 'clamp(1.4rem, 3vw, 2.1rem)', fontWeight: 900,
    letterSpacing: '-0.02em', color: '#E0F2FE',
  },
  instructionSub: { margin: '5px 0 0', fontSize: '0.9rem', color: '#93C5FD' },

  fieldWrap: {
    flex: 1, minHeight: 0, width: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  field: {
    position: 'relative', width: '100%', maxWidth: 760,
    aspectRatio: '4 / 3', maxHeight: '100%',
    borderRadius: 22, background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.08)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.35)', overflow: 'hidden',
  },
  grid: {
    position: 'absolute', inset: 14,
    display: 'grid',
    gridTemplateColumns: `repeat(${CAL_COLS}, 1fr)`,
    gridTemplateRows: `repeat(${CAL_ROWS}, 1fr)`,
    gap: 10,
  },
  cell: {
    borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background 0.25s ease, border-color 0.25s ease',
  },

  /* Positioned only by `transform`, written from the animation frame above.
     `left`/`top` are pinned at 0 and never animated: animating them made the
     browser re-run layout for the whole field on every camera frame. */
  handDot: {
    position: 'absolute', left: 0, top: 0, width: 0, height: 0,
    pointerEvents: 'none', zIndex: 5,
    willChange: 'transform',
    transition: 'opacity 0.2s ease',
  },
  handDotCore: {
    position: 'absolute', width: 18, height: 18, borderRadius: '50%',
    transform: 'translate(-50%, -50%)',
    /* A flat fill and a thin ring instead of a radial gradient under a blurred
       box-shadow — a moving blur is repainted every frame and was the single
       most expensive pixel on the screen. */
    background: '#22d3ee',
    border: '2px solid rgba(224,242,254,0.9)',
  },

  waiting: {
    position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 8,
    background: 'rgba(11,22,24,0.55)', backdropFilter: 'blur(2px)', zIndex: 6,
  },
  waitingText: { fontSize: '0.85rem', fontWeight: 700, color: '#93C5FD' },

  countdown: {
    position: 'absolute', inset: 0, display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 20,
    background: 'rgba(11,22,24,0.72)', backdropFilter: 'blur(6px)',
    fontSize: 'clamp(5rem, 18vw, 11rem)', fontWeight: 900, color: '#22d3ee',
    textShadow: '0 0 60px rgba(34,211,238,0.55)',
  },

  footer: { width: '100%', maxWidth: 760, flexShrink: 0 },
  progressRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: '0.72rem', fontWeight: 700, color: '#9CA3AF',
    textTransform: 'uppercase', letterSpacing: '0.08em',
  },
  progressPct: { fontSize: '0.85rem', fontWeight: 800, color: '#22d3ee' },
  progressTrack: {
    height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 4 },

  actions: { display: 'flex', gap: 10, marginTop: 14, justifyContent: 'center', flexWrap: 'wrap' },
  ghostBtn: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '11px 18px', borderRadius: 12,
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    color: '#9CA3AF', fontSize: '0.83rem', fontWeight: 700, cursor: 'pointer',
  },
  secondaryBtn: {
    padding: '11px 18px', borderRadius: 12,
    background: 'rgba(232,132,26,0.12)', border: '1px solid rgba(232,132,26,0.35)',
    color: '#E8841A', fontSize: '0.83rem', fontWeight: 700, cursor: 'pointer',
  },
  primaryBtn: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '11px 26px', borderRadius: 12, border: 'none',
    background: 'linear-gradient(135deg,#059669,#10B981)', color: '#fff',
    fontSize: '0.9rem', fontWeight: 800,
    boxShadow: '0 6px 22px rgba(16,185,129,0.32)',
    transition: 'opacity 0.2s',
  },
  hint: {
    marginTop: 10, textAlign: 'center', fontSize: '0.72rem',
    color: '#64748B', lineHeight: 1.5,
  },
};
