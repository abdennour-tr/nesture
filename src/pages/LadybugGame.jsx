/**
 * LadybugGame.jsx
 * "Follow the Ladybug" — occupational-therapy tracing game.
 *
 * The child points at the ladybug with the index fingertip to pick it up, then
 * carries it along the dotted sinusoidal path all the way to the leaf. The bug
 * follows the finger; drifting too far lets it slip out of the child's grip.
 *
 * Design note on progress: `tMax` only advances while the ladybug is inside the
 * tolerance band. Cutting straight across the field therefore never completes
 * the level — the child has to actually trace the curve, which is the point of
 * the exercise.
 *
 * Performance contract: the game loop runs entirely on refs + rAF and mutates
 * DOM transforms directly. React state is only touched for phase changes,
 * discrete grab/release events, and a throttled 5 Hz score readout, so there is
 * no per-frame re-render.
 *
 * Pointer rendering follows the same model as TraceTypeGame: index tip is
 * landmark 8, x mirrored, EMA-smoothed, drawn with a glow + fading trail.
 *
 * Route: /play/ladybug-game?level=easy|medium|hard&mode=camera|touch
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home, Pause, Play, RotateCcw, Clock, Star, Hand, MousePointer2,
  Volume2, VolumeX, Target, Activity, Zap, TrendingUp, CheckCircle,
} from 'lucide-react';
import useHandTracking from '../hooks/useHandTracking';
import { soundManager } from '../utils/soundManager';
import { useAuthStore, useSessionStore } from '../store';
import api from '../services/api';
import '../styles/LadybugGame.css';

/* ═══════════════════════════════════════════════════════════════════════════
   GEOMETRY — the play field uses a fixed virtual coordinate space that is
   scaled to the rendered element. All game math happens in this space so the
   difficulty tuning stays identical on every screen size.
   ═══════════════════════════════════════════════════════════════════════════ */
const VW = 1000;   // virtual width
const VH = 560;    // virtual height
const PATH_X0 = 95;
const PATH_X1 = 895;
const PATH_YC = 300;

/* ── Difficulty tuning ──────────────────────────────────────────────────── */
const LEVELS = {
  easy: {
    key: 'easy', label: 'Easy', emoji: '🌱', color: '#38A169',
    grabRadius: 70, tolerance: 85, periods: 1.0, amplitude: 80, refTimeMs: 25000, graceMs: 1000,
  },
  medium: {
    key: 'medium', label: 'Medium', emoji: '⚡', color: '#DD6B20',
    grabRadius: 55, tolerance: 60, periods: 1.5, amplitude: 110, refTimeMs: 20000, graceMs: 750,
  },
  hard: {
    key: 'hard', label: 'Hard', emoji: '🔥', color: '#E53E3E',
    grabRadius: 45, tolerance: 40, periods: 2.0, amplitude: 140, refTimeMs: 16000, graceMs: 550,
  },
};

/* ── Tracking / scoring constants ───────────────────────────────────────── */
const EMA_ALPHA          = 0.35;  // pointer smoothing (matches TraceTypeGame feel)
const BUG_LERP           = 0.5;   // how tightly the bug trails the finger
const ANGLE_LERP         = 0.18;  // rotation smoothing so the bug doesn't twitch
const RELEASE_FACTOR     = 2.0;   // release radius = grabRadius × this
const HYSTERESIS         = 15;    // px added to tolerance before "off path" flips
const TRAIL_LENGTH       = 8;     // pointer trail samples
const POINTS_PER_SECOND  = 20;    // score rate while on path
const PAUSE_SPEED_THRESH = 25;    // px/s below which the child counts as paused
const PAUSE_MIN_MS       = 350;   // a pause must last this long to be counted
const DIR_CHANGE_THRESH  = 1.05;  // radians of heading change counted as a reversal
const FINISH_T           = 0.97;  // path coverage required before the leaf counts
const FINISH_DIST        = 70;    // px from the leaf to land on it
/* Straying off the path is warned before it is punished. The child gets a short
   grace window (red field + shaking bug) to steer back; only if they are still
   off the path when it expires does the ladybug fly back to the furthest point
   they legitimately reached, and they have to point at it again to carry on.
   The window also keeps "time off path" measurable — snapping back instantly
   would make Path Accuracy read ~100% for everyone. */
const RETURN_MS          = 450;   // duration of the fly-back animation
/* Progress may advance at most this much of the path per second. A straight
   shortcut across the field re-enters the tolerance band near each zero
   crossing of the sine, which would otherwise let `tMax` jump 0.33 → 0.67 → 1
   and finish the level without tracing anything. Capping the rate forces the
   child to travel the curve continuously. Generous enough that a fast but
   legitimate traversal (whole path in half a second) is never penalised. */
const MAX_T_RATE         = 2.0;
/* How long the child may outrun MAX_T_RATE before the ladybug slips away.
   Progress used to just freeze silently when they raced ahead: the bug still
   followed the finger to the leaf, but the level could never complete and
   nothing said why. Now racing has the same visible consequence as leaving the
   path -- the ladybug escapes back to the last point actually traced. Long
   enough that a single fast flick or a tracking spike is forgiven. */
const OVERSPEED_GRACE_MS = 220;
const COUNTDOWN_SECONDS  = 3;
const RULES_FLAG         = 'ladybug_rules_seen';

/* ── Path helpers ───────────────────────────────────────────────────────── */
/** Point on the sinusoidal path at normalised progress t ∈ [0,1]. */
function pathPointAt(t, cfg) {
  const x = PATH_X0 + (PATH_X1 - PATH_X0) * t;
  const y = PATH_YC + cfg.amplitude * Math.sin(2 * Math.PI * cfg.periods * t);
  return { x, y };
}

/** Build the SVG `d` string for the path, sampled finely enough to look smooth. */
function buildPathD(cfg, samples = 220) {
  let d = '';
  for (let i = 0; i <= samples; i++) {
    const p = pathPointAt(i / samples, cfg);
    d += (i === 0 ? 'M' : 'L') + p.x.toFixed(2) + ' ' + p.y.toFixed(2);
  }
  return d;
}

/** Pre-sampled polyline of the path — reused every frame by projectOnPath. */
function buildSamples(cfg, n = 140) {
  const xs = new Float64Array(n + 1);
  const ys = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const p = pathPointAt(i / n, cfg);
    xs[i] = p.x; ys[i] = p.y;
  }
  return { xs, ys, n };
}

/**
 * Nearest point on the path to (px, py).
 * Coarse scan over the pre-sampled polyline, then a short local refinement so
 * the returned t is accurate enough for scoring without a costly fine scan.
 * Returns { t, x, y, dist }.
 */
function projectOnPath(px, py, cfg, samples) {
  const { xs, ys, n } = samples;
  let bestI = 0;
  let bestD2 = Infinity;
  for (let i = 0; i <= n; i++) {
    const dx = px - xs[i];
    const dy = py - ys[i];
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; bestI = i; }
  }

  // Refine within the neighbouring segments by golden-ish bisection on t.
  let lo = Math.max(0, (bestI - 1) / n);
  let hi = Math.min(1, (bestI + 1) / n);
  let bestT = bestI / n;
  let bestP = { x: xs[bestI], y: ys[bestI] };
  for (let k = 0; k < 12; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const p1 = pathPointAt(m1, cfg);
    const p2 = pathPointAt(m2, cfg);
    const d1 = (px - p1.x) ** 2 + (py - p1.y) ** 2;
    const d2 = (px - p2.x) ** 2 + (py - p2.y) ** 2;
    if (d1 < d2) { hi = m2; if (d1 < bestD2) { bestD2 = d1; bestT = m1; bestP = p1; } }
    else         { lo = m1; if (d2 < bestD2) { bestD2 = d2; bestT = m2; bestP = p2; } }
  }
  return { t: bestT, x: bestP.x, y: bestP.y, dist: Math.sqrt(bestD2) };
}

const easeOutCubic = (u) => 1 - Math.pow(1 - u, 3);

const fmtTime = (s) => {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
};
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ═══════════════════════════════════════════════════════════════════════════
   LADYBUG — pure CSS/SVG, no emoji. Rendered once and moved via transform.
   ═══════════════════════════════════════════════════════════════════════════ */
const Ladybug = React.forwardRef(function Ladybug(_props, ref) {
  return (
    <div className="lb-bug" ref={ref} aria-hidden="true">
      <div className="lb-bug-halo" />
      <div className="lb-bug-shadow" />
      <svg className="lb-bug-svg" viewBox="0 0 100 100" width="100%" height="100%">
        <defs>
          <radialGradient id="lbShellGrad" cx="38%" cy="30%">
            <stop offset="0%" stopColor="#FF6B6B" />
            <stop offset="55%" stopColor="#E53E3E" />
            <stop offset="100%" stopColor="#B32424" />
          </radialGradient>
          <radialGradient id="lbHeadGrad" cx="40%" cy="30%">
            <stop offset="0%" stopColor="#4A4A4A" />
            <stop offset="100%" stopColor="#161616" />
          </radialGradient>
        </defs>
        {/* antennae */}
        <path d="M38 26 Q30 12 22 9" className="lb-antenna" />
        <path d="M56 25 Q62 11 71 9" className="lb-antenna" />
        <circle cx="21" cy="8" r="4" fill="#161616" />
        <circle cx="72" cy="8" r="4" fill="#161616" />
        {/* shell */}
        <ellipse cx="50" cy="58" rx="34" ry="32" fill="url(#lbShellGrad)" />
        <path d="M50 26 L50 90" stroke="#1A1A1A" strokeWidth="3.2" strokeLinecap="round" />
        {/* spots */}
        <circle cx="34" cy="46" r="6.4" fill="#1A1A1A" />
        <circle cx="66" cy="46" r="6.4" fill="#1A1A1A" />
        <circle cx="29" cy="68" r="5.4" fill="#1A1A1A" />
        <circle cx="71" cy="68" r="5.4" fill="#1A1A1A" />
        <circle cx="42" cy="82" r="4.2" fill="#1A1A1A" />
        <circle cx="58" cy="82" r="4.2" fill="#1A1A1A" />
        {/* gloss */}
        <ellipse cx="38" cy="42" rx="11" ry="7" fill="#FFFFFF" opacity="0.28" transform="rotate(-28 38 42)" />
        {/* head */}
        <ellipse cx="50" cy="27" rx="21" ry="17" fill="url(#lbHeadGrad)" />
        <circle cx="42" cy="25" r="6" fill="#FFFFFF" />
        <circle cx="58" cy="25" r="6" fill="#FFFFFF" />
        <circle className="lb-pupil" cx="43" cy="26" r="3.1" fill="#111111" />
        <circle className="lb-pupil" cx="59" cy="26" r="3.1" fill="#111111" />
        <circle cx="44.2" cy="24.4" r="1.1" fill="#FFFFFF" />
        <circle cx="60.2" cy="24.4" r="1.1" fill="#FFFFFF" />
      </svg>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   LEAF — the goal marker.
   Rendered as an absolutely-positioned HTML layer rather than inside the
   stretched path SVG, so its aspect ratio stays true on every screen size.
   ═══════════════════════════════════════════════════════════════════════════ */
function Leaf({ x, y }) {
  return (
    <div
      className="lb-leaf"
      style={{ left: `${(x / VW) * 100}%`, top: `${(y / VH) * 100}%` }}
      aria-hidden="true"
    >
      {/* viewBox is centred on the blade so the leaf sits exactly on the path end */}
      <svg viewBox="-62 -106 124 134" width="100%" height="100%">
        <circle className="lb-leaf-halo" cx="0" cy="-40" r="52" />
        {/* stem */}
        <path d="M4 -6 L4 -60" stroke="#8B5E3C" strokeWidth="4.5" strokeLinecap="round" />
        {/* blade */}
        <path
          className="lb-leaf-blade"
          d="M4 -4 C -34 -12 -46 -44 -22 -60 C 6 -74 34 -52 32 -22 C 31 -8 18 -2 4 -4 Z"
          fill="#3FA34D"
          stroke="#2F7F3C"
          strokeWidth="2.5"
        />
        <path
          d="M4 -6 C -6 -18 -14 -34 -20 -52"
          stroke="#2F7F3C" strokeWidth="2" fill="none" opacity="0.75"
        />
        <path d="M-4 -18 L-16 -26 M0 -28 L-10 -40 M6 -36 L0 -50"
          stroke="#2F7F3C" strokeWidth="1.4" fill="none" opacity="0.55" />
        {/* flag pole */}
        <path d="M4 -58 L4 -100" stroke="#8B5E3C" strokeWidth="3.5" strokeLinecap="round" />
        <path className="lb-flag" d="M6 -98 L36 -88 L6 -78 Z" fill="#E53E3E" />
      </svg>
    </div>
  );
}

/* Tiny ladybug used in the progress bar. */
function MiniBug({ size = 22 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <ellipse cx="50" cy="56" rx="33" ry="31" fill="#E53E3E" />
      <path d="M50 25 L50 87" stroke="#1A1A1A" strokeWidth="4" />
      <circle cx="33" cy="47" r="7" fill="#1A1A1A" />
      <circle cx="67" cy="47" r="7" fill="#1A1A1A" />
      <ellipse cx="50" cy="26" rx="20" ry="16" fill="#161616" />
      <circle cx="42" cy="24" r="5.5" fill="#FFFFFF" />
      <circle cx="58" cy="24" r="5.5" fill="#FFFFFF" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   RULES MODAL
   ═══════════════════════════════════════════════════════════════════════════ */
const RULES = [
  { icon: '☝️', text: 'Point at the ladybug with your finger to pick it up.' },
  { icon: '🐞', text: 'The ladybug follows your finger — move it along the dotted path.' },
  { icon: '⭐', text: 'You earn points while the ladybug stays on the path.' },
  { icon: '❌', text: 'Move too far away and the ladybug slips out of your grip!' },
  { icon: '↩️', text: 'Leave the path too long and it flies back — point at it to carry on.' },
  { icon: '🍃', text: 'Bring the ladybug all the way to the leaf to finish.' },
  { icon: '⏸️', text: 'You can pause at any time.' },
];

function RulesModal({ level, mode, onStart }) {
  return (
    <motion.div
      className="lb-overlay"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        className="lb-rules-card"
        initial={{ scale: 0.88, y: 30, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 22 }}
      >
        <div className="lb-rules-head">
          <div className="lb-rules-badge">
            <svg viewBox="0 0 100 100" width="46" height="46">
              <ellipse cx="50" cy="56" rx="33" ry="31" fill="#E53E3E" />
              <path d="M50 25 L50 87" stroke="#1A1A1A" strokeWidth="3" />
              <circle cx="34" cy="46" r="6" fill="#1A1A1A" />
              <circle cx="66" cy="46" r="6" fill="#1A1A1A" />
              <circle cx="30" cy="68" r="5" fill="#1A1A1A" />
              <circle cx="70" cy="68" r="5" fill="#1A1A1A" />
              <ellipse cx="50" cy="26" rx="20" ry="16" fill="#161616" />
              <circle cx="42" cy="24" r="5.5" fill="#fff" />
              <circle cx="58" cy="24" r="5.5" fill="#fff" />
              <circle cx="43" cy="25" r="2.8" fill="#111" />
              <circle cx="59" cy="25" r="2.8" fill="#111" />
            </svg>
          </div>
          <div>
            <h2 className="lb-rules-title">Follow the Ladybug</h2>
            <p className="lb-rules-sub">
              {LEVELS[level].emoji} {LEVELS[level].label} &nbsp;·&nbsp;
              {mode === 'camera' ? 'Camera mode' : 'Touch mode'}
            </p>
          </div>
        </div>

        <ul className="lb-rules-list">
          {RULES.map((r, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: -18 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.12 + i * 0.07 }}
            >
              <span className="lb-rule-icon">{r.icon}</span>
              <span>{r.text}</span>
            </motion.li>
          ))}
        </ul>

        <button className="lb-btn lb-btn-primary lb-rules-start" onClick={onStart}>
          <Play size={20} /> Let&apos;s go! 🐞
        </button>
      </motion.div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */
export default function LadybugGame() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, profile } = useAuthStore();
  const { startSession: storeStartSession, endSession: storeEndSession } = useSessionStore();

  const levelKey = (searchParams.get('level') || 'easy').toLowerCase();
  const level = LEVELS[levelKey] ? levelKey : 'easy';
  const cfg = LEVELS[level];

  const [mode, setMode] = useState(
    (searchParams.get('mode') || 'camera').toLowerCase() === 'touch' ? 'touch' : 'camera'
  );
  const [soundEnabled, setSoundEnabled] = useState(true);

  /* ── Phases: rules → countdown → playing → results ── */
  const [gamePhase, setGamePhase] = useState(() =>
    sessionStorage.getItem(RULES_FLAG) ? 'countdown' : 'rules'
  );
  const [isPaused, setIsPaused] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);

  /* ── Throttled UI readouts (never written from inside the rAF loop) ── */
  const [uiScore, setUiScore] = useState(0);
  const [uiElapsed, setUiElapsed] = useState(0);
  const [uiProgress, setUiProgress] = useState(0);
  const [uiOnPath, setUiOnPath] = useState(true);
  /* Discrete events — set on transition only, so these are cheap. */
  const [uiGrabbed, setUiGrabbed] = useState(false);
  const [uiEverGrabbed, setUiEverGrabbed] = useState(false);
  /* Why the ladybug last escaped, so the hint can say something useful
     instead of the same generic line for both causes. */
  const [escapeReason, setEscapeReason] = useState(null);
  const [results, setResults] = useState(null);

  /* ── DOM refs used by the loop ── */
  const videoRef      = useRef(null);
  const trackCanvasRef = useRef(null);   // consumed by useHandTracking
  const fieldRef      = useRef(null);
  const bugRef        = useRef(null);
  const pointerCanvasRef = useRef(null);
  const progressBugRef = useRef(null);

  /* ── Per-frame state (refs → zero re-renders) ── */
  const rafRef        = useRef(null);
  const lastTsRef     = useRef(0);
  const scoreRef      = useRef(0);
  const pointerRef    = useRef(null);   // { x, y } smoothed, virtual coords
  const trailRef      = useRef([]);
  const onPathRef     = useRef(true);
  const touchActiveRef = useRef(false);

  /* ── Ladybug state ── */
  const bugPosRef   = useRef(pathPointAt(0, cfg));
  const bugAngleRef = useRef(0);
  const grabbedRef  = useRef(false);
  const tMaxRef     = useRef(0);

  /* ── Off-path grace + fly-back ── */
  const offSinceRef    = useRef(null);   // ts when the bug left the band
  const returningRef   = useRef(false);
  /* Sustained over-speed: when it started, and how often it cost the bug. */
  const overSinceRef   = useRef(null);
  const overspeedsRef  = useRef(0);
  const returnFromRef  = useRef(null);
  const returnToRef    = useRef(null);
  const returnStartRef = useRef(0);

  /* ── Metric accumulators ── */
  const startedAtRef   = useRef(0);
  const firstGrabAtRef = useRef(null);
  const dropsRef       = useRef(0);
  const pausedMsRef    = useRef(0);
  const pauseStartRef  = useRef(0);
  const onPathMsRef    = useRef(0);
  const carryMsRef     = useRef(0);   // time spent actually holding the bug
  const totalMsRef     = useRef(0);
  const lastMoveRef    = useRef(null);   // { x, y } of the bug
  const headingRef     = useRef(null);
  const dirChangesRef  = useRef(0);
  const pauseCountRef  = useRef(0);
  const pauseMsRef     = useRef(0);
  const slowSinceRef   = useRef(null);
  const jerkSamplesRef = useRef([]);

  /* ── Session bookkeeping ── */
  const [sessionId, setSessionId] = useState(null);
  const sessionSavedRef = useRef(false);

  /* ── Derived geometry (memoised per level) ── */
  const pathD = useMemo(() => buildPathD(cfg), [cfg]);
  const samples = useMemo(() => buildSamples(cfg), [cfg]);
  const goal = useMemo(() => pathPointAt(1, cfg), [cfg]);

  const isPlaying = gamePhase === 'playing' && !isPaused;
  const trackingEnabled = mode === 'camera' && (gamePhase === 'countdown' || gamePhase === 'playing');

  const { landmarks, isTracking, isSimulationMode } = useHandTracking(
    videoRef, trackCanvasRef, trackingEnabled, isPaused, 1
  );

  /* ═════════════════════════════════════════════════════════════════════════
     Coordinate helpers
     ═════════════════════════════════════════════════════════════════════════ */
  /** Map a client (screen) point into the virtual play-field space. */
  const clientToVirtual = useCallback((clientX, clientY) => {
    const el = fieldRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * VW,
      y: ((clientY - r.top) / r.height) * VH,
    };
  }, []);

  /** Feed a raw sample through the EMA filter. */
  const pushPointer = useCallback((pt) => {
    if (!pt) return;
    const prev = pointerRef.current;
    if (!prev) {
      pointerRef.current = { x: pt.x, y: pt.y };
    } else {
      pointerRef.current = {
        x: prev.x + (pt.x - prev.x) * EMA_ALPHA,
        y: prev.y + (pt.y - prev.y) * EMA_ALPHA,
      };
    }
  }, []);

  /** Place the ladybug + write its transform. Called from the loop. */
  const paintBug = useCallback(() => {
    const el = bugRef.current;
    if (!el) return;
    const p = bugPosRef.current;
    el.style.left = ((p.x / VW) * 100) + '%';
    el.style.top = ((p.y / VH) * 100) + '%';
    el.style.transform =
      `rotate(${bugAngleRef.current.toFixed(1)}deg) scale(${grabbedRef.current ? 1.15 : 1})`;
  }, []);

  /* ═════════════════════════════════════════════════════════════════════════
     INPUT — MediaPipe (landmark 8, mirrored) mapped into virtual space.
     Mirrors TraceTypeGame's mapping model, scaled to the play field.
     ═════════════════════════════════════════════════════════════════════════ */
  useEffect(() => {
    if (mode !== 'camera' || !isPlaying) return;
    if (!landmarks || landmarks.length < 9) return;
    const tip = landmarks[8];
    if (!tip) return;
    pushPointer({ x: (1 - tip.x) * VW, y: tip.y * VH });
  }, [landmarks, mode, isPlaying, pushPointer]);

  /* ── Touch / mouse input ── */
  const handlePointerDown = useCallback((e) => {
    if (mode !== 'touch' || !isPlaying) return;
    touchActiveRef.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    pushPointer(clientToVirtual(e.clientX, e.clientY));
  }, [mode, isPlaying, clientToVirtual, pushPointer]);

  const handlePointerMove = useCallback((e) => {
    if (mode !== 'touch' || !isPlaying) return;
    if (!touchActiveRef.current && e.pointerType === 'touch') return;
    pushPointer(clientToVirtual(e.clientX, e.clientY));
  }, [mode, isPlaying, clientToVirtual, pushPointer]);

  /** Lifting the finger in touch mode drops the ladybug. */
  const handlePointerUp = useCallback((e) => {
    touchActiveRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    if (mode === 'touch' && grabbedRef.current) {
      grabbedRef.current = false;
      dropsRef.current += 1;
      setUiGrabbed(false);
    }
  }, [mode]);

  /* ═════════════════════════════════════════════════════════════════════════
     GAME LOOP — the only place per-frame work happens.
     ═════════════════════════════════════════════════════════════════════════ */
  const finishGame = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const carryMs = Math.max(1, carryMsRef.current);
    const accuracy = clamp01(onPathMsRef.current / carryMs) * 100;

    // Smoothness: low mean jerk → high score. Normalised against a generous cap.
    const jerks = jerkSamplesRef.current;
    const meanJerk = jerks.length
      ? jerks.reduce((a, b) => a + b, 0) / jerks.length
      : 0;
    const smoothness = clamp01(1 - meanJerk / 2600) * 100;

    // Speed: measured against a per-level reference time.
    const totalMs = Math.max(1, totalMsRef.current);
    const speedScore = clamp01(cfg.refTimeMs / totalMs) * 100;

    // Grip: how well the child kept hold of the ladybug.
    const grip = clamp01(1 - dropsRef.current / 6) * 100;

    const composite = Math.round(
      accuracy * 0.40 + smoothness * 0.25 + speedScore * 0.20 + grip * 0.15
    );

    const reactionMs = firstGrabAtRef.current == null
      ? null
      : firstGrabAtRef.current - startedAtRef.current;

    const payload = {
      score: Math.round(scoreRef.current),
      accuracy: Math.round(accuracy),
      smoothness: Math.round(smoothness),
      speedScore: Math.round(speedScore),
      grip: Math.round(grip),
      drops: dropsRef.current,
      overspeeds: overspeedsRef.current,
      composite,
      reactionMs: reactionMs == null ? null : Math.round(reactionMs),
      movementMs: Math.round(carryMs),
      completionSec: totalMs / 1000,
      pauses: pauseCountRef.current,
      pauseMs: Math.round(pauseMsRef.current),
      directionChanges: dirChangesRef.current,
    };
    setResults(payload);
    setGamePhase('results');
    if (soundEnabled) soundManager.playCelebration();
  }, [cfg.refTimeMs, soundEnabled]);

  const finishRef = useRef(finishGame);
  useEffect(() => { finishRef.current = finishGame; }, [finishGame]);

  useEffect(() => {
    if (gamePhase !== 'playing' || isPaused) return;

    let lastUiPush = 0;
    let lastProgressBeep = 0;

    /* The ladybug slips out of the child's hands and flies home to the last
       point they legitimately traced. Shared by the two ways of losing it:
       straying off the path, and racing ahead of it. */
    const releaseBug = (ts, reason) => {
      returningRef.current = true;
      returnFromRef.current = { ...bugPosRef.current };
      returnToRef.current = pathPointAt(tMaxRef.current, cfg);
      returnStartRef.current = ts;
      grabbedRef.current = false;
      dropsRef.current += 1;
      offSinceRef.current = null;
      overSinceRef.current = null;
      lastMoveRef.current = null;
      headingRef.current = null;
      if (bugRef.current) bugRef.current.classList.add('lb-bug-returning');
      setUiGrabbed(false);
      setEscapeReason(reason);
      if (soundEnabled) soundManager.playClick();
    };

    const step = (ts) => {
      rafRef.current = requestAnimationFrame(step);
      if (!lastTsRef.current) { lastTsRef.current = ts; return; }
      const dtMs = Math.min(64, ts - lastTsRef.current); // clamp tab-switch spikes
      lastTsRef.current = ts;
      const dt = dtMs / 1000;
      totalMsRef.current += dtMs;

      const ptr = pointerRef.current;
      const grabR = cfg.grabRadius;
      const releaseR = grabR * RELEASE_FACTOR;

      /* ── Fly-back animation: the bug is out of the child's hands ───────── */
      if (returningRef.current) {
        const u = clamp01((ts - returnStartRef.current) / RETURN_MS);
        const e = easeOutCubic(u);
        const a = returnFromRef.current;
        const b = returnToRef.current;
        bugPosRef.current = {
          x: a.x + (b.x - a.x) * e,
          y: a.y + (b.y - a.y) * e,
        };
        // Spin gently on the way home so the flight reads as deliberate.
        bugAngleRef.current = (1 - e) * 40 * Math.sin(u * Math.PI * 3);
        if (u >= 1) {
          returningRef.current = false;
          bugPosRef.current = { x: b.x, y: b.y };
          bugAngleRef.current = 0;
          if (bugRef.current) bugRef.current.classList.remove('lb-bug-returning');
        }
      }

      /* ── Grab / release state machine ──────────────────────────────────── */
      if (ptr && !returningRef.current) {
        const bp = bugPosRef.current;
        const dToBug = Math.hypot(ptr.x - bp.x, ptr.y - bp.y);

        if (!grabbedRef.current) {
          // Reaching for the bug: close enough → pick it up.
          if (dToBug <= grabR) {
            grabbedRef.current = true;
            if (firstGrabAtRef.current == null) {
              firstGrabAtRef.current = ts;
              setUiEverGrabbed(true);
            }
            lastMoveRef.current = null;
            headingRef.current = null;
            offSinceRef.current = null;
            overSinceRef.current = null;
            setEscapeReason(null);   // picked it up again; the hint has done its job
            setUiGrabbed(true);
            if (soundEnabled) soundManager.playClick();
          }
        } else if (dToBug > releaseR) {
          // Slipped out of the grip.
          grabbedRef.current = false;
          dropsRef.current += 1;
          offSinceRef.current = null;
          setUiGrabbed(false);
        }
      }

      /* ── Carry the bug toward the finger ───────────────────────────────── */
      if (grabbedRef.current && ptr) {
        carryMsRef.current += dtMs;
        const bp = bugPosRef.current;
        const nx = bp.x + (ptr.x - bp.x) * BUG_LERP;
        const ny = bp.y + (ptr.y - bp.y) * BUG_LERP;

        // Orient the bug along its own direction of travel (head points forward).
        const mdx = nx - bp.x;
        const mdy = ny - bp.y;
        if (Math.hypot(mdx, mdy) > 0.8) {
          const target = (Math.atan2(mdy, mdx) * 180) / Math.PI + 90;
          let diff = target - bugAngleRef.current;
          while (diff > 180) diff -= 360;
          while (diff < -180) diff += 360;
          bugAngleRef.current += diff * ANGLE_LERP;
        }
        bugPosRef.current = { x: nx, y: ny };
      }

      const bugPos = bugPosRef.current;

      /* ── Where is the bug relative to the path? ────────────────────────── */
      const proj = projectOnPath(bugPos.x, bugPos.y, cfg, samples);

      let onPath = onPathRef.current;
      if (grabbedRef.current) {
        // Hysteresis: it takes a wider miss to fall off than to get back on.
        onPath = onPathRef.current
          ? proj.dist <= cfg.tolerance + HYSTERESIS
          : proj.dist <= cfg.tolerance;
      } else {
        onPath = true; // idle or returning bug is never "wrong"; the field stays calm
      }

      /* ── Off-path grace, then fly the bug back to the last good point ──── */
      if (grabbedRef.current && !onPath) {
        if (offSinceRef.current == null) offSinceRef.current = ts;
        if (ts - offSinceRef.current >= cfg.graceMs) {
          // Time's up: the ladybug escapes back to the furthest point reached.
          releaseBug(ts, 'offpath');
          onPath = true;                 // field calms down during the flight
        }
      } else if (onPath) {
        offSinceRef.current = null;
      }

      /* Progress only advances while the bug is on the path, and only at a
         bounded rate, so neither a shortcut across the field nor a jump between
         two distant points of the curve can complete the level.

         Outrunning that rate is now an event, not a silent freeze: hold the
         pace for OVERSPEED_GRACE_MS and the ladybug escapes back to the last
         point genuinely traced, exactly as it does when the child strays off
         the path. Before this, racing to the leaf left `tMax` behind, the
         finish condition never fired, and the game simply stopped responding
         with no explanation. */
      if (grabbedRef.current && onPath && proj.t > tMaxRef.current) {
        const maxAdvance = MAX_T_RATE * dt;
        if (proj.t - tMaxRef.current <= maxAdvance) {
          tMaxRef.current = proj.t;
          overSinceRef.current = null;
        } else {
          if (overSinceRef.current == null) overSinceRef.current = ts;
          if (ts - overSinceRef.current >= OVERSPEED_GRACE_MS) {
            overspeedsRef.current += 1;
            releaseBug(ts, 'overspeed');
            onPath = true;               // field calms down during the flight
          }
        }
      } else {
        overSinceRef.current = null;
      }

      /* ── Kinematics on the bug's own trajectory ────────────────────────── */
      if (grabbedRef.current) {
        if (lastMoveRef.current) {
          const dx = bugPos.x - lastMoveRef.current.x;
          const dy = bugPos.y - lastMoveRef.current.y;
          const dist = Math.hypot(dx, dy);
          const inst = dist / Math.max(0.001, dt);

          if (dist > 0.6) {
            const heading = Math.atan2(dy, dx);
            if (headingRef.current != null) {
              let diff = Math.abs(heading - headingRef.current);
              if (diff > Math.PI) diff = 2 * Math.PI - diff;
              if (diff > DIR_CHANGE_THRESH) dirChangesRef.current += 1;
              // Jerk proxy: heading change rate × speed.
              jerkSamplesRef.current.push((diff / Math.max(0.001, dt)) * Math.min(inst, 900) / 90);
              if (jerkSamplesRef.current.length > 600) jerkSamplesRef.current.shift();
            }
            headingRef.current = heading;
          }

          /* Pause detection with a minimum dwell so micro-stops don't count. */
          if (inst < PAUSE_SPEED_THRESH) {
            if (slowSinceRef.current == null) slowSinceRef.current = ts;
            else if (slowSinceRef.current === -1) {
              pauseMsRef.current += dtMs;
            } else if (ts - slowSinceRef.current >= PAUSE_MIN_MS) {
              pauseCountRef.current += 1;
              pauseMsRef.current += ts - slowSinceRef.current;
              slowSinceRef.current = -1; // counted; keep accumulating above
            }
          } else {
            slowSinceRef.current = null;
          }
        }
        lastMoveRef.current = { x: bugPos.x, y: bugPos.y };
      } else {
        slowSinceRef.current = null;
      }

      if (onPath !== onPathRef.current) {
        onPathRef.current = onPath;
        if (fieldRef.current) fieldRef.current.classList.toggle('lb-off-path', !onPath);
      }

      /* ── Scoring ───────────────────────────────────────────────────────── */
      if (grabbedRef.current && onPath) {
        onPathMsRef.current += dtMs;
        scoreRef.current += POINTS_PER_SECOND * dt;
        if (soundEnabled && ts - lastProgressBeep > 5000) {
          lastProgressBeep = ts;
          soundManager.playProgress();
        }
      }

      /* ── Paint ─────────────────────────────────────────────────────────── */
      paintBug();
      if (progressBugRef.current) {
        progressBugRef.current.style.left = (tMaxRef.current * 100).toFixed(2) + '%';
      }
      drawPointer(ptr, grabbedRef.current, onPath, ts);

      /* ── Throttled React sync (5 Hz) ───────────────────────────────────── */
      if (ts - lastUiPush > 200) {
        lastUiPush = ts;
        setUiScore(Math.round(scoreRef.current));
        setUiElapsed(totalMsRef.current / 1000);
        setUiProgress(tMaxRef.current);
        setUiOnPath(onPath);
      }

      /* ── Completion: full path traced AND the bug landed on the leaf ───── */
      const dToGoal = Math.hypot(bugPos.x - goal.x, bugPos.y - goal.y);
      if (tMaxRef.current >= FINISH_T && dToGoal < FINISH_DIST) {
        cancelAnimationFrame(rafRef.current);
        finishRef.current();
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [gamePhase, isPaused, cfg, samples, goal, soundEnabled, paintBug]);

  /* ═════════════════════════════════════════════════════════════════════════
     POINTER CANVAS — same visual language as TraceTypeGame's global pointer:
     a coloured ring with a glow, plus a fading motion trail.
     Amber = reaching, green = carrying on path, red = carrying off path.
     ═════════════════════════════════════════════════════════════════════════ */
  const drawPointer = useCallback((ptr, grabbed, onPath, ts) => {
    const cv = pointerCanvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    // Keep the backing store matched to the CSS size (DPR-aware).
    const rect = cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    if (!ptr) { trailRef.current = []; return; }

    const sx = (ptr.x / VW) * rect.width;
    const sy = (ptr.y / VH) * rect.height;

    // Trail buffer
    const trail = trailRef.current;
    trail.push({ x: sx, y: sy });
    if (trail.length > TRAIL_LENGTH) trail.shift();

    const base = !grabbed ? '245, 158, 11'
      : onPath ? '56, 161, 105'
      : '229, 62, 62';

    // Trail: oldest is faintest and smallest.
    for (let i = 0; i < trail.length - 1; i++) {
      const p = trail[i];
      const f = (i + 1) / trail.length;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4 + 8 * f, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${base}, ${0.05 + 0.16 * f})`;
      ctx.fill();
    }

    // Pulsing halo
    const pulse = 1 + 0.12 * Math.sin(ts / 220);
    ctx.beginPath();
    ctx.arc(sx, sy, 30 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${base}, 0.14)`;
    ctx.fill();

    ctx.shadowBlur = 22;
    ctx.shadowColor = `rgba(${base}, 0.85)`;

    ctx.beginPath();
    ctx.arc(sx, sy, 18, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${base}, 0.22)`;
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = `rgba(${base}, 0.95)`;
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
  }, []);

  /* ═════════════════════════════════════════════════════════════════════════
     COUNTDOWN
     ═════════════════════════════════════════════════════════════════════════ */
  useEffect(() => {
    if (gamePhase !== 'countdown') return;
    setCountdown(COUNTDOWN_SECONDS);
    let n = COUNTDOWN_SECONDS;
    if (soundEnabled) { soundManager.init(); soundManager.playCountdown(); }
    const id = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(id);
        if (soundEnabled) soundManager.playCountdownGo();
        // Reset every accumulator for a clean run.
        lastTsRef.current = 0;
        scoreRef.current = 0;
        onPathMsRef.current = 0;
        carryMsRef.current = 0;
        totalMsRef.current = 0;
        firstGrabAtRef.current = null;
        dropsRef.current = 0;
        overspeedsRef.current = 0;
        overSinceRef.current = null;
        lastMoveRef.current = null;
        headingRef.current = null;
        dirChangesRef.current = 0;
        pauseCountRef.current = 0;
        pauseMsRef.current = 0;
        slowSinceRef.current = null;
        jerkSamplesRef.current = [];
        trailRef.current = [];
        onPathRef.current = true;
        grabbedRef.current = false;
        tMaxRef.current = 0;
        offSinceRef.current = null;
        returningRef.current = false;
        bugPosRef.current = pathPointAt(0, cfg);
        bugAngleRef.current = 0;
        if (bugRef.current) bugRef.current.classList.remove('lb-bug-returning');
        paintBug();
        setUiGrabbed(false);
        setUiEverGrabbed(false);
        startedAtRef.current = performance.now();
        setGamePhase('playing');
      } else {
        setCountdown(n);
        if (soundEnabled) soundManager.playCountdown();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [gamePhase]);

  /* Place the bug at the path start on mount / level change. */
  useEffect(() => {
    bugPosRef.current = pathPointAt(0, cfg);
    bugAngleRef.current = 0;
    paintBug();
  }, [cfg, paintBug]);

  /* ═════════════════════════════════════════════════════════════════════════
     SESSION API
     ═════════════════════════════════════════════════════════════════════════ */
  useEffect(() => {
    if (gamePhase !== 'playing' || sessionId) return;
    const learnerId = profile?.learner_id || user?.id || '00000000-0000-0000-0000-000000000010';
    api.post('/sessions/start', {
      learner_id: learnerId,
      difficulty: level,
      game_name: 'Follow the Ladybug',
    }).then((res) => {
      const sid = res.data?.session_id;
      if (sid) { setSessionId(sid); storeStartSession(sid, learnerId, level); }
    }).catch((err) => console.warn('[LadybugGame] Could not start session:', err));
  }, [gamePhase, sessionId, level, profile, user, storeStartSession]);

  useEffect(() => {
    if (gamePhase !== 'results' || !results || !sessionId || sessionSavedRef.current) return;
    sessionSavedRef.current = true;
    const durationSeconds = Math.max(1, Math.round(results.completionSec));
    api.post('/sessions/end', {
      session_id: sessionId,
      duration_seconds: durationSeconds,
      accuracy_score: parseFloat((results.composite / 100).toFixed(2)),
      accuracy: results.composite,
      perfect_grabs: results.composite,
      total_attempts: 100,
      game_name: 'Follow the Ladybug',
      notes: JSON.stringify({
        game: 'follow-the-ladybug',
        mechanic: 'grab-and-carry',
        level,
        mode,
        score: results.score,
        pathAccuracy: results.accuracy,
        trajectorySmoothness: results.smoothness,
        speedScore: results.speedScore,
        gripScore: results.grip,
        drops: results.drops,
        overspeeds: results.overspeeds,
        performanceScore: results.composite,
        reactionTimeMs: results.reactionMs,
        carryTimeMs: results.movementMs,
        pauses: results.pauses,
        pauseDurationMs: results.pauseMs,
        directionChanges: results.directionChanges,
      }),
    }).then(() => {
      storeEndSession({
        duration: durationSeconds,
        accuracy: parseFloat((results.composite / 100).toFixed(2)),
        perfectGrabs: results.composite,
      });
    }).catch((err) => console.error('[LadybugGame] Failed to save session:', err));
  }, [gamePhase, results, sessionId, level, mode, storeEndSession]);

  /* ═════════════════════════════════════════════════════════════════════════
     CONTROLS
     ═════════════════════════════════════════════════════════════════════════ */
  const startFromRules = useCallback(() => {
    sessionStorage.setItem(RULES_FLAG, '1');
    if (soundEnabled) { soundManager.init(); soundManager.playClick(); }
    setGamePhase('countdown');
  }, [soundEnabled]);

  const togglePause = useCallback(() => {
    if (gamePhase !== 'playing') return;
    setIsPaused((p) => {
      const next = !p;
      if (next) {
        pauseStartRef.current = performance.now();
      } else {
        pausedMsRef.current += performance.now() - pauseStartRef.current;
        lastTsRef.current = 0;   // avoid a giant dt on resume
        lastMoveRef.current = null;
      }
      if (soundEnabled) soundManager.playClick();
      return next;
    });
  }, [gamePhase, soundEnabled]);

  const switchMode = useCallback(() => {
    setMode((m) => (m === 'camera' ? 'touch' : 'camera'));
    pointerRef.current = null;
    trailRef.current = [];
    lastMoveRef.current = null;
    grabbedRef.current = false;
    offSinceRef.current = null;
    setUiGrabbed(false);
    if (soundEnabled) soundManager.playClick();
  }, [soundEnabled]);

  const restart = useCallback(() => {
    sessionSavedRef.current = false;
    setSessionId(null);
    setResults(null);
    setUiScore(0); setUiElapsed(0); setUiProgress(0); setUiOnPath(true);
    setUiGrabbed(false); setUiEverGrabbed(false);
    setEscapeReason(null);
    pointerRef.current = null;
    grabbedRef.current = false;
    tMaxRef.current = 0;
    offSinceRef.current = null;
    overSinceRef.current = null;
    overspeedsRef.current = 0;
    returningRef.current = false;
    bugPosRef.current = pathPointAt(0, cfg);
    bugAngleRef.current = 0;
    if (bugRef.current) bugRef.current.classList.remove('lb-bug-returning');
    paintBug();
    if (fieldRef.current) fieldRef.current.classList.remove('lb-off-path');
    setIsPaused(false);
    setGamePhase('countdown');
  }, [cfg, paintBug]);

  const goHome = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    navigate('/play');
  }, [navigate]);

  /* Keyboard: Space/P pause, Esc home. */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') goHome();
      if ((e.key === ' ' || e.key.toLowerCase() === 'p') && gamePhase === 'playing') {
        e.preventDefault();
        togglePause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gamePhase, togglePause, goHome]);

  /* ═════════════════════════════════════════════════════════════════════════
     RENDER
     ═════════════════════════════════════════════════════════════════════════ */
  const toleranceBand = cfg.tolerance * 2;
  const showHint = gamePhase === 'playing' && !isPaused && !uiGrabbed;

  return (
    <div className="lb-page">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="lb-header">
        <div className="lb-header-left">
          <button className="lb-icon-btn lb-home-btn" onClick={goHome} title="Home" aria-label="Home">
            <Home size={20} />
          </button>
          <span className={`lb-level-chip lb-level-${level}`}>
            {cfg.emoji} {cfg.label}
          </span>
        </div>

        <div className="lb-header-center">
          <div className={`lb-stat lb-stat-score ${uiGrabbed && uiOnPath ? 'is-earning' : ''}`}>
            <Star size={18} className="lb-stat-ico" />
            <span className="lb-stat-val">{uiScore}</span>
          </div>
          <div className="lb-stat">
            <Clock size={18} className="lb-stat-ico" />
            <span className="lb-stat-val">{fmtTime(uiElapsed)}</span>
          </div>
        </div>

        <div className="lb-header-right">
          <button className="lb-icon-btn" onClick={switchMode}
            title={mode === 'camera' ? 'Switch to touch' : 'Switch to camera'}>
            {mode === 'camera' ? <Hand size={20} /> : <MousePointer2 size={20} />}
          </button>
          <button className="lb-icon-btn" onClick={() => setSoundEnabled((s) => {
            soundManager.toggle?.();
            return !s;
          })} title="Sound">
            {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
          <button className="lb-icon-btn lb-pause-btn" onClick={togglePause}
            disabled={gamePhase !== 'playing'} title="Pause">
            {isPaused ? <Play size={20} /> : <Pause size={20} />}
          </button>
        </div>
      </header>

      {/* ── Play field ─────────────────────────────────────────────────── */}
      <main className="lb-stage">
        <div
          className={`lb-field ${uiGrabbed ? 'lb-carrying' : ''}`}
          ref={fieldRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ touchAction: 'none' }}
        >
          {/* Path + tolerance band, drawn in virtual coordinates */}
          <svg className="lb-svg" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none">
            <path className="lb-band" d={pathD} strokeWidth={toleranceBand} />
            <path className="lb-path-glow" d={pathD} />
            <path className="lb-path" d={pathD} />
          </svg>

          {/* Goal leaf (undistorted HTML layer) */}
          <Leaf x={goal.x} y={goal.y} />

          {/* Pointer overlay (glow + trail) */}
          <canvas className="lb-pointer-canvas" ref={pointerCanvasRef} />

          {/* Ladybug */}
          <Ladybug ref={bugRef} />

          {/* Contextual hint under the bug */}
          <AnimatePresence>
            {showHint && (
              <motion.div
                className="lb-hint"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.25 }}
              >
                {escapeReason === 'overspeed'
                  ? 'Too fast! The ladybug flew back — go slowly 🐞'
                  : uiEverGrabbed
                    ? 'Oops! Point at the ladybug again 🐞'
                    : 'Point at the ladybug to pick it up! ☝️'}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Hidden MediaPipe plumbing */}
          <div className="lb-cam-hidden">
            <video ref={videoRef} playsInline muted />
            <canvas ref={trackCanvasRef} />
          </div>

          {/* Camera status pill */}
          {mode === 'camera' && gamePhase === 'playing' && (
            <div className={`lb-cam-status ${isTracking ? 'ok' : 'wait'}`}>
              {isSimulationMode
                ? 'Simulation mode'
                : isTracking ? 'Hand detected' : 'Show your hand ✋'}
            </div>
          )}
        </div>

        {/* ── Progress bar ────────────────────────────────────────────── */}
        <div className="lb-progress">
          <div className="lb-progress-track">
            <div className="lb-progress-fill" style={{ width: `${uiProgress * 100}%` }} />
            <div className="lb-progress-bug" ref={progressBugRef}>
              <MiniBug />
            </div>
            <span className="lb-progress-goal" aria-label="Goal">
              <svg viewBox="-50 -66 66 68" width="20" height="20">
                <path d="M4 -4 C -34 -12 -46 -44 -22 -60 C 6 -74 34 -52 32 -22 C 31 -8 18 -2 4 -4 Z"
                  fill="#3FA34D" stroke="#2F7F3C" strokeWidth="3" />
                <path d="M4 -6 C -6 -18 -14 -34 -20 -52"
                  stroke="#2F7F3C" strokeWidth="2.5" fill="none" opacity="0.8" />
              </svg>
            </span>
          </div>
        </div>
      </main>

      {/* ═══ OVERLAYS ═══════════════════════════════════════════════════ */}
      <AnimatePresence>
        {gamePhase === 'rules' && (
          <RulesModal key="rules" level={level} mode={mode} onStart={startFromRules} />
        )}

        {gamePhase === 'countdown' && (
          <motion.div key="cd" className="lb-overlay lb-overlay-soft"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div
              key={countdown}
              className="lb-countdown"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 18 }}
            >
              {countdown}
            </motion.div>
            <p className="lb-countdown-hint">Get ready to catch the ladybug…</p>
          </motion.div>
        )}

        {isPaused && gamePhase === 'playing' && (
          <motion.div key="pause" className="lb-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="lb-pause-card"
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}>
              <div className="lb-pause-ico"><Pause size={38} /></div>
              <h2>Paused</h2>
              <p>Take a breath — the ladybug is waiting 🐞</p>
              <div className="lb-pause-actions">
                <button className="lb-btn lb-btn-primary" onClick={togglePause}>
                  <Play size={18} /> Resume
                </button>
                <button className="lb-btn lb-btn-ghost" onClick={restart}>
                  <RotateCcw size={18} /> Restart
                </button>
                <button className="lb-btn lb-btn-ghost" onClick={goHome}>
                  <Home size={18} /> Home
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {gamePhase === 'results' && results && (
          <motion.div key="res" className="lb-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <motion.div className="lb-results-card"
              initial={{ scale: 0.86, y: 40, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 220, damping: 24 }}
            >
              <div className="lb-results-confetti" aria-hidden="true">
                {Array.from({ length: 14 }).map((_, i) => (
                  <span key={i} style={{ '--i': i }} />
                ))}
              </div>

              <h2 className="lb-results-title">
                <CheckCircle size={26} /> Level complete!
              </h2>
              <p className="lb-results-sub">
                {cfg.emoji} {cfg.label} · {mode === 'camera' ? 'Camera' : 'Touch'}
              </p>

              <div className="lb-perf-ring" style={{ '--pct': results.composite }}>
                <div className="lb-perf-inner">
                  <span className="lb-perf-val">{results.composite}</span>
                  <span className="lb-perf-lbl">OT Score</span>
                </div>
              </div>

              <div className="lb-metrics">
                <Metric icon={<Star size={16} />}       label="Score"             value={results.score} />
                <Metric icon={<Target size={16} />}     label="Path Accuracy"     value={`${results.accuracy}%`} />
                <Metric icon={<Activity size={16} />}   label="Smoothness"        value={`${results.smoothness}%`} />
                <Metric icon={<Hand size={16} />}       label="Grip"              value={`${results.grip}%`} />
                <Metric icon={<MousePointer2 size={16} />} label="Drops"          value={results.drops} />
                <Metric icon={<Zap size={16} />}        label="Reaction Time"
                  value={results.reactionMs == null ? '—' : `${(results.reactionMs / 1000).toFixed(2)}s`} />
                <Metric icon={<Clock size={16} />}      label="Completion Time"   value={fmtTime(results.completionSec)} />
                <Metric icon={<Pause size={16} />}      label="Pauses"
                  value={`${results.pauses} · ${(results.pauseMs / 1000).toFixed(1)}s`} />
                <Metric icon={<RotateCcw size={16} />}  label="Direction Changes" value={results.directionChanges} />
                <Metric icon={<TrendingUp size={16} />} label="Speed Score"       value={`${results.speedScore}%`} />
              </div>

              <div className="lb-results-actions">
                <button className="lb-btn lb-btn-primary" onClick={restart}>
                  <RotateCcw size={18} /> Play again
                </button>
                <button className="lb-btn lb-btn-ghost"
                  onClick={() => navigate('/play/ladybug-difficulty')}>
                  Levels
                </button>
                <button className="lb-btn lb-btn-ghost" onClick={goHome}>
                  <Home size={18} /> Home
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Small presentational helper ────────────────────────────────────────── */
function Metric({ icon, label, value }) {
  return (
    <div className="lb-metric">
      <div className="lb-metric-ico">{icon}</div>
      <div className="lb-metric-body">
        <span className="lb-metric-label">{label}</span>
        <span className="lb-metric-value">{value}</span>
      </div>
    </div>
  );
}
