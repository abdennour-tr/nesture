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
 * landmark 8, x mirrored, speed-adaptive smoothing, glow + fading trail.
 *
 * Route: /play/ladybug-game?level=easy|medium|hard&mode=camera|touch
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {Home, Pause, Play, RotateCcw, Clock, Star, Hand, MousePointer2, Volume2, VolumeX, HelpCircle} from 'lucide-react';
import useHandTracking from '../hooks/useHandTracking';
import { soundManager } from '../utils/soundManager';
import useSoundEnabled from '../hooks/useSoundEnabled';
import GameRules from '../components/game/GameRules';
import EndGameControl from '../components/game/EndGameControl';
import { useAuthStore, useSessionStore } from '../store';
import api from '../services/api';
import '../styles/LadybugGame.css';
/* NOTE: GameShell.css is NOT imported here on purpose. It is already pulled in
   by GameRules / EndGameControl above, and an ES module is evaluated once at
   its FIRST import — so a later import would be a no-op and could not change
   the CSS order. The shared game frame wins by SPECIFICITY instead: see
   section 11 of GameShell.css. */

import { HandDefs, HandArt, followHand, makeHandState } from '../components/game/HandPointer';
import { createHandPointerFilter, handDepthScale, STABLE_POINTER_OPTIONS } from '../utils/handPointerFilter';
import {otComposite, otRound, FINISH} from '../utils/otScore';
import GameResults from '../components/game/GameResults';
import TouchModePose from '../components/game/TouchModePose';
import CameraLandmarks from '../components/game/CameraLandmarks';
import HandGate, { useHandGate, firstPhaseFor } from '../components/game/HandGate';
import useGraspMeasure from '../hooks/useGraspMeasure';
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
/* Touch and mouse only. Camera samples use the shared speed-adaptive filter. */
const EMA_ALPHA          = 0.35;  // pointer smoothing (touch/mouse input)
const TRACKING_HOLD_MS   = 180;   // visual grace only; missing samples never score
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

/* `resume` = opened from the in-game "How to play" button rather than shown
   automatically before the first round, so the primary button returns to the
   game instead of starting one. */
/* Thin wrapper over the shared rules card — see GameRules.jsx. */
function RulesModal({ level, mode, onStart, resume = false }) {
  return (
    <GameRules
      emoji="🐞"
      title="Follow the Ladybug"
      subtitle={`${LEVELS[level].emoji} ${LEVELS[level].label} · ${mode === 'camera' ? 'Camera mode' : 'Touch mode'}`}
      rules={RULES}
      onStart={onStart}
      resume={resume}
      startLabel={resume ? 'Back to the game' : "Let's go! 🐞"}
    />
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
  /* Shared app-wide sound state — the icon always matches what you hear. */
  const [soundEnabled, setSoundEnabled] = useSoundEnabled();

  /* ── Phases: rules → countdown → playing → results ── */
  const [gamePhase, setGamePhase] = useState(() =>
    sessionStorage.getItem(RULES_FLAG) ? firstPhaseFor(mode) : 'rules'
  );
  const [isPaused, setIsPaused] = useState(false);
  /* True while the end-game confirmation is on screen. The round is paused
     then, but the PAUSE CARD must stay hidden so only one card shows. */
  const [endAsking, setEndAsking] = useState(false);
  const [showHelp, setShowHelp] = useState(false);   // "How to play", re-openable mid-game
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

  /* ── Hand pointer ─────────────────────────────────────────────────────────
     The same hand as the other gesture games. Tracking writes where the hand
     is into `handTargetRef`; the loop below eases the drawn pointer towards it
     and writes the transform onto the node, so the pointer keeps up with the
     camera without re-rendering the board. Coordinates are CSS pixels of the
     field: the field stretches the 1000x560 virtual space by a different
     factor on each axis, and the hand must not stretch with it.
     Grab / on-path / off-path feedback stays on the canvas halo and trail
     underneath, which already change colour with the state. */
  const handGroupRef  = useRef(null);
  /* Camera pointer conditioning — see src/utils/handPointerFilter.js. */
  const handFilterRef = useRef(null);
  if (!handFilterRef.current) {
    handFilterRef.current = createHandPointerFilter(STABLE_POINTER_OPTIONS);
  }
  const cameraInputRef = useRef({ at: 0, processedAt: -1, accepted: false, key: null });
  const handTargetRef = useRef({ ...makeHandState(0.6), vx: 0, vy: 0, depth: 1 })   // no dirX/dirY: the pointer never rotates;
  const handShownRef  = useRef(makeHandState(0.6));
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
  const trackingEnabled = mode === 'camera'
    && (gamePhase === 'waiting' || gamePhase === 'countdown' || gamePhase === 'playing');

  const { landmarks, trackingTimestamp, activeHandKey, isTracking, isSimulationMode, releaseCamera } = useHandTracking(
    videoRef, trackCanvasRef, trackingEnabled, isPaused, 2,
    { stableSelection: true }
  );

  /* Palmar grasp is the one reflex this game's sensors can honestly measure:
     the task needs a sustained pointing finger, so a hand pulling closed is
     unwanted rather than instructed. See hooks/useGraspMeasure.js. */
  const graspRef = useRef(null);
  const grasp = useGraspMeasure();
  graspRef.current = grasp;

  /* ── Turn the camera off when the round ends ────────────────────────────
     Client feedback: "when the game finish the camera need to turn off."

     `trackingEnabled` already goes false on the results screen, and the hook's
     cleanup now stops the MediaStream tracks (MediaPipe's own `Camera.stop()`
     does not, which is why the webcam light stayed on). This call is the
     explicit belt-and-braces version so the camera is released the instant the
     round ends, on every exit path. */
  useEffect(() => {
    if (gamePhase === 'results') releaseCamera();
  }, [gamePhase, releaseCamera]);

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

  /** Feed a sample in. `preFiltered` samples (the camera pointer, which has
      already been through handPointerFilter) skip the EMA — smoothing an
      already-smoothed signal only adds lag back. */
  const pushPointer = useCallback((pt, preFiltered = false) => {
    if (!pt) return;
    const prev = pointerRef.current;
    if (!prev || preFiltered) {
      pointerRef.current = { x: pt.x, y: pt.y };
    } else {
      pointerRef.current = {
        x: prev.x + (pt.x - prev.x) * EMA_ALPHA,
        y: prev.y + (pt.y - prev.y) * EMA_ALPHA,
      };
    }
    // the hand follows the same smoothed point the game aims with
    const h = handTargetRef.current;
    h.vx = pointerRef.current.x;
    h.vy = pointerRef.current.y;
    h.on = 1;
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

  /* Discrete transitions discard old motion before accepting a fresh sample. */
  useEffect(() => {
    pointerRef.current = null;
    cameraInputRef.current = { at: 0, processedAt: -1, accepted: false, key: null };
    handFilterRef.current.reset();
    handTargetRef.current.on = 0;
    handShownRef.current.on = 0;
    trailRef.current = [];
  }, [mode, isPlaying]);

  /* Camera samples condition the target once. Rendering and hit testing both
     use the same interpolated fingertip in the animation loop below. */
  useEffect(() => {
    if (mode !== 'camera' || !isPlaying) return;
    const input = cameraInputRef.current;
    if (input.processedAt === trackingTimestamp) return;
    input.processedAt = trackingTimestamp;
    if (!landmarks || performance.now() - trackingTimestamp > TRACKING_HOLD_MS) {
      input.accepted = false;
      pointerRef.current = null;
      handFilterRef.current.lost();
      return;
    }
    if (input.key !== activeHandKey) {
      handFilterRef.current.reset();
      handShownRef.current.on = 0;
      pointerRef.current = null;
      trailRef.current = [];
      input.key = activeHandKey;
    }
    graspRef.current.push(landmarks, trackingTimestamp, null);
    const p = handFilterRef.current.push(landmarks, trackingTimestamp);
    input.accepted = !!p && p.accepted !== false;
    if (!input.accepted) pointerRef.current = null;
    if (!p) return;
    input.at = trackingTimestamp;
    const h = handTargetRef.current;
    h.vx = p.x * VW;
    h.vy = p.y * VH;
    h.depth = handDepthScale(p.span);
    if (p.reacquired) {
      handShownRef.current.on = 0;
      trailRef.current = [];
      lastMoveRef.current = null;
      headingRef.current = null;
    }
  }, [landmarks, trackingTimestamp, activeHandKey, mode, isPlaying]);

  /* Follow loop: virtual units -> field pixels. Camera hit testing follows
     the drawn hotspot, with no second position filter or stale interaction. */
  useEffect(() => {
    let raf = 0;
    const tick = (ts) => {
      const el = fieldRef.current;
      const node = handGroupRef.current;
      const h = handTargetRef.current;
      const input = cameraInputRef.current;
      const fresh = isPlaying && input.at > 0 && ts - input.at <= TRACKING_HOLD_MS;
      if (mode === 'camera') {
        h.on = fresh ? 1 : 0;
        if (!fresh || !input.accepted) pointerRef.current = null;
      }
      if (el && node) {
        const r = el.getBoundingClientRect();
        const kx = r.width / VW;
        const ky = r.height / VH;
        h.x = h.vx * kx;
        h.y = h.vy * ky;
        h.scale = (r.height / VH) * 0.6 * h.depth;
        const shown = followHand(h, handShownRef.current, node, ts);
        if (mode === 'camera' && fresh && input.accepted && kx > 0 && ky > 0) {
          pointerRef.current = { x: shown.x / kx, y: shown.y / ky };
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, isPlaying]);

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
  /* @param {string} reason  FINISH.COMPLETE when the ladybug reached the leaf,
     FINISH.ENDED when the learner pressed "End game". Only the report's title
     and the `endedEarly` flag depend on it — the metrics are the same either
     way, computed from whatever actually happened. */
  const finishGame = useCallback((reason = FINISH.COMPLETE) => {
    cancelAnimationFrame(rafRef.current);

    /* EVERY SUB-SCORE IS `null` WHEN IT HAS NO DATA — see src/utils/otScore.js.
       These used to default high on an empty round: no jerk samples meant zero
       jerk (smoothness 100), totalMs floored to 1ms beat any reference time
       (speed 100), and no drops meant a perfect grip (100). Ending the round
       before touching the ladybug therefore reported OT 60 beside "0 score,
       0% path accuracy". Never having held it is not a perfect grip. */
    const everGrabbed = firstGrabAtRef.current != null;
    const carriedMs = carryMsRef.current;

    // Path accuracy — only means something once the bug has been carried.
    const accuracy = carriedMs > 0
      ? clamp01(onPathMsRef.current / carriedMs) * 100
      : null;

    // Smoothness: low mean jerk → high score, against a generous cap.
    const jerks = jerkSamplesRef.current;
    const smoothness = jerks.length
      ? clamp01(1 - (jerks.reduce((a, b) => a + b, 0) / jerks.length) / 2600) * 100
      : null;

    // Speed: against a per-level reference time. Meaningless if the run never
    // started — a zero-length round would otherwise "beat" every reference.
    const totalMs = totalMsRef.current;
    const speedScore = (everGrabbed && totalMs > 0)
      ? clamp01(cfg.refTimeMs / totalMs) * 100
      : null;

    // Grip: how well the child kept hold. Undefined if they never took hold.
    const grip = everGrabbed ? clamp01(1 - dropsRef.current / 6) * 100 : null;

    const composite = otComposite([
      [accuracy,   0.40],
      [smoothness, 0.25],
      [speedScore, 0.20],
      [grip,       0.15],
    ]);

    const reactionMs = firstGrabAtRef.current == null
      ? null
      : firstGrabAtRef.current - startedAtRef.current;

    const payload = {
      endedEarly: reason === FINISH.ENDED,
      score: Math.round(scoreRef.current),
      grasp: graspRef.current.result(),
      accuracy: otRound(accuracy),
      smoothness: otRound(smoothness),
      speedScore: otRound(speedScore),
      grip: otRound(grip),
      drops: dropsRef.current,
      overspeeds: overspeedsRef.current,
      composite,
      reactionMs: reactionMs == null ? null : Math.round(reactionMs),
      movementMs: Math.round(carriedMs),
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

      /* A lost tracking frame holds the artwork briefly but cannot carry,
         earn points, or count as a movement correction. */
      if (!ptr) {
        lastMoveRef.current = null;
        headingRef.current = null;
        slowSinceRef.current = null;
        if (offSinceRef.current != null) offSinceRef.current += dtMs;
      }

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
        const carryAlpha = 1 - Math.pow(1 - BUG_LERP, dtMs / (1000 / 60));
        const nx = bp.x + (ptr.x - bp.x) * carryAlpha;
        const ny = bp.y + (ptr.y - bp.y) * carryAlpha;

        // Orient the bug along its own direction of travel (head points forward).
        const mdx = nx - bp.x;
        const mdy = ny - bp.y;
        if (Math.hypot(mdx, mdy) > 0.8) {
          const target = (Math.atan2(mdy, mdx) * 180) / Math.PI + 90;
          let diff = target - bugAngleRef.current;
          while (diff > 180) diff -= 360;
          while (diff < -180) diff += 360;
          bugAngleRef.current += diff * (1 - Math.pow(1 - ANGLE_LERP, dtMs / (1000 / 60)));
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
      if (grabbedRef.current && ptr && !onPath) {
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
      if (grabbedRef.current && ptr && onPath && proj.t > tMaxRef.current) {
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
      if (grabbedRef.current && ptr) {
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
      if (grabbedRef.current && ptr && onPath) {
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
      if (ptr && tMaxRef.current >= FINISH_T && dToGoal < FINISH_DIST) {
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

    /* The ring and the centre dot used to be drawn here. The hand pointer (an
       SVG layer above this canvas) is the cursor now; the halo and the trail
       stay, because they are what carries the grab / on-path / off-path
       colour. */
  }, []);

  /* ═════════════════════════════════════════════════════════════════════════
     COUNTDOWN
     ═════════════════════════════════════════════════════════════════════════ */
  /* ── Countdown ─────────────────────────────────────────────────────────
     Client feedback: "Occasionally, the counter becomes stuck."

     Two causes, both removed here:

     1. The old effect ran a `setInterval` and listed `soundEnabled` in its
        dependency array. Toggling sound — or any re-render that changed one of
        those identities — tore the interval down and restarted the countdown
        from 3. Repeat that and it never reaches 0. This effect now depends
        ONLY on `gamePhase`; everything else is read through an always-current
        ref.

     2. `setInterval` counts ticks, so a throttled tab or a dropped frame under
        camera load simply loses ticks and the number stops moving. The
        countdown is now DEADLINE-based: remaining seconds are computed from
        the clock each frame, so it self-corrects after any stall.

     A belt-and-braces timeout guarantees the overlay can never be left on
     screen forever, even if requestAnimationFrame never runs again. */
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  const beginRunRef = useRef(null);
  beginRunRef.current = () => {
    if (soundEnabledRef.current) soundManager.playCountdownGo();
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
  };

  useEffect(() => {
    if (gamePhase !== 'countdown') return;

    setCountdown(COUNTDOWN_SECONDS);
    if (soundEnabledRef.current) { soundManager.init(); soundManager.playCountdown(); }

    const deadline = Date.now() + COUNTDOWN_SECONDS * 1000;
    let shown = COUNTDOWN_SECONDS;
    let finished = false;
    let raf = 0;

    const finish = () => {
      if (finished) return;
      finished = true;
      beginRunRef.current?.();
    };

    const tick = () => {
      if (finished) return;
      const left = Math.ceil((deadline - Date.now()) / 1000);
      if (left <= 0) { finish(); return; }
      if (left !== shown) {
        shown = left;
        setCountdown(left);
        if (soundEnabledRef.current) soundManager.playCountdown();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    /* rAF is paused entirely while the tab is hidden. This timer still fires on
       return and ends the countdown, so it can never strand the learner. */
    const safety = setTimeout(finish, COUNTDOWN_SECONDS * 1000 + 1500);

    return () => {
      finished = true;
      cancelAnimationFrame(raf);
      clearTimeout(safety);
    };
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
  /* ── Hand gate (camera mode) ─────────────────────────────────────────
     Client feedback: the "Show one of your hands" screen existed only in
     Trace → Find → Type. Without it the 3-2-1 and the round clock started
     with nobody in front of the camera. The round now waits in 'waiting'
     until a hand is detected, then runs the normal countdown. See
     components/game/HandGate.jsx. */
  const openHandGate = useCallback(() => setGamePhase('countdown'), []);
  useHandGate({
    phase: gamePhase, landmarks, isSimulationMode,
    bypass: mode !== 'camera', onHand: openHandGate,
  });

  const startFromRules = useCallback(() => {
    sessionStorage.setItem(RULES_FLAG, '1');
    if (soundEnabled) { soundManager.init(); soundManager.playClick(); }
    setGamePhase(firstPhaseFor(mode));
  }, [soundEnabled, mode]);

  /* ── "How to play", available DURING the game ───────────────────────────
     Client feedback: "there should be an optional provision for user to see
     [the instructions] again if they wish to." The rules are shown once
     automatically on the first visit; this button brings the exact same modal
     back at any point, and pauses the round while it is open. */
  const openHelp = useCallback(() => {
    if (gamePhase === 'playing') setIsPaused(true);
    setShowHelp(true);
  }, [gamePhase]);

  const closeHelp = useCallback(() => {
    setShowHelp(false);
    if (gamePhase === 'playing') setIsPaused(false);
  }, [gamePhase]);

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
    setGamePhase(firstPhaseFor(mode));
  }, [cfg, paintBug, mode]);

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
          {/* End the round early and go straight to the report — the same
              control LetterQuest has. It runs the game's normal finish
              routine, so the report is built exactly as it is at the end of a
              full round, from whatever has been done so far. */}
          <EndGameControl
            className="lb-icon-btn gs-end-btn"
            compact
            disabled={gamePhase !== 'playing'}
            onAskingChange={(asking) => { setEndAsking(asking); setIsPaused(asking); }}
            onConfirm={() => { setIsPaused(false); finishRef.current?.('ended'); }}
          />
          <button className="lb-icon-btn" onClick={openHelp}
            title="How to play" aria-label="How to play">
            <HelpCircle size={20} />
          </button>
          <button className="lb-icon-btn" onClick={switchMode}
            title={mode === 'camera' ? 'Switch to touch' : 'Switch to camera'}>
            {mode === 'camera' ? <Hand size={20} /> : <MousePointer2 size={20} />}
          </button>
          <button className="lb-icon-btn" onClick={() => setSoundEnabled((s) => !s)} title="Sound">
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

          {/* Hand pointer. Its transform is written by the loop above, so this
              layer never re-renders while the hand moves. */}
          <svg className="lb-hand-layer" aria-hidden="true">
            <HandDefs theme="green" />
            <g ref={handGroupRef} className="lb-hand-pointer">
              {/* the garden is bright, so the hand gets its dark backing */}
              <HandArt contrast />
            </g>
          </svg>

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

          {/* Camera + hand-landmarks preview (styled, top-left) in camera mode;
              the same video/canvas stay hidden in touch mode where no camera runs. */}
          {mode === 'camera' ? (
            <CameraLandmarks videoRef={videoRef} canvasRef={trackCanvasRef} detected={isTracking} />
          ) : (
            <div className="lb-cam-hidden">
              <video ref={videoRef} playsInline muted />
              <canvas ref={trackCanvasRef} />
            </div>
          )}

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

      {/* Touch-mode upper-body observation. Nothing starts until the child is
          asked; the webcam is released the moment the round ends. Renders its
          own hidden <video> and consent overlay — see TouchModePose. */}
      <TouchModePose
        gameId="ladybug"
        active={mode === 'touch' && (gamePhase === 'countdown' || gamePhase === 'playing')}
        finished={gamePhase === 'results'}
        sessionId={sessionId}
        childId={profile?.learner_id || user?.id || null}
        learnerName={profile?.first_name}
      />

      {/* ═══ OVERLAYS ═══════════════════════════════════════════════════ */}
      <AnimatePresence>
        {gamePhase === 'rules' && (
          <RulesModal key="rules" level={level} mode={mode} onStart={startFromRules} />
        )}

        {/* Same modal, reopened on demand from the header's "?" button. */}
        {showHelp && gamePhase !== 'rules' && (
          <RulesModal key="help" level={level} mode={mode} onStart={closeHelp} resume />
        )}

        <HandGate
          key="hand-gate"
          visible={gamePhase === 'waiting'}
          isTracking={isTracking}
          onUseTouch={switchMode}
          onExit={goHome}
        />

        {gamePhase === 'countdown' && (
          <motion.div key="cd" className="lb-overlay lb-overlay-soft lb-overlay-center"
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

        {/* `!endAsking`: the end-game dialog pauses the round too, and without
            this the pause card rendered underneath it — two cards at once. */}
        {isPaused && !endAsking && gamePhase === 'playing' && (
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
          <motion.div key="res" className="lb-overlay lb-overlay-report"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {/* Shared platform report — this game's own numbers, the platform's
                shape and reflex framing. See components/game/GameResults.jsx. */}
            <GameResults
              gameId="ladybug"
              reflexMeasurements={results.grasp && results.grasp.measured
                ? { 'Palmar Grasp': { reflex_key: 'Palmar Grasp', reflex_name: 'Palmar Grasp Reflex', ...results.grasp } }
                : null}
              emoji={results.endedEarly ? '💪' : '🏆'}
              title={results.endedEarly ? 'Session ended' : 'Level complete!'}
              subtitle={`${cfg.emoji} ${cfg.label} · ${mode === 'camera' ? 'Camera' : 'Touch'}`}
              endedEarly={results.endedEarly}
              headline={{ value: results.composite, caption: 'OT Score' }}
              breakdown={[
                { label: 'Path accuracy',    value: results.accuracy,   weight: '40%' },
                { label: 'Smoothness',       value: results.smoothness, weight: '25%' },
                { label: 'Speed',            value: results.speedScore, weight: '20%' },
                { label: 'Grip consistency', value: results.grip,       weight: '15%' },
              ]}
              metrics={[
                { icon: '🏆', label: 'Score', value: results.score },
                { icon: '⚡', label: 'Reaction', value: results.reactionMs == null ? '—' : `${(results.reactionMs / 1000).toFixed(2)}s` },
                { icon: '🔄', label: 'Direction changes', value: results.directionChanges },
                { icon: '✋', label: 'Drops', value: results.drops },
                { icon: '⏸️', label: 'Pauses', value: `${results.pauses} · ${(results.pauseMs / 1000).toFixed(1)}s` },
                { icon: '⏱️', label: 'Time', value: fmtTime(results.completionSec) },
              ]}
              onPlayAgain={restart}
              onExit={goHome}
              exitLabel="Home"
              actionsExtra={(
                <button type="button" className="gr-btn gr-btn-secondary"
                  onClick={() => navigate('/play/ladybug-difficulty')}>
                  Levels
                </button>
              )}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

