import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { LogOut, Settings, X, Volume2, VolumeX, Pause, Play, Lock, Unlock, Home, Hand, Video } from 'lucide-react';
import { useSessionStore, useAuthStore } from '../store';
import useTextToSpeech from '../hooks/useTextToSpeech';
import useMediaPipeTracking, { LANDMARKS, calculateSmoothness } from '../hooks/useMediaPipeTracking';
import { useReflexEngine } from '../hooks/useReflexEngine';
import CalibrationScreen from './CalibrationScreen';
import TouchModePose from '../components/game/TouchModePose';
import { soundManager } from '../utils/soundManager';
import api from '../services/api';
import { supabase } from '../services/supabaseClient';
import '../styles/GamePage.css';

// ── Constants ─────────────────────────────────────────────────────────────────
/* ONE source of truth for the dwell time. It used to be declared here as 2500,
   never read, and hard-coded as 2000 inside the RAF loop — while the on-screen
   hint and the "how to play" card both promised 2.5 s. The child was being told
   one number and measured against another, and a therapist reading the session
   report had no way to know which. Everything below now reads these values. */
const DWELL_MS = 2000;               // default hold-to-confirm
/* Slower for the youngest / most affected children, quicker once the gesture is
   established: the hold time is a therapeutic parameter, not a UI detail. */
const DWELL_BY_DIFFICULTY = {
  easy: 2400,
  medium: 2000,
  complex_words: 1700,
  complex_sentences: 1500,
  self_expression: 1400,
};
const DOT_R = 4;                  // precision core dot radius
const INNER_R = 11;                 // static inner ring radius
const RING_R = 24;                 // outer progress ring radius
const TICK_LEN = 5;                  // crosshair tick length
const RING_CIRC = 2 * Math.PI * RING_R;
const CANVAS = (RING_R + 14) * 2; // SVG canvas = 76 px

// ── Full QWERTY layout (used as letter source) ──────────────────────────────
const ALL_LETTERS = 'QWERTYUIOPASDFGHJKLZXCVBNM'.split('');
const QWERTY_LAYOUT = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
];

// ── Word banks — PRD v4.0: 5 difficulty modes ────────────────────────────────
const WORD_PROMPTS = {
  easy: ['CAT', 'SUN', 'DOG', 'HAT', 'BUS', 'CUP', 'BOX', 'FAN', 'MAP', 'BED', 'PEN', 'RUN', 'HOP', 'JOY', 'HUG'],
  medium: ['BREAD', 'LIGHT', 'PLANT', 'MUSIC', 'WATER', 'APPLE', 'HOUSE', 'TRAIN', 'CHAIR', 'CLOUD', 'DREAM', 'STONE'],
  complex_words: ['JOURNEY', 'SCIENCE', 'FREEDOM', 'BALANCE', 'DOLPHIN', 'KINGDOM', 'MONSTER', 'VOLCANO', 'PUZZLES', 'LIBRARY'],
  complex_sentences: ['I WANT TO GO', 'HE IS MY FRIEND', 'I LOVE YOU', 'PLAY WITH ME', 'HELP ME PLEASE', 'I AM HAPPY', 'THANK YOU'],
  // self_expression has no prompts — free text mode
};

const WORD_IMAGES = {
  CAT: '🐱', SUN: '☀️', DOG: '🐶', HAT: '🎩', BUS: '🚌', CUP: '☕', BOX: '📦', FAN: '🌀', MAP: '🗺️', BED: '🛏️', PEN: '🖊️', RUN: '🏃', HOP: '🐰', JOY: '😊', HUG: '🤗',
  BREAD: '🍞', LIGHT: '💡', PLANT: '🌿', MUSIC: '🎵', WATER: '💧', APPLE: '🍎', HOUSE: '🏠', TRAIN: '🚆', CHAIR: '🪑', CLOUD: '☁️', DREAM: '💭', STONE: '🪨',
  JOURNEY: '🧭', SCIENCE: '🔬', FREEDOM: '🗽', BALANCE: '⚖️', DOLPHIN: '🐬', KINGDOM: '👑', MONSTER: '👾', VOLCANO: '🌋', PUZZLES: '🧩', LIBRARY: '📚',
  'I WANT TO GO': '🚶', 'HE IS MY FRIEND': '🤝', 'I LOVE YOU': '❤️', 'PLAY WITH ME': '🎮', 'HELP ME PLEASE': '🙏', 'I AM HAPPY': '😄', 'THANK YOU': '🙏',
};

// ── Dynamic keyboard builder ─────────────────────────────────────────────────
// PRD rule: visible keys always include ALL letters from the target word/phrase,
// plus random distractor letters to fill up to the keyboard size limit.
// The board rebuilds whenever the word or keyboard size changes.
function buildDynamicKeyboard(targetText, visibleKeyCount) {
  // If 26 keys → return full QWERTY + backspace
  if (visibleKeyCount >= 26) {
    return [
      ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
      ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
      ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '⌫'],
    ];
  }

  // Extract unique letters needed from the target
  const neededLetters = [...new Set(
    (targetText || '').toUpperCase().replace(/[^A-Z]/g, '').split('')
  )];

  // Calculate distractor count
  const distractorCount = Math.max(0, visibleKeyCount - neededLetters.length);

  // Pick random distractors from remaining alphabet
  const remaining = ALL_LETTERS.filter(l => !neededLetters.includes(l));
  const shuffled = remaining.sort(() => Math.random() - 0.5);
  const distractors = shuffled.slice(0, distractorCount);

  // Combine and sort by QWERTY order for natural feel
  const allVisible = [...neededLetters, ...distractors];
  const qwertyOrder = ALL_LETTERS;
  allVisible.sort((a, b) => qwertyOrder.indexOf(a) - qwertyOrder.indexOf(b));

  // Split into rows based on count
  if (visibleKeyCount <= 8) {
    // 2 rows of 4
    const row1 = allVisible.slice(0, 4);
    const row2 = [...allVisible.slice(4), '⌫'];
    return [row1, row2];
  } else {
    // 12 keys → 3 rows: 5 / 4 / 3+backspace
    const row1 = allVisible.slice(0, 5);
    const row2 = allVisible.slice(5, 9);
    const row3 = [...allVisible.slice(9), '⌫'];
    return [row1, row2, row3];
  }
}

// ── Keyboard size → visible key count ────────────────────────────────────────
const KB_VISIBLE_KEYS = { big: 8, medium: 12, standard: 26 };

const ENCOURAGEMENTS = ['Awesome! 🌟', 'Great job! 🎉', 'Amazing! ✨', 'Champion! 🏆', 'Perfect! ⭐'];
const TARGET_WORDS = 5;

const DIFFICULTY_LABELS = {
  easy: 'Easy',
  medium: 'Medium',
  complex_words: 'Complex words',
  complex_sentences: 'Phrases',
  self_expression: 'Self expression',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ── Clinical metrics ──────────────────────────────────────────────────────
   The previous version of this function produced five numbers that all looked
   plausible in the UI and in the parent/specialist reports, and not one of them
   measured what its name claimed:

   • response_time_ms was `now - dwellStart`. The dwell is a fixed hold, so this
     was the hold duration — a constant — dressed up as a reaction time.
   • trajectory_smoothness was computed on the last 15 samples, i.e. the half
     second the hand spent DELIBERATELY MOTIONLESS on the key. It measured how
     still a child can hold, never how smoothly they reached.
   • midline_crossing tested x against 0.5 — the middle of the camera frame,
     which depends on how the laptop happens to be aimed, not on the child's
     body midline. On the same half-second of stillness, it was almost always
     false regardless.
   • head_hand_coupling used only the vertical range of the HAND. No head data
     entered the calculation at all, despite headPose being available.
   • fatigue_indicator was a function of the two constants above, so it was
     itself near-constant.

   They are now computed over the reach itself: the window from the moment the
   target letter became current to the moment the finger settled on a key. */
function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 4) return null;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

/**
 * @param reach      samples {x,y,t,headYaw,headPitch,noseX} captured from the
 *                   moment the target became current until the dwell started.
 * @param timings    { targetShownAt, dwellEnteredAt, dwellMs }
 * @param isCorrect  whether the selected letter matched the target
 * @param history    previous gestures in this session, for the fatigue baseline
 */
function computeRealGestureMetrics(reach, timings, isCorrect, history) {
  const { targetShownAt, dwellEnteredAt, dwellMs } = timings;

  /* The real thing: how long from "this letter is now the target" to "the
     finger has arrived". The hold itself is reported separately so a therapist
     can see both, and so changing the hold time does not silently change what
     looks like a reaction time. */
  /* Compared against null, not truthiness: a timestamp of 0 is a real one, and
     testing it as a boolean silently drops the measurement. */
  const response_time_ms = (targetShownAt != null && dwellEnteredAt != null && dwellEnteredAt > targetShownAt)
    ? dwellEnteredAt - targetShownAt
    : null;

  /* Smoothness of the REACH. Samples where the hand had already stopped are
     excluded, so this is jerk during movement rather than tremor at rest. */
  const moving = [];
  for (let i = 1; i < reach.length; i++) {
    const d = Math.hypot(reach[i].x - reach[i - 1].x, reach[i].y - reach[i - 1].y);
    if (d > 0.002) moving.push(reach[i]);
  }
  const trajectory_smoothness = moving.length >= 4 ? calculateSmoothness(moving) : null;

  /* Midline referenced to the BODY (nose x), not to the middle of whatever the
     camera happens to be pointing at. Null when no face was seen, so a report
     can say "not measured" instead of "no crossing". */
  const noseSamples = reach.filter(p => typeof p.noseX === 'number');
  let midline_crossing = null;
  if (noseSamples.length >= 4) {
    /* Hand x is mirrored for display; the nose comes from the same mirrored
       frame, so both are compared in the same space. */
    const rel = noseSamples.map(p => p.x - p.noseX);
    midline_crossing = Math.min(...rel) < -0.02 && Math.max(...rel) > 0.02;
  }

  /* Head-hand coupling: how strongly head rotation actually tracked the hand
     during the reach. This is the associated-movement question a therapist
     cares about; it needs both signals and returns null when the face was not
     seen rather than inventing a number from the hand alone. */
  const headSamples = reach.filter(p => typeof p.headYaw === 'number');
  let head_hand_coupling = null;
  if (headSamples.length >= 6) {
    const rx = pearson(headSamples.map(p => p.x), headSamples.map(p => p.headYaw));
    const ry = pearson(headSamples.map(p => p.y), headSamples.map(p => p.headPitch));
    const parts = [rx, ry].filter(v => v !== null).map(Math.abs);
    if (parts.length) head_hand_coupling = parts.reduce((a, b) => a + b, 0) / parts.length;
  }

  /* Fatigue measured against the child's OWN start of session: slower reaches
     and rougher trajectories than their first attempts. A first gesture has no
     baseline and therefore no fatigue reading — null, not zero. */
  let fatigue_indicator = null;
  const usable = history.filter(g => g.response_time_ms != null && g.trajectory_smoothness != null);
  if (usable.length >= 3 && response_time_ms != null) {
    const base = usable.slice(0, 3);
    const baseRT = base.reduce((a, g) => a + g.response_time_ms, 0) / base.length;
    const baseSm = base.reduce((a, g) => a + g.trajectory_smoothness, 0) / base.length;
    const recent = usable.slice(-4);
    const recentRT = (recent.reduce((a, g) => a + g.response_time_ms, 0) + response_time_ms) / (recent.length + 1);
    const recentSm = trajectory_smoothness != null
      ? (recent.reduce((a, g) => a + g.trajectory_smoothness, 0) + trajectory_smoothness) / (recent.length + 1)
      : baseSm;
    const slowdown = baseRT > 0 ? Math.max(0, (recentRT - baseRT) / baseRT) : 0;
    const roughening = Math.max(0, baseSm - recentSm);
    fatigue_indicator = Math.min(1, slowdown * 0.6 + roughening * 1.2);
  }

  return {
    classification: isCorrect ? 'Perfect' : 'Failed',
    response_time_ms,
    dwell_ms: dwellMs,
    trajectory_smoothness,
    midline_crossing,
    head_hand_coupling,
    fatigue_indicator,
    reach_samples: reach.length,
  };
}

// ── Professional Reticle Cursor ─────────────────────────────────────────────
// Layers (back → front):
//   1. Outer glow halo (appears while dwelling)
//   2. Outer progress ring (sweeps clockwise, cyan → green, 2.5 s)
//   3. Crosshair ticks at 0°/90°/180°/270°
//   4. Static inner ring (precision 'aim zone')
//   5. Core dot + highlight glint
/* `progress` is written to the arc through `ringRef` by the RAF loop instead of
   flowing through props: re-rendering this SVG on every frame was one of the
   three per-frame setState calls that made the board stutter. */
function DwellCursor({ progress = 0, hovering, ringRef }) {
  const cx = CANVAS / 2;
  const cy = CANVAS / 2;
  const off = RING_CIRC * (1 - progress);

  // Hue interpolation: steel-blue (210) idle → cyan (185) hover → emerald (130) at 100 %
  const baseHue = hovering ? 185 - progress * 55 : 210;
  const accent = `hsl(${baseHue}, 92%, 60%)`;
  const accentD = `hsl(${baseHue}, 80%, 42%)`; // darker shade for depth
  const glow = `hsl(${baseHue}, 90%, 65%)`;

  // Tick positions (4 cardinal directions)
  const TICKS = [0, 90, 180, 270];

  return (
    <svg
      width={CANVAS} height={CANVAS}
      style={{ overflow: 'visible', pointerEvents: 'none' }}
    >
      <defs>
        {/* Radial glow gradient */}
        <radialGradient id="cursorGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={glow} stopOpacity={0.35 * progress} />
          <stop offset="100%" stopColor={glow} stopOpacity={0} />
        </radialGradient>
        {/* Core dot gradient (sphere illusion) */}
        <radialGradient id="dotGrad" cx="35%" cy="32%" r="65%">
          <stop offset="0%" stopColor="white" stopOpacity={0.95} />
          <stop offset="40%" stopColor={accent} stopOpacity={1} />
          <stop offset="100%" stopColor={accentD} stopOpacity={1} />
        </radialGradient>
      </defs>

      {/* ── Layer 1: soft glow halo during dwell ── */}
      {progress > 0 && (
        <circle cx={cx} cy={cy} r={RING_R + 18}
          fill="url(#cursorGlow)"
          opacity={progress}
        />
      )}

      {/* ── Layer 2: outer progress ring track ── */}
      <circle cx={cx} cy={cy} r={RING_R}
        fill="none"
        stroke={hovering ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.07)'}
        strokeWidth={2.5}
      />

      {/* ── Layer 2b: progress arc ── */}
      <circle ref={ringRef} cx={cx} cy={cy} r={RING_R}
        fill="none"
        stroke={accent}
        strokeWidth={2.8}
        strokeDasharray={RING_CIRC}
        strokeDashoffset={off}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: 'stroke 0.35s ease' }}
      />

      {/* ── Layer 3: crosshair ticks ── */}
      {TICKS.map(angle => {
        const rad = (angle * Math.PI) / 180;
        const inner = INNER_R + 4;
        const outer = inner + TICK_LEN;
        return (
          <line key={angle}
            x1={cx + Math.cos(rad) * inner} y1={cy + Math.sin(rad) * inner}
            x2={cx + Math.cos(rad) * outer} y2={cy + Math.sin(rad) * outer}
            stroke={hovering ? accent : 'rgba(200,232,237,0.45)'}
            strokeWidth={1.5} strokeLinecap="round"
            style={{ transition: 'stroke 0.3s ease' }}
          />
        );
      })}

      {/* ── Layer 4: static inner ring (aim zone) ── */}
      <circle cx={cx} cy={cy} r={INNER_R}
        fill="none"
        stroke={hovering ? accent : 'rgba(200,232,237,0.3)'}
        strokeWidth={1}
        style={{ transition: 'stroke 0.3s ease' }}
      />

      {/* ── Layer 5: core dot — sphere gradient ── */}
      <circle cx={cx} cy={cy} r={DOT_R}
        fill={hovering ? 'url(#dotGrad)' : 'rgba(200,232,237,0.75)'}
        style={{ transition: 'fill 0.3s ease' }}
      />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
// ── Keyboard size presets — PRD: big (8 keys), medium (12), standard (26) ───
const KB_SIZES = {
  big: { keyW: 84, keyH: 84, fontSize: '2rem', gap: 14, rowGap: 16, slotW: 68, slotH: 80, slotFont: '2.2rem', bsW: 98 },
  medium: { keyW: 68, keyH: 68, fontSize: '1.65rem', gap: 11, rowGap: 13, slotW: 60, slotH: 72, slotFont: '2rem', bsW: 82 },
  standard: { keyW: 54, keyH: 54, fontSize: '1.3rem', gap: 8, rowGap: 10, slotW: 50, slotH: 60, slotFont: '1.6rem', bsW: 68 },
};

export default function GamePage() {
  const [searchParams] = useSearchParams();
  const difficulty = searchParams.get('difficulty') || 'medium';
  const keyboardSize = searchParams.get('keyboardSize') || 'medium';

  /* ── Input mode ─────────────────────────────────────────────────────────
     'camera' — the finger held in the air, selection by dwell. The exercise
                the game exists for.
     'touch'  — a direct tap on the key. No webcam is opened at all, so this
                works on a device with no camera, in a room too dark to track,
                or with a child whose arm cannot be held up for a session.

     Touch stays live in BOTH modes: in camera mode it is how a parent or
     therapist helps without taking the session away from the child. Every
     gesture records which of the two produced it, because a session report
     that mixed them without saying so would be worse than no report. */
  const [inputMode, setInputMode] = useState(
    (searchParams.get('mode') || 'camera').toLowerCase() === 'touch' ? 'touch' : 'camera'
  );
  const isTouchMode = inputMode === 'touch';
  const inputModeRef = useRef(inputMode);
  useEffect(() => { inputModeRef.current = inputMode; }, [inputMode]);
  /* What produced the pending selection — set by the key handler, read when
     the gesture is recorded. */
  const lastInputSource = useRef(inputMode);
  const kbCfg = KB_SIZES[keyboardSize] || KB_SIZES.medium;
  const visibleKeyCount = KB_VISIBLE_KEYS[keyboardSize] || 26;
  const isSentenceMode = difficulty === 'complex_sentences';
  const isSelfExpression = difficulty === 'self_expression';
  const navigate = useNavigate();
  const { user, profile, logout } = useAuthStore();
  const { activeSession, startSession, recordGesture, endSession } = useSessionStore();

  // ── Tracking unifié : 1 seule caméra → mains + visage ─────────────────────
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const {
    landmarks,
    multiHandData,
    isTracking,
    error: cameraError,
    faceLandmarks,
    headPose,
    faceCanvasRef,
    /* Telemetry from the hook. The cursor position is NOT taken from here any
       more — it arrives through `smoothedCursorRef` below, read from the
       animation frame, so following the finger costs no re-render. */
    fps,
    trackingConfidence,
    gazeDetected,
    calibrationStatus,
    calibrationProgress,
    recalibrate,
    // Full-rate refs (read from the RAF loop, never from a render)
    rawCursorRef,
    smoothedCursorRef,
    confidenceRef,
    // Calibration screen
    handCount,
    coverageCells,
    coverageTarget,
    distanceFactor,
    finalizeCalibration,
    applyCalibration,
    /* enabled=false in touch mode: no getUserMedia, no permission prompt, no
     MediaPipe models downloaded, no frame loop. Touch mode has to work on a
     device that simply has no camera. */
  } = useMediaPipeTracking(videoRef, canvasRef, !isTouchMode);

  // ── Reflex Engine (temps réel) ─────────────────────────────────────────────
  const { startTracking, stopTracking, pushFrame, setInputMode: setEngineInputMode } =
    useReflexEngine({ analyzeEveryMs: 4000 });
  const reflexEngineOutputRef = useRef(null);


  // ── DOM refs ───────────────────────────────────────────────────────────
  const timerRef = useRef(null);
  const keyRefs = useRef({});
  const keyRects = useRef({});
  const slotRefs = useRef([]);

  // ── Dwell refs (used inside RAF — never stale) ─────────────────────────
  const dwellKey = useRef(null);   // key currently being dwelled on
  /* The dwell is now an ACCUMULATOR of milliseconds actually spent on the key,
     not a start timestamp. With a start timestamp the clock kept running while
     the finger was hovering somewhere else during the 200 ms hysteresis grace,
     so a child zig-zagging across the board could come back to a key they had
     brushed a second earlier and have it fire immediately — a selection nobody
     asked for, scored as a real attempt. Time only accumulates while the finger
     is genuinely on the key and the hand is genuinely tracked. */
  const dwellAccum = useRef(0);
  const dwellEnteredAt = useRef(null);  // when the finger first arrived (for reaction time)
  const lastTickAt = useRef(performance.now());
  const dwellRAF = useRef(null);
  const latestLandmarks = useRef(null);   // mirror of landmarks state for RAF

  // Dwell hysteresis state & telemetry logging
  const dwellKeyPending = useRef(null);
  const dwellKeyPendingStart = useRef(null);
  const lastLogTime = useRef(performance.now());

  /* Direct-DOM handles. The cursor position and the dwell ring used to be React
     state written on EVERY animation frame — three setState calls at 60 Hz,
     each re-rendering the whole board (every key is a framer-motion component).
     That is the single largest cause of the low frame rates the telemetry
     reports, and low frame rate is what makes the pointing feel unreliable.
     They are written straight to the DOM now; React state is used only for
     things that change a few times per second. */
  const cursorElRef = useRef(null);
  const ringElRef = useRef(null);
  const hoveredKeyRef = useRef(null);
  const dwellProgressRef = useRef(0);
  const rectsStale = useRef(true);

  /* Refs for tracking metrics, to avoid stale closures in the RAF loop. The
     cursor position and the confidence are no longer among them: the hook
     exposes those as refs of its own, so nothing has to re-render to keep
     them fresh. */
  const gazeDetectedRef = useRef(false);
  const fpsRef = useRef(30);
  const calibrationStatusRef = useRef('Calibrating...');

  const isTrackingRef = useRef(false);
  useEffect(() => { isTrackingRef.current = isTracking; }, [isTracking]);
  /* These two used to mirror per-frame state into refs. The hook now hands out
     the refs directly, so the state updates that fed them are gone and with
     them ~60 re-renders a second of this whole page. */
  useEffect(() => { gazeDetectedRef.current = gazeDetected; }, [gazeDetected]);
  useEffect(() => { fpsRef.current = fps; }, [fps]);
  useEffect(() => { calibrationStatusRef.current = calibrationStatus; }, [calibrationStatus]);

  // ── Game state ─────────────────────────────────────────────────────────
  /* The game now STARTS in calibration. Previously it started in 'playing':
     the session was created, the timer ran, a word was drawn and the dwell loop
     was live while the cursor mapping was still provisional. Anything the
     provisional mapping selected in those seconds was scored as a real attempt
     against a child who had not been told the game had begun. */
  const [phase, setPhase] = useState(
    (searchParams.get('mode') || 'camera').toLowerCase() === 'touch' ? 'playing' : 'calibration'
  );
  const [currentWord, setCurrentWord] = useState('');
  const [slots, setSlots] = useState([]);
  const [score, setScore] = useState({ perfect: 0, failed: 0, total: 0 });
  const [lastGesture, setLastGesture] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [sessionTime, setSessionTime] = useState(0);
  const [wordsCompleted, setWordsCompleted] = useState(0);
  const [showSuperAnim, setShowSuperAnim] = useState(false);
  const [encouragementText, setEncouragementText] = useState('');
  const [learnerLevel, setLearnerLevel] = useState(1);
  const [realtimeMetrics, setRealtimeMetrics] = useState({ avgResponseTime: null, accuracy: null, smoothness: null, fatigue: null });
  const [corrections, setCorrections] = useState(0);
  const [wordsSkipped, setWordsSkipped] = useState(0);

  // ── Self Expression state ──────────────────────────────────────────────
  const [freeText, setFreeText] = useState('');
  const [savedMessages, setSavedMessages] = useState([]);
  const textareaRef = useRef(null);

  // ── Text-To-Speech settings & hook ──
  const [ttsEnabled, setTtsEnabled] = useState(() => {
    const saved = localStorage.getItem('nesture-tts-enabled');
    return saved !== null ? saved === 'true' : true;
  });

  const { isSpeaking, speak: ttsSpeak, cancel: ttsCancel } = useTextToSpeech(ttsEnabled);

  // ── Cursor UI state ────────────────────────────────────────────────────
  /* Coarse mirrors of the refs above, updated at a few Hz for the badge text
     and the key highlight — not at 60 Hz for the cursor geometry. */
  const [hoveredKey, setHoveredKey] = useState(null);
  const [dwellProgress, setDwellProgress] = useState(0);  // 0–1, coarse (5% steps)
  const [showMobileSettings, setShowMobileSettings] = useState(false);

  // ── Pause & parent lock ────────────────────────────────────────────────
  const [savedCalibration, setSavedCalibration] = useState(null);
  /* The difficulty / keyboard / speech controls sit permanently on the play
     screen within a child's reach. Changing one used to hard-reload the page
     mid-session. They are behind a hold-to-unlock now — a nuisance to a child,
     trivial for an adult, which is exactly the right amount of friction. */
  const [settingsUnlocked, setSettingsUnlocked] = useState(false);
  const unlockTimer = useRef(null);
  const [unlockHeld, setUnlockHeld] = useState(false);

  const reducedMotion = React.useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    []
  );

  // ── Metric capture ─────────────────────────────────────────────────────
  /* The window over which a reach is measured: opened when a letter becomes
     the current target, closed when the finger settles on a key. */
  const targetShownAt = useRef(null);
  const reachBuffer = useRef([]);
  const headPoseRef = useRef({ pitch: 0, yaw: 0 });
  const faceNoseXRef = useRef(null);
  const lastPushedFaceRef = useRef(null);
  const attemptsOnSlot = useRef(0);          // wrong tries on the current letter
  const firstTryCorrect = useRef(0);         // letters solved with no wrong try
  const lettersAttempted = useRef(0);
  const [wrongFlash, setWrongFlash] = useState(null); // { idx, letter }
  const wrongFlashTimer = useRef(null);

  useEffect(() => { headPoseRef.current = headPose || { pitch: 0, yaw: 0 }; }, [headPose]);
  useEffect(() => {
    faceNoseXRef.current = faceLandmarks?.[1] ? 1 - faceLandmarks[1].x : null; // mirrored, like the hand
  }, [faceLandmarks]);

  /* ── What the reflex engine is fed ──────────────────────────────────────
     These were read straight from React state inside the RAF closure, which
     never re-created: `multiHandData`, `faceLandmarks` and `headPose` were
     frozen at their mount values — null, null and {pitch:0, yaw:0} — for the
     whole session. Every detector that depends on the head or the face was
     therefore correlating against a constant, and a constant series has zero
     variance, so Pearson returns 0 and the reflex reads as "none". Worse, two
     detectors manufacture a score out of the empty arrays that result.

     Refs, updated by their own effects, are what a 60 Hz loop can safely read. */
  const multiHandDataRef = useRef(null);
  const faceLandmarksRef = useRef(null);
  useEffect(() => { multiHandDataRef.current = multiHandData; }, [multiHandData]);
  useEffect(() => { faceLandmarksRef.current = faceLandmarks; }, [faceLandmarks]);

  /* `pushFrame` is recreated whenever the engine starts or stops, because it is
     guarded by `isRunning`. The RAF loop captured the version created BEFORE
     startTracking() ran — the one where isRunning is false and the call is a
     no-op — and kept it for the whole session, so the engine received nothing
     at all. Going through a ref means the loop always calls the current one. */
  const pushFrameRef = useRef(pushFrame);
  useEffect(() => { pushFrameRef.current = pushFrame; }, [pushFrame]);

  // ── Stale-closure mirrors ──────────────────────────────────────────────
  const slotsRef = useRef([]);
  const currentWordRef = useRef('');
  const pendingEndSession = useRef(false);
  const wordQueueRef = useRef([]);
  const dwellStartRef = useRef(0); // timestamp début du dwell courant
  const gestureLog = useRef([]);
  const showSuperAnimRef = useRef(false);
  const phaseRef = useRef('playing');
  const activeSessionRef = useRef(null);
  const capturedPositions = useRef([]);
  /* LetterQuest leaves for a results ROUTE instead of switching to a results
     phase, so the pose upload cannot wait on an effect that fires after the
     unmount. This handle lets handleEndSession start it explicitly. */
  const poseRef = useRef(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { showSuperAnimRef.current = showSuperAnim; }, [showSuperAnim]);
  useEffect(() => { latestLandmarks.current = landmarks; }, [landmarks]);
  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);

  // ── Session init ───────────────────────────────────────────────────────
  /* Guarded: under React 18 StrictMode this effect runs twice in development,
     which used to POST /sessions/start twice and leave an orphan session row
     for every game played. */
  const initRan = useRef(false);
  const learnerId = profile?.learner_id || user?.id || '00000000-0000-0000-0000-000000000010';
  const calibrationKey = `nesture-calib-${learnerId}`;

  useEffect(() => {
    // Level & any previously measured calibration — both safe before play.
    api.get(`/sessions/learner/${learnerId}?limit=500`)
      .then(r => setLearnerLevel(Math.max(1, Math.floor(r.data.length / 2) + 1)))
      .catch(() => { });
    try {
      const raw = localStorage.getItem(calibrationKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        /* A calibration older than a day describes a seating position that no
           longer exists. Offering it would be worse than measuring again. */
        if (parsed?.savedAt && Date.now() - parsed.savedAt < 24 * 3600 * 1000) {
          setSavedCalibration(parsed);
        }
      }
    } catch { /* storage can be unavailable; calibrate from scratch */ }

    return () => {
      clearInterval(timerRef.current);
      cancelAnimationFrame(dwellRAF.current);
      clearTimeout(wrongFlashTimer.current);
      clearTimeout(unlockTimer.current);
    };
  }, []);

  const initSession = useCallback(async () => {
    if (initRan.current) return;
    initRan.current = true;
    try {
      const res = await api.post('/sessions/start', { learner_id: learnerId, difficulty, game_name: 'LetterQuest' });
      startSession(res.data.session_id, learnerId, difficulty);
      /* Le moteur de réflexes est démarré dans les deux modes, mais il sait
         lequel : en tactile la caméra n'est pas ouverte, donc aucun réflexe ne
         PEUT être observé, et le rapport doit dire « sans objet » plutôt que
         « non mesuré », qui se lirait comme une panne. */
      startTracking({ sessionId: res.data.session_id, learnerId, inputMode });
      if (!isSelfExpression) pickNewWord();
      startTimer();
    } catch {
      initRan.current = false;
      toast.error('Could not start session');
      navigate('/play');
    }
  }, [learnerId, difficulty, isSelfExpression]);

  /* ── Calibration hand-over ──────────────────────────────────────────────
     The ONLY path from the calibration screen into the game. The session is
     created here, not on mount, so nothing exists to be scored until the hand
     is actually being tracked with a mapping built from the child's own reach.
     This is the behaviour the game was missing entirely. */
  const handleCalibrated = useCallback((bounds) => {
    if (bounds) {
      try { localStorage.setItem(calibrationKey, JSON.stringify(bounds)); } catch { /* non-fatal */ }
    }
    try { soundManager.init?.(); soundManager.playStartChime?.(); } catch { /* audio is optional */ }
    lastTickAt.current = performance.now();
    setPhase('playing');
    if (initRan.current) {
      /* Coming back from a mid-game recalibration: the session already exists,
         so only the clock and the measurement window need restarting. */
      clearInterval(timerRef.current);
      startTimer();
      openTargetWindow();
    } else {
      initSession();
    }
  }, [calibrationKey, initSession]);

  /* In camera mode the calibration screen starts the session. In touch mode
     there is nothing to calibrate, so it starts here instead — but still after
     mount, never during render. */
  useEffect(() => {
    if (isTouchMode && phase === 'playing' && !initRan.current) initSession();
  }, [isTouchMode, phase]);

  /* ── Switching input mode mid-session ───────────────────────────────────
     Not behind the parent lock: a child whose arm is tired, or whose camera
     has just dropped out, needs this now — it is an accessibility control, not
     a setting. And unlike the difficulty controls it changes nothing about the
     exercise's content, so the session continues rather than restarting. */
  const handleSwitchInputMode = useCallback(() => {
    const next = inputModeRef.current === 'camera' ? 'touch' : 'camera';
    try { soundManager.playClick?.(); } catch { /* audio is optional */ }
    setInputMode(next);
    lastInputSource.current = next;
    /* Le moteur clôt sa fenêtre en cours au passage caméra → tactile, pour ne
       pas perdre les images déjà mesurées, et note que la séance a été mixte. */
    try { setEngineInputMode(next); } catch { /* le moteur peut ne pas tourner */ }

    // Drop any dwell in progress so the switch cannot fire a stray selection.
    dwellKey.current = null;
    dwellAccum.current = 0;
    dwellEnteredAt.current = null;
    dwellProgressRef.current = 0;
    setDwellProgress(0);
    hoveredKeyRef.current = null;
    setHoveredKey(null);

    if (next === 'camera') {
      /* Going back to the air needs a mapping, and the camera has to be
         restarted — so it goes through the calibration screen exactly like the
         start of a session. */
      clearInterval(timerRef.current);
      ttsCancel();
      recalibrate?.();
      setPhase('calibration');
      toast('Hand-in-air mode — calibrating', { icon: '✋' });
    } else {
      lastTickAt.current = performance.now();
      openTargetWindow();
      if (phaseRef.current === 'calibration') {
        clearInterval(timerRef.current);
        startTimer();
        setPhase('playing');
      }
      toast('Touch mode — tap the keys', { icon: '👆' });
    }
  }, [recalibrate, ttsCancel]);

  const handleUseSavedCalibration = useCallback(() => {
    if (!savedCalibration) return;
    if (applyCalibration?.(savedCalibration)) {
      handleCalibrated(savedCalibration);
    } else {
      toast.error('Saved calibration is invalid — sweep again.');
      setSavedCalibration(null);
    }
  }, [savedCalibration, applyCalibration, handleCalibrated]);

  /* ── Raw hand-tracking capture ──────────────────────────────────────────
     The old version pushed positions into a single array capped at 1000, then
     set a `trackingSaved` flag and STOPPED CAPTURING for the rest of the
     session. At 60 Hz that is sixteen seconds of data from a ten-minute
     exercise, and because the flag was already set, the end-of-session save
     also did nothing. Positions are flushed in batches instead, and capture
     never stops. They are also thinned to ~20 Hz, which is well above what any
     motor analysis needs and keeps the payloads sane. */
  const CAPTURE_MIN_INTERVAL_MS = 50;
  const CAPTURE_BATCH = 600;
  const lastCaptureAt = useRef(0);
  const flushing = useRef(false);

  const flushTrackingPositions = useCallback(async (final = false) => {
    const sess = activeSessionRef.current;
    const batch = capturedPositions.current;
    if (!sess?.id || batch.length === 0) return;
    if (flushing.current && !final) return;
    flushing.current = true;
    capturedPositions.current = [];
    try {
      const { error } = await supabase.from('raw_hand_tracking').insert({
        session_id: sess.id,
        child_id: sess.learnerId || learnerId,
        positions: batch,
      });
      if (error) {
        console.error('Failed to save raw tracking:', error);
        /* Put the batch back so the next flush retries instead of silently
           dropping the child's data. */
        capturedPositions.current = batch.concat(capturedPositions.current);
      }
    } catch (e) {
      console.error('Failed to save raw tracking:', e);
      capturedPositions.current = batch.concat(capturedPositions.current);
    } finally {
      flushing.current = false;
    }
  }, [learnerId]);

  /* ── Settings changes ───────────────────────────────────────────────────
     This used to be `window.location.href = ...`, a full page reload fired
     from a control bar sitting in a child's reach. The reload killed the tab
     before endSession() ran, so every accidental tap left an unfinished
     session row in the database, threw away the captured hand-tracking
     positions, and lost the score with no warning. The session is closed
     properly first, and the change is behind the parent lock. */
  const handleSettingChange = async (type, val) => {
    let newDiff = difficulty;
    let newKb = keyboardSize;

    if (type === 'difficulty') {
      newDiff = val;
      const defaults = { easy: 'big', medium: 'medium', complex_words: 'medium', complex_sentences: 'standard', self_expression: 'standard' };
      newKb = defaults[newDiff] || 'medium';
    } else {
      newKb = val;
      if (newKb !== 'standard' && (newDiff === 'complex_sentences' || newDiff === 'self_expression')) {
        toast.error('This mode requires Standard keys.');
        return;
      }
    }
    if (newDiff === difficulty && newKb === keyboardSize) return;

    await abortSession('settings-change');
    window.location.href = `/play/game?difficulty=${newDiff}&keyboardSize=${newKb}`;
  };

  /* Close the current session without navigating to the results screen: used
     when the player changes a setting or leaves. Everything that would
     otherwise leak — the timer, the RAF loop, the reflex engine, the buffered
     hand positions, the open session row — is released here. */
  const abortSession = useCallback(async (reason) => {
    clearInterval(timerRef.current);
    cancelAnimationFrame(dwellRAF.current);
    try { stopTracking(); } catch { /* engine may not have started */ }
    await flushTrackingPositions(true);
    const sess = activeSessionRef.current;
    if (sess?.id && gestureLog.current.length > 0) {
      try { await endSession(null); } catch { /* best effort — never block the exit */ }
    } else if (sess?.id) {
      try { await api.post('/sessions/end', { session_id: sess.id, aborted: true, reason }); } catch { /* optional endpoint */ }
    }
  }, [endSession, stopTracking]);


  // ── Self Expression: Speak via Web Speech API ──────────────────────────
  const handleSpeak = useCallback((text) => {
    const toSpeak = text || freeText;
    if (!toSpeak.trim()) { toast('Nothing to speak yet!', { icon: '🔇' }); return; }
    ttsSpeak(toSpeak.trim(), { rate: 0.9, pitch: 1.0 });
  }, [freeText, ttsSpeak]);

  // ── Self Expression: Save message ──────────────────────────────────────
  const handleSaveMessage = useCallback(() => {
    if (!freeText.trim()) { toast('Type something first!', { icon: '✏️' }); return; }
    const msg = {
      id: Date.now(),
      text: freeText.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setSavedMessages(prev => [msg, ...prev]);
    setFreeText('');
    toast.success('Message saved! 💾');
    if (textareaRef.current) textareaRef.current.focus();
  }, [freeText]);

  // ── Self Expression: Clear ─────────────────────────────────────────────
  const handleClearCanvas = useCallback(() => {
    ttsCancel();
    setFreeText('');
    if (textareaRef.current) textareaRef.current.focus();
  }, [ttsCancel]);

  /* Idempotent: switching input mode mid-calibration can reach this from two
     paths at once (the switch handler and initSession). Without the clear,
     the session clock would tick twice per second for the rest of the game. */
  const startTimer = () => {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setSessionTime(t => t + 1), 1000);
  };

  // ── Pick new word/phrase ────────────────────────────────────────────────
  /* A "reach" starts the instant a letter becomes the child's current target.
     Everything the clinical metrics need is captured between here and the
     moment the finger settles on a key. */
  const openTargetWindow = useCallback(() => {
    targetShownAt.current = performance.now();
    reachBuffer.current = [];
    attemptsOnSlot.current = 0;
  }, []);

  /* The live panel used to average `response_time_ms` and
     `trajectory_smoothness` across every logged gesture with a plain
     `reduce(... + g.x)`. Now that a metric can honestly be null — no face in
     frame, too few movement samples — those sums would produce NaN and the
     panel would read "NaN%". Nulls are skipped, and a metric with nothing
     behind it shows a dash rather than a made-up number. */
  const updateRealtimeMetrics = useCallback(() => {
    const log = gestureLog.current;
    const avg = (key) => {
      const vals = log.map(g => g[key]).filter(v => typeof v === 'number' && !Number.isNaN(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const attempts = log.filter(g => g.classification === 'Perfect' || g.classification === 'Failed');
    const fatigues = log.map(g => g.fatigue_indicator).filter(v => typeof v === 'number');
    setRealtimeMetrics({
      avgResponseTime: avg('response_time_ms'),
      /* First-try accuracy: the share of letters solved without a wrong
         attempt. The old figure counted every keypress, so a child who missed
         and then corrected still contributed a "Perfect" — which flattered the
         score and hid exactly the difficulty a therapist is looking for. */
      accuracy: lettersAttempted.current > 0
        ? firstTryCorrect.current / lettersAttempted.current
        : (attempts.length ? attempts.filter(g => g.classification === 'Perfect').length / attempts.length : null),
      smoothness: avg('trajectory_smoothness'),
      fatigue: fatigues.length ? fatigues[fatigues.length - 1] : null,
    });
  }, []);

  const pickNewWord = useCallback(() => {
    const bank = WORD_PROMPTS[difficulty] || WORD_PROMPTS.medium;
    if (!bank) return; // self_expression has no prompts
    const previous = currentWordRef.current;
    if (wordQueueRef.current.length === 0)
      wordQueueRef.current = shuffle([...bank]);
    let word = wordQueueRef.current.pop();
    /* Refilling the queue could hand back the word that was just skipped. */
    if (word === previous && wordQueueRef.current.length > 0) {
      const alt = wordQueueRef.current.pop();
      wordQueueRef.current.unshift(word);
      word = alt;
    }
    currentWordRef.current = word;
    // For sentences, split by character (including spaces)
    const chars = isSentenceMode ? word.split('') : word.split('');
    const emptySlots = chars.map(() => ({ letter: null, correct: false }));
    slotsRef.current = emptySlots;
    setCurrentWord(word);
    setSlots(emptySlots);
    // Open the measurement window for the first letter of the new word.
    openTargetWindow();
  }, [difficulty, isSentenceMode]);

  // ── Cache key hitboxes ─────────────────────────────────────────────────
  /* These rectangles ARE the hit-test. They used to be recomputed on a bare
     `setTimeout(update, 400)`, so for four tenths of a second after every
     keystroke — and after every layout change — the finger was being tested
     against where the keys used to be. They were also never refreshed on
     scroll, so on any viewport short enough to scroll, the whole board was
     offset by the scroll distance. A ResizeObserver plus a scroll listener
     replaces the guess. */
  const boardElRef = useRef(null);
  const refreshKeyRects = useCallback(() => {
    const kr = {};
    for (const [k, el] of Object.entries(keyRefs.current)) {
      if (el && el.isConnected) kr[k] = el.getBoundingClientRect();
    }
    keyRects.current = kr;
    rectsStale.current = Object.keys(kr).length === 0;
  }, []);

  useEffect(() => {
    let raf = requestAnimationFrame(refreshKeyRects);
    const onScroll = () => refreshKeyRects();
    window.addEventListener('resize', refreshKeyRects);
    window.addEventListener('scroll', onScroll, true);

    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && boardElRef.current) {
      ro = new ResizeObserver(() => refreshKeyRects());
      ro.observe(boardElRef.current);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', refreshKeyRects);
      window.removeEventListener('scroll', onScroll, true);
      ro?.disconnect();
    };
  }, [refreshKeyRects, phase, keyboardSize]);

  /* The board itself changes shape when the word changes (different key set)
     or when an overlay covers it — recompute on the next frame, not in 400 ms. */
  useEffect(() => {
    const raf = requestAnimationFrame(refreshKeyRects);
    return () => cancelAnimationFrame(raf);
  }, [refreshKeyRects, currentWord, showSuperAnim, isSelfExpression]);

  // ── Letter actions ─────────────────────────────────────────────────────
  const handleDeleteLetter = useCallback(() => {
    if (isSelfExpression) {
      setFreeText(prev => prev.slice(0, -1));
      try { soundManager.playClick?.(); } catch { /* audio is optional */ }
      toast('Deleted ⌫', { icon: '🗑️', duration: 800 });
      return;
    }

    const idx = slotsRef.current.map(s => s.letter !== null).lastIndexOf(true);
    if (idx === -1) return;
    const removed = slotsRef.current[idx].letter;
    const newSlots = [...slotsRef.current];
    newSlots[idx] = { letter: null, correct: false };
    slotsRef.current = newSlots;
    setSlots([...newSlots]);
    try { soundManager.playClick?.(); } catch { /* audio is optional */ }

    /* Self-correction is one of the most informative things a child does in
       this exercise and it used to be recorded nowhere: backspaces were
       invisible to the score, to the metrics and to the session report. */
    const correction = {
      target_letter: removed,
      classification: 'Corrected',
      input_mode: lastInputSource.current,
      response_time_ms: null,
      trajectory_smoothness: null,
      midline_crossing: null,
      head_hand_coupling: null,
      fatigue_indicator: null,
      corrected: true,
    };
    recordGesture(correction);
    gestureLog.current.push(correction);
    setCorrections(c => c + 1);
    openTargetWindow();
    toast('Deleted ⌫', { icon: '🗑️', duration: 800 });
  }, [isSelfExpression, recordGesture, openTargetWindow]);

  const handleTypeLetter = useCallback((letter) => {
    if (isSelfExpression) {
      if (letter === '⌫') {
        setFreeText(prev => prev.slice(0, -1));
      } else if (letter === '␣' || letter === 'SPACE') {
        setFreeText(prev => prev + ' ');
      } else {
        setFreeText(prev => prev + letter);
      }
      try { soundManager.playClick?.(); } catch { /* audio is optional */ }
      if (ttsEnabled) ttsSpeak(letter, { phonetic: true });
      return;
    }

    const word = currentWordRef.current;
    const targetIdx = slotsRef.current.findIndex(s => s.letter === null);
    /* Nothing left to fill: with the rule below this can only happen on the
       frame between the last correct letter and the celebration overlay. */
    if (targetIdx === -1) return;

    const isCorrect = letter === word[targetIdx];

    // ── Clinical metrics, measured over the reach that just happened ──────
    /* A tap has no dwell and no tracked reach, but it DOES have a reaction
       time — target shown to finger down — and that is the one metric worth
       keeping in touch mode. The others fall out as null on their own, because
       the dwell loop never ran and so the reach buffer is empty. Reporting
       them as zero would be inventing data. */
    const byTouch = lastInputSource.current === 'touch';
    const dwellMs = byTouch ? 0 : (DWELL_BY_DIFFICULTY[difficulty] ?? DWELL_MS);
    const realMetrics = computeRealGestureMetrics(
      byTouch ? [] : reachBuffer.current,
      {
        targetShownAt: targetShownAt.current,
        dwellEnteredAt: byTouch ? performance.now() : dwellEnteredAt.current,
        dwellMs,
      },
      isCorrect,
      gestureLog.current,
    );
    const gesture = {
      target_letter: word[targetIdx],
      selected_letter: letter,
      attempt: attemptsOnSlot.current + 1,
      /* Which input produced it. A tap and a two-second dwell are not the same
         motor act; a report that averaged them together without saying so
         would be actively misleading to a therapist. */
      input_mode: lastInputSource.current,
      ...realMetrics,
    };
    recordGesture(gesture);
    gestureLog.current.push(gesture);
    setLastGesture({ letter, result: gesture.classification });

    setScore(s => ({
      perfect: s.perfect + (isCorrect ? 1 : 0),
      failed: s.failed + (!isCorrect ? 1 : 0),
      total: s.total + 1,
    }));

    /* ── The rule that used to lock the game ─────────────────────────────
       A wrong letter used to be written permanently into the slot. Once every
       slot held a letter, `findIndex(s => s.letter === null)` returned -1 and
       this function returned immediately on EVERY subsequent key: the board
       stopped responding, no message explained why, and the child's only way
       out was the ⌫ key or the Skip button — neither of which a child who has
       just failed five letters is likely to find. A word finished with wrong
       letters was simply the end of the game.

       A wrong letter is now shown for a moment, in red, with an error sound,
       and then clears itself. The attempt is recorded, the child sees what
       they picked, and the slot is immediately available again. The board can
       no longer reach a state where it does nothing. */
    if (!isCorrect) {
      attemptsOnSlot.current += 1;
      const nextSlots = [...slotsRef.current];
      nextSlots[targetIdx] = { letter, correct: false };
      slotsRef.current = nextSlots;
      setSlots([...nextSlots]);
      setWrongFlash({ idx: targetIdx, letter });
      try { soundManager.playOffPath?.(); } catch { /* audio is optional */ }

      clearTimeout(wrongFlashTimer.current);
      wrongFlashTimer.current = setTimeout(() => {
        const cleared = [...slotsRef.current];
        if (cleared[targetIdx] && !cleared[targetIdx].correct) {
          cleared[targetIdx] = { letter: null, correct: false };
          slotsRef.current = cleared;
          setSlots([...cleared]);
        }
        setWrongFlash(null);
        /* After three misses on the same letter, say it out loud: a prompt,
           not a penalty. */
        if (attemptsOnSlot.current >= 3 && ttsEnabled) {
          ttsSpeak(word[targetIdx], { phonetic: true });
        }
        openTargetWindow();
      }, reducedMotion ? 500 : 750);

      updateRealtimeMetrics();
      return;
    }

    // ── Correct ──────────────────────────────────────────────────────────
    lettersAttempted.current += 1;
    if (attemptsOnSlot.current === 0) firstTryCorrect.current += 1;

    const newSlots = [...slotsRef.current];
    newSlots[targetIdx] = { letter, correct: true };
    slotsRef.current = newSlots;
    setSlots([...newSlots]);
    try { soundManager.playProgress?.(); } catch { /* audio is optional */ }
    /* Only a letter that was actually accepted is spoken. Speaking a wrong
       letter — which is what used to happen, for right and wrong alike —
       tells a child learning their letters that the wrong one was right. */
    if (ttsEnabled) ttsSpeak(letter, { phonetic: true });

    updateRealtimeMetrics();

    const allFilled = newSlots.every(s => s.letter !== null);
    const allCorrect = newSlots.every((s, i) => s.letter === word[i]);
    if (allFilled && allCorrect) {
      const text = ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)];
      setEncouragementText(text);
      setShowSuperAnim(true);
      try { soundManager.playCelebration?.(); } catch { /* audio is optional */ }

      /* The celebration used to be a flat 3 s while the word was read aloud
         starting at 600 ms — so a long phrase was cut off mid-sentence by the
         next word appearing. It now waits for the voice, within a sane cap. */
      const spokenMs = ttsEnabled ? Math.min(6000, 900 + word.length * 130) : 0;
      const holdMs = Math.max(reducedMotion ? 1200 : 2200, spokenMs);
      if (ttsEnabled) setTimeout(() => ttsSpeak(word), 600);

      setTimeout(() => {
        setShowSuperAnim(false);
        setWordsCompleted(prev => {
          const next = prev + 1;
          if (next >= TARGET_WORDS) pendingEndSession.current = true;
          else pickNewWord();
          return next;
        });
      }, holdMs);
    } else {
      openTargetWindow();
    }
  }, [difficulty, isSelfExpression, pickNewWord, recordGesture, ttsEnabled, ttsSpeak,
      openTargetWindow, reducedMotion, updateRealtimeMetrics]);

  // ── RAF dwell loop ─────────────────────────────────────────────────────
  // Resets ONLY when the finger moves to a different key (or off all keys).
  // Ignores natural hand jitter — tolerant by design.
  const runDwellLoop = useCallback(() => {
    /* Writes the cursor straight to the DOM. Sixty of these a second cost
       nothing; sixty setState calls a second re-rendered every key on the
       board. */
    const paintCursor = (x, y, progress, hovering) => {
      const el = cursorElRef.current;
      if (el) {
        el.style.transform = `translate3d(${x - CANVAS / 2}px, ${y - CANVAS / 2}px, 0)`;
        el.style.opacity = x < -100 ? '0' : '1';
      }
      const ring = ringElRef.current;
      if (ring) {
        ring.style.strokeDashoffset = String(RING_CIRC * (1 - progress));
        const hue = hovering ? 185 - progress * 55 : 210;
        ring.style.stroke = `hsl(${hue}, 92%, 60%)`;
      }
    };

    const tick = () => {
      dwellRAF.current = requestAnimationFrame(tick);

      const now = performance.now();
      const dt = Math.min(100, now - lastTickAt.current); // clamp: tab was backgrounded
      lastTickAt.current = now;

      const lm = latestLandmarks.current;
      /* 'paused' and 'calibration' are handled here too: the dwell must not
         accumulate behind a pause overlay, and it must not run at all before
         the game has been handed over by the calibration screen. Touch mode
         has no cursor and no dwell at all — the tap is the selection. */
      if (!lm || inputModeRef.current === 'touch'
          || phaseRef.current !== 'playing' || showSuperAnimRef.current) {
        paintCursor(-300, -300, 0, false);
        if (hoveredKeyRef.current !== null) { hoveredKeyRef.current = null; setHoveredKey(null); }
        if (dwellProgressRef.current !== 0) { dwellProgressRef.current = 0; setDwellProgress(0); }
        dwellAccum.current = 0;
        dwellEnteredAt.current = null;
        dwellKey.current = null;
        dwellKeyPending.current = null;
        dwellKeyPendingStart.current = null;
        return;
      }

      // Index finger tip → Map to Keyboard bounding box to support laptops, external displays, and tablets
      let minLeft = window.innerWidth * 0.25;
      let maxRight = window.innerWidth * 0.75;
      let minTop = window.innerHeight * 0.40;
      let maxBottom = window.innerHeight * 0.85;

      const rects = Object.values(keyRects.current);
      if (rects.length > 0) {
        minLeft = Math.min(...rects.map(r => r.left));
        maxRight = Math.max(...rects.map(r => r.right));
        minTop = Math.min(...rects.map(r => r.top));
        maxBottom = Math.max(...rects.map(r => r.bottom));

        // Add safety margins
        minLeft = Math.max(0, minLeft - 60);
        maxRight = Math.min(window.innerWidth, maxRight + 60);
        minTop = Math.max(0, minTop - 60);
        maxBottom = Math.min(window.innerHeight, maxBottom + 60);
      }

      // Map normalized, smoothed and calibrated coordinates from the hook to the keyboard coordinates
      const cursor = smoothedCursorRef.current;
      const sx = minLeft + cursor.x * (maxRight - minLeft);
      const sy = minTop + cursor.y * (maxBottom - minTop);

      // ── Capture raw positions, thinned and flushed in batches ─────────────
      if (phaseRef.current === 'playing' && activeSessionRef.current?.id) {
        if (now - lastCaptureAt.current >= CAPTURE_MIN_INTERVAL_MS) {
          lastCaptureAt.current = now;
          capturedPositions.current.push({ x: sx, y: sy, timestamp: Date.now() });
          if (capturedPositions.current.length >= CAPTURE_BATCH) flushTrackingPositions();
        }
      }

      /* Samples for the clinical metrics: the reach from "letter became the
         target" to "finger settled". Only collected while a target window is
         open, and paired with the head pose and body midline of the same
         instant so the metrics are computed on synchronised signals rather
         than on whatever the last render happened to hold. */
      if (targetShownAt.current !== null && reachBuffer.current.length < 400) {
        reachBuffer.current.push({
          x: cursor.x,
          y: cursor.y,
          t: now,
          headYaw: headPoseRef.current?.yaw,
          headPitch: headPoseRef.current?.pitch,
          noseX: faceNoseXRef.current ?? undefined,
        });
      }

      /* ── Hit test ────────────────────────────────────────────────────────
         The old test padded every key by 14 px and took the FIRST match from
         `Object.entries`. With gaps of 8-14 px, adjacent hitboxes overlapped by
         up to 20 px, and object key order has nothing to do with where the keys
         are on screen — so in the overlap the selected key was effectively
         arbitrary, and it was not the nearest one. Strictly-inside matches now
         win outright, and among padded matches the closest key centre wins. */
      let hKey = null;
      if (!rectsStale.current) {
        const PAD = 10;
        let bestInsideD = Infinity;
        let bestPaddedD = Infinity;
        let paddedKey = null;
        for (const [k, rect] of Object.entries(keyRects.current)) {
          const inside = sx >= rect.left && sx <= rect.right && sy >= rect.top && sy <= rect.bottom;
          const near = sx >= rect.left - PAD && sx <= rect.right + PAD
            && sy >= rect.top - PAD && sy <= rect.bottom + PAD;
          if (!near) continue;
          const kx = (rect.left + rect.right) / 2;
          const ky = (rect.top + rect.bottom) / 2;
          const d = Math.hypot(sx - kx, sy - ky);
          if (inside) {
            if (d < bestInsideD) { bestInsideD = d; hKey = k; }
          } else if (bestInsideD === Infinity && d < bestPaddedD) {
            bestPaddedD = d; paddedKey = k;
          }
        }
        if (hKey === null) hKey = paddedKey;
      }

      if (hKey !== hoveredKeyRef.current) {
        hoveredKeyRef.current = hKey;
        setHoveredKey(hKey);
      }

      /* ── Freeze on lost tracking ─────────────────────────────────────────
         The hook keeps `isTracking` true for a 400 ms grace period after the
         hand disappears, so the cursor does not flicker on a dropped frame.
         The dwell used to keep accumulating through that grace with no hand in
         front of the camera at all — long enough to complete a selection the
         child was not making. Time only accrues while the tracking is actually
         good; below that, the progress holds where it is. */
      const trackingUsable = isTrackingRef.current && confidenceRef.current >= 30;

      // Throttled logging to console once every second
      const nowMs = now;
      if (nowMs - lastLogTime.current >= 1000) {
        console.log(
          `[Telemetry Log] FPS: ${fpsRef.current} | Confidence: ${confidenceRef.current}% | Hand: ${isTracking ? 'Yes' : 'No'} | Gaze: ${gazeDetectedRef.current ? 'Yes' : 'No'} | Selected Key: ${hKey || 'None'} | Calibration: ${calibrationStatusRef.current}`
        );
        lastLogTime.current = nowMs;
      }

      // ── Hysteresis State Machine ──
      if (hKey === dwellKey.current) {
        if (dwellKey.current !== null) {
          // Stayed/returned to the active key -> cancel pending switches
          dwellKeyPending.current = null;
          dwellKeyPendingStart.current = null;
        }
      } else {
        if (dwellKey.current === null) {
          // Hovered over key, initiate immediately
          if (hKey !== null) {
            dwellKey.current = hKey;
            dwellAccum.current = 0;
            dwellEnteredAt.current = nowMs;
            dwellStartRef.current = nowMs;
            dwellKeyPending.current = null;
            dwellKeyPendingStart.current = null;
          }
        } else {
          // Hovered key is different from active key -> start transition grace period
          if (dwellKeyPending.current === hKey) {
            const elapsedPending = nowMs - dwellKeyPendingStart.current;
            const threshold = hKey === null ? 250 : 200; // 250ms for empty space, 200ms for other key
            if (elapsedPending >= threshold) {
              // Grace period expired, commit switch
              dwellKey.current = hKey;
              dwellAccum.current = 0;
              dwellEnteredAt.current = hKey === null ? null : nowMs;
              dwellStartRef.current = hKey === null ? 0 : nowMs;
              dwellKeyPending.current = null;
              dwellKeyPendingStart.current = null;
            }
          } else {
            dwellKeyPending.current = hKey;
            dwellKeyPendingStart.current = nowMs;
          }
        }
      }

      /* ── Feed the reflex engine ──────────────────────────────────────────
         The face mesh is deliberately computed on one camera frame in five to
         save CPU. Sending the same landmark object on the four frames in
         between told the engine it had five independent observations of a
         perfectly motionless face: eye velocity read as zero four times out of
         five, and every eye detector was measuring the throttle rather than the
         child. A frame now carries the face only when it is genuinely a new
         observation. */
      if (lm) {
        const face = faceLandmarksRef.current;
        const faceIsNew = face && face !== lastPushedFaceRef.current;
        if (faceIsNew) lastPushedFaceRef.current = face;
        pushFrameRef.current({
          leftHand: multiHandDataRef.current?.left || null,
          rightHand: multiHandDataRef.current?.right || lm,
          faceMesh: faceIsNew ? face : null,
          headPitch: headPoseRef.current?.pitch ?? 0,
          headYaw: headPoseRef.current?.yaw ?? 0,
        });
      }

      /* One source of truth, shared with the on-screen hint and the "how to
         play" card, so the number the child is told is the number they are
         measured against. */
      const currentDwellMs = DWELL_BY_DIFFICULTY[difficulty] ?? DWELL_MS;

      // ── Accumulate dwell time ────────────────────────────────────────────
      if (dwellKey.current !== null) {
        if (dwellKeyPending.current === null) {
          /* On the key, hand tracked: this is the only case that earns time. */
          if (trackingUsable) dwellAccum.current += dt;
        } else if (trackingUsable) {
          /* Drifted onto something else within the grace window. Decaying
             rather than holding means a finger sliding across the board loses
             the charge it built on a key it merely passed over. */
          dwellAccum.current = Math.max(0, dwellAccum.current - dt * 1.5);
        }
        // Tracking lost: neither gain nor decay. The progress simply waits.
      } else {
        dwellAccum.current = 0;
      }

      const progress = Math.min(dwellAccum.current / currentDwellMs, 1);
      paintCursor(sx, sy, progress, !!hKey);

      /* Coarse mirror for the badge text and the key fill: ~20 updates over a
         full dwell instead of 120. */
      const coarse = Math.round(progress * 20) / 20;
      if (coarse !== dwellProgressRef.current) {
        dwellProgressRef.current = coarse;
        setDwellProgress(coarse);
      }

      // Dwell complete → fire selection
      if (progress >= 1) {
        const selected = dwellKey.current;
        dwellKey.current = null;
        dwellAccum.current = 0;
        dwellProgressRef.current = 0;
        setDwellProgress(0);
        lastInputSource.current = 'camera';
        if (selected === '⌫') handleDeleteLetter();
        else handleTypeLetter(selected === '␣' ? ' ' : selected);
      }
    };

    lastTickAt.current = performance.now();
    dwellRAF.current = requestAnimationFrame(tick);
  }, [handleDeleteLetter, handleTypeLetter, difficulty, flushTrackingPositions]);

  // Start RAF loop on mount
  useEffect(() => {
    runDwellLoop();
    return () => cancelAnimationFrame(dwellRAF.current);
  }, [runDwellLoop]);

  // ── Pending end session ────────────────────────────────────────────────
  useEffect(() => {
    if (pendingEndSession.current && !processing) {
      pendingEndSession.current = false;
      handleEndSession();
    }
  }, [wordsCompleted]);

  // ── End session ────────────────────────────────────────────────────────
  const handleEndSession = async () => {
    if (processing) return;
    setProcessing(true);
    setPhase('ending');
    clearInterval(timerRef.current);
    cancelAnimationFrame(dwellRAF.current);
    if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(t => t.stop());

    // Flush whatever is still buffered. Unlike before, capture ran for the
    // whole session, so this batch is the tail rather than the only data.
    await flushTrackingPositions(true);

    /* Start the pose upload before navigating away. Not awaited: the analysis
       runs synchronously here and the insert is a fetch already in flight by
       the time this component unmounts, so it completes on its own. A research
       row must never delay a child's results screen. */
    poseRef.current?.finalise();

    // Arrêter le moteur de réflexes et récupérer le résultat final
    const reflexOutput = stopTracking();
    reflexEngineOutputRef.current = reflexOutput;
    try {
      const analysis = await endSession(reflexOutput);
      if (analysis) {
        navigate(`/play/results/${analysis.session_id || activeSession?.id}`, {
          state: { analysis, reflexEngineOutput: reflexOutput },
        });
      } else {
        toast.error('No analysis returned');
        navigate('/play');
      }
    } catch {
      toast.error('Error saving session');
      navigate('/play');
    }
  };

  /* ── Pause ──────────────────────────────────────────────────────────────
     There was no way to stop. A child who needed a break, a parent who had to
     answer the door, a therapist who wanted to say something — the only exits
     were "End Session" and closing the tab, and the session clock and fatigue
     metric ran through all of it. */
  const handlePause = useCallback(() => {
    setPhase(p => {
      if (p === 'playing') {
        clearInterval(timerRef.current);
        ttsCancel();
        return 'paused';
      }
      if (p === 'paused') {
        lastTickAt.current = performance.now();
        openTargetWindow();
        startTimer();
        return 'playing';
      }
      return p;
    });
  }, [ttsCancel, openTargetWindow]);

  /* Skipping used to leave no trace at all: no gesture, no counter, nothing in
     the session report — so a child who skipped every word looked identical to
     a child who finished none. */
  const handleSkipWord = useCallback(() => {
    const skipped = {
      target_letter: currentWordRef.current,
      classification: 'Skipped',
      input_mode: inputModeRef.current,
      response_time_ms: null,
      trajectory_smoothness: null,
      midline_crossing: null,
      head_hand_coupling: null,
      fatigue_indicator: null,
    };
    recordGesture(skipped);
    gestureLog.current.push(skipped);
    setWordsSkipped(n => n + 1);
    pickNewWord();
  }, [recordGesture, pickNewWord]);

  /* Recalibrating mid-game used to restart the measurement while the board
     stayed live: the child kept playing against a provisional mapping and
     whatever it selected was scored — the original bug, in miniature. It now
     goes back to the calibration screen, with the session clock stopped, and
     comes back the same way it started. */
  const handleRecalibrate = useCallback(() => {
    clearInterval(timerRef.current);
    ttsCancel();
    recalibrate?.();
    setPhase('calibration');
  }, [recalibrate, ttsCancel]);

  // Hold-to-unlock: an adult holds the lock for a moment, a child does not.
  const startUnlockHold = useCallback(() => {
    if (settingsUnlocked) { setSettingsUnlocked(false); return; }
    setUnlockHeld(true);
    unlockTimer.current = setTimeout(() => {
      setSettingsUnlocked(true);
      setUnlockHeld(false);
      toast.success('Settings unlocked');
    }, 1500);
  }, [settingsUnlocked]);

  const cancelUnlockHold = useCallback(() => {
    clearTimeout(unlockTimer.current);
    setUnlockHeld(false);
  }, []);

  const handleLogout = () => {
    clearInterval(timerRef.current);
    cancelAnimationFrame(dwellRAF.current);
    if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(t => t.stop());
    logout();
    toast.success('Logged out');
    navigate('/login');
  };

  const formatTime = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  /* First-try accuracy, the figure a therapist actually needs: letters solved
     without a wrong attempt. The old percentage counted every keypress, so a
     miss followed by a correction still contributed a success. */
  const accuracyPct = realtimeMetrics.accuracy != null
    ? Math.round(realtimeMetrics.accuracy * 100)
    : (score.total > 0 ? Math.round((score.perfect / score.total) * 100) : 0);
  const nextSlotIdx = slots.findIndex(s => s.letter === null);
  const nextCorrectLetter = currentWord && nextSlotIdx !== -1 ? currentWord[nextSlotIdx] : null;
  const isDwelling = dwellProgress > 0 && isTracking;
  const dwellSeconds = ((DWELL_BY_DIFFICULTY[difficulty] ?? DWELL_MS) / 1000).toFixed(1);
  const isPaused = phase === 'paused';
  const fmtMetric = (v, f) => (v == null ? '—' : f(v));

  // ── Build dynamic keyboard (PRD: letters always include target word + distractors) ──
  const dynamicKeyboard = React.useMemo(
    () => buildDynamicKeyboard(currentWord, visibleKeyCount),
    [currentWord, visibleKeyCount]
  );
  // For sentence mode, add a SPACE button on the last row
  const keyboardLayout = React.useMemo(() => {
    if ((isSentenceMode || isSelfExpression) && visibleKeyCount >= 26) {
      const rows = dynamicKeyboard.map(r => [...r]);
      // Add space bar to last row (before backspace)
      const lastRow = rows[rows.length - 1];
      const bsIdx = lastRow.indexOf('⌫');
      if (bsIdx >= 0) lastRow.splice(bsIdx, 0, '␣');
      else lastRow.push('␣');
      return rows;
    }
    return dynamicKeyboard;
  }, [dynamicKeyboard, isSentenceMode, isSelfExpression, visibleKeyCount]);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={styles.root} className="gp-root">
      {/* Touch-mode upper-body observation. In camera mode the hand/face
          tracker already owns the webcam, so `active` is gated on touch mode;
          nothing starts until the consent prompt is answered with a yes.
          See components/game/TouchModePose. */}
      <TouchModePose
        ref={poseRef}
        gameId="letterquest"
        active={isTouchMode && phase === 'playing'}
        finished={phase === 'ending'}
        sessionId={activeSession?.id || null}
        childId={learnerId}
        learnerName={profile?.first_name}
      />

      {/* ── Calibration gate ─────────────────────────────────────────────
          Rendered as a full-screen OVERLAY rather than in place of the game.
          The <video> MediaPipe is bound to lives in the left panel below and
          must stay mounted: replacing this whole subtree would hand the Camera
          helper a fresh, empty video element and hand tracking would stop the
          moment the game began. Nothing underneath is live in the meantime —
          there is no session, no timer, and the dwell loop returns early on any
          phase other than 'playing'. */}
      {phase === 'calibration' && !isTouchMode && (
        <CalibrationScreen
          sourceVideoRef={videoRef}
          cameraError={cameraError}
          isTracking={isTracking}
          handCount={handCount}
          rawCursorRef={rawCursorRef}
          coverageCells={coverageCells}
          coverageTarget={coverageTarget}
          calibrationProgress={calibrationProgress}
          calibrationStatus={calibrationStatus}
          trackingConfidence={trackingConfidence}
          fps={fps}
          distanceFactor={distanceFactor}
          faceDetected={!!faceLandmarks}
          recalibrate={recalibrate}
          finalizeCalibration={finalizeCalibration}
          onReady={handleCalibrated}
          onExit={() => navigate('/play')}
          learnerName={profile?.first_name || profile?.full_name}
          difficultyLabel={DIFFICULTY_LABELS[difficulty]}
          savedCalibration={savedCalibration}
          onUseSaved={handleUseSavedCalibration}
          onSwitchToTouch={handleSwitchInputMode}
        />
      )}

      {/* ── Celebration overlay ───────────────────────────────────────── */}
      <AnimatePresence>
        {showSuperAnim && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={styles.superOverlay}>
            <motion.div
              initial={{ scale: 0, rotate: -30 }} animate={{ scale: reducedMotion ? 1 : [0, 1.2, 1], rotate: 0 }}
              transition={{ type: 'spring', damping: 10, stiffness: 100 }} style={styles.superContent}
            >
              <div style={{ fontSize: '5rem', filter: 'drop-shadow(0 0 30px rgba(255,215,0,0.8))' }}>✨ 🎉 ⭐</div>
              <div style={styles.superText}>{encouragementText}</div>
            </motion.div>
            {/* Twenty spring-animated particles are exactly what a child with a
                vestibular or attention profile should not be shown. */}
            {!reducedMotion && Array.from({ length: 20 }).map((_, i) => (
              <motion.div key={i}
                initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
                animate={{ x: (Math.random() - .5) * 800, y: (Math.random() - .5) * 600, scale: Math.random() * 2 + .5, opacity: 0, rotate: Math.random() * 360 }}
                transition={{ duration: 2.5, ease: 'easeOut' }}
                style={{ position: 'absolute', fontSize: '2rem', zIndex: 999 }}
              >
                {['🌟', '🎈', '🎊', '✨', '🏆'][i % 5]}
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Pause overlay ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {isPaused && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={styles.pauseOverlay}
          >
            <div style={styles.pauseCard}>
              <div style={{ fontSize: '3rem' }}>⏸️</div>
              <div style={styles.pauseTitle}>Paused</div>
              <div style={styles.pauseSub}>
                The clock is stopped. Nothing is recorded while paused.
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button onClick={handlePause} style={styles.pausePrimary}>
                  <Play size={15} /> Resume
                </button>
                <button onClick={() => navigate('/play')} style={styles.pauseGhost}>
                  <Home size={15} /> Leave
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Dwell cursor ──────────────────────────────────────────────────
          Positioned by direct DOM writes from the RAF loop rather than by
          React state, so following the finger no longer re-renders every key
          on the board sixty times a second. */}
      {!isTouchMode && isTracking && (
        <div ref={cursorElRef} style={styles.cursorOuter}>
          <DwellCursor ringRef={ringElRef} hovering={!!hoveredKey} />
        </div>
      )}

      {/* ── TOP BAR — settings, above the three panels ─────────────────── */}
      {/* Mobile Settings Toggle Button */}
      <button
        className="mobile-settings-btn"
        onClick={() => setShowMobileSettings(!showMobileSettings)}
      >
        {showMobileSettings ? <X size={18} /> : <Settings size={18} />}
        {showMobileSettings ? 'Close Settings' : 'Game Settings'}
      </button>

      {/* ── Modern Control Bar (Live Settings - Single Line Premium) ── */}
      <div className={`gp-control-bar ${showMobileSettings ? 'mobile-visible' : 'mobile-hidden'}`} style={{
        width: '100%', maxWidth: '100%', margin: '0 auto', flex: '0 0 auto',
        background: 'rgba(13, 26, 29, 0.6)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.06)', borderRadius: 18,
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        /* Dimmed while locked, so it reads as "not for you" to the child
           without hiding the current settings from the adult. */
        opacity: settingsUnlocked ? 1 : 0.55,
      }}>
        {/* Parent lock — these controls restart the session, and they sit
            within reach of a child who is pointing at the screen. */}
        <button
          onMouseDown={startUnlockHold} onMouseUp={cancelUnlockHold} onMouseLeave={cancelUnlockHold}
          onTouchStart={startUnlockHold} onTouchEnd={cancelUnlockHold}
          title={settingsUnlocked ? 'Lock again' : 'Hold 1.5 s to unlock'}
          style={{
            ...styles.lockBtn,
            background: settingsUnlocked ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.12)',
            border: `1px solid ${settingsUnlocked ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.3)'}`,
            color: settingsUnlocked ? '#10B981' : '#EF4444',
            transform: unlockHeld ? 'scale(0.94)' : 'scale(1)',
          }}
        >
          {settingsUnlocked ? <Unlock size={12} /> : <Lock size={12} />}
          {settingsUnlocked ? 'Open' : unlockHeld ? 'Holding…' : 'Parent'}
        </button>

        <div className="divider" style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.08)' }} />

        {/* Input mode — deliberately OUTSIDE the parent lock. A child whose arm
            is tired, or whose camera has just dropped out, needs this now; it
            is an accessibility control, not a setting, and unlike the controls
            to its right it changes nothing about the exercise's content. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', opacity: 1 }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Input</span>
          <div style={styles.modeToggle}>
            <motion.button
              onClick={() => { if (isTouchMode) handleSwitchInputMode(); }}
              whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.92 }}
              title="Select by holding your finger in the air"
              style={{
                ...styles.modeToggleBtn,
                background: !isTouchMode ? '#0D5E6B' : 'transparent',
                color: !isTouchMode ? '#fff' : '#9CA3AF',
                boxShadow: !isTouchMode ? '0 2px 8px rgba(13,94,107,0.4)' : 'none',
              }}>
              <Video size={12} /> Hand in air
            </motion.button>
            <motion.button
              onClick={() => { if (!isTouchMode) handleSwitchInputMode(); }}
              whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.92 }}
              title="Tap the keys directly — no camera"
              style={{
                ...styles.modeToggleBtn,
                background: isTouchMode ? '#8B5CF6' : 'transparent',
                color: isTouchMode ? '#fff' : '#9CA3AF',
                boxShadow: isTouchMode ? '0 2px 8px rgba(139,92,246,0.4)' : 'none',
              }}>
              <Hand size={12} /> Touch
            </motion.button>
          </div>
        </div>

        <div className="divider" style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.08)' }} />

        {/* Level */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Mode</span>
          <div style={{ display: 'flex', background: 'rgba(0,0,0,0.4)', borderRadius: 12, padding: 4, boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)' }}>
            {['easy', 'medium'].map(lvl => {
              const isActive = difficulty === lvl;
              return (
                <motion.button key={lvl} onClick={() => handleSettingChange('difficulty', lvl)}
                  disabled={!settingsUnlocked}
                  whileHover={{ scale: settingsUnlocked ? 1.05 : 1 }} whileTap={{ scale: settingsUnlocked ? 0.92 : 1 }}
                  style={{
                    padding: '4px 12px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 700, border: 'none', cursor: settingsUnlocked ? 'pointer' : 'not-allowed', transition: 'all 0.25s',
                    background: isActive ? '#0D5E6B' : 'transparent', color: isActive ? '#fff' : '#9CA3AF',
                    boxShadow: isActive ? '0 2px 8px rgba(13,94,107,0.4)' : 'none'
                  }}>
                  {lvl === 'easy' ? 'Easy' : 'Medium'}
                </motion.button>
              );
            })}
          </div>
        </div>

        <div className="divider" style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.08)' }} />

        {/* Complex */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Advanced</span>
          <div style={{ display: 'flex', background: 'rgba(0,0,0,0.4)', borderRadius: 12, padding: 4, boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)' }}>
            {[
              { k: 'complex_words', l: 'Words' },
              { k: 'complex_sentences', l: 'Phrases' },
              { k: 'self_expression', l: 'Free Talk' }
            ].map(lvl => {
              const isActive = difficulty === lvl.k;
              return (
                <motion.button key={lvl.k} onClick={() => handleSettingChange('difficulty', lvl.k)}
                  disabled={!settingsUnlocked}
                  whileHover={{ scale: settingsUnlocked ? 1.05 : 1 }} whileTap={{ scale: settingsUnlocked ? 0.92 : 1 }}
                  style={{
                    padding: '4px 12px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 700, border: 'none', cursor: settingsUnlocked ? 'pointer' : 'not-allowed', transition: 'all 0.25s',
                    background: isActive ? '#8B5CF6' : 'transparent', color: isActive ? '#fff' : '#9CA3AF',
                    boxShadow: isActive ? '0 2px 8px rgba(139,92,246,0.4)' : 'none'
                  }}>
                  {lvl.l}
                </motion.button>
              );
            })}
          </div>
        </div>

        <div className="divider" style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.08)' }} />

        {/* Key Size */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Keys</span>
          <div style={{ display: 'flex', background: 'rgba(0,0,0,0.4)', borderRadius: 12, padding: 4, boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)' }}>
            {['big', 'medium', 'standard'].map(size => {
              const isActive = keyboardSize === size;
              return (
                <motion.button key={size} onClick={() => handleSettingChange('keyboardSize', size)}
                  disabled={!settingsUnlocked}
                  whileHover={{ scale: settingsUnlocked ? 1.05 : 1 }} whileTap={{ scale: settingsUnlocked ? 0.92 : 1 }}
                  style={{
                    padding: '4px 12px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 700, border: 'none', cursor: settingsUnlocked ? 'pointer' : 'not-allowed', transition: 'all 0.25s',
                    background: isActive ? '#E8841A' : 'transparent', color: isActive ? '#fff' : '#9CA3AF',
                    boxShadow: isActive ? '0 2px 8px rgba(232,132,26,0.4)' : 'none'
                  }}>
                  {size === 'standard' ? 'Std (26)' : size.charAt(0).toUpperCase() + size.slice(1)}
                </motion.button>
              );
            })}
          </div>
        </div>

        <div className="divider" style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.08)' }} />

        {/* Text to Speech */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Speech</span>
          <div style={{ display: 'flex', background: 'rgba(0,0,0,0.4)', borderRadius: 12, padding: 4, boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)' }}>
            <motion.button
              whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.92 }}
              onClick={() => setTtsEnabled(!ttsEnabled)}
              style={{
                /* Speech is not destructive — it stays available to the child. */
                padding: '4px 12px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 700, border: 'none', cursor: 'pointer', transition: 'all 0.25s',
                background: ttsEnabled ? '#10B981' : 'transparent', color: ttsEnabled ? '#fff' : '#9CA3AF',
                boxShadow: ttsEnabled ? '0 2px 8px rgba(16,185,129,0.4)' : 'none',
                display: 'flex', alignItems: 'center', gap: 4
              }}>
              {ttsEnabled ? <Volume2 size={12} style={{ marginRight: 2 }} /> : <VolumeX size={12} style={{ marginRight: 2 }} />}
              {ttsEnabled ? 'On' : 'Off'}
            </motion.button>
          </div>
        </div>
      </div>

      {/* ── PANELS ───────────────────────────────────────────────────── */}
      <div className="gp-panels">

      {/* ── LEFT PANEL ───────────────────────────────────────────────── */}
      <div style={styles.leftPanel} className="gp-left">
        <div style={styles.cameraBox} className="camera-box">
          {/* Touch mode never opened a camera, so there is nothing to show —
              and a black rectangle where a webcam feed used to be reads as a
              fault. The panel says what the mode is instead. */}
          {isTouchMode ? (
            <div style={styles.touchPanel}>
              <Hand size={30} style={{ opacity: 0.85, color: '#8B5CF6' }} />
              <div style={{ fontWeight: 800, marginTop: 10, color: '#E0F2FE' }}>Touch mode</div>
              <div style={{ fontSize: '0.76rem', color: '#9CA3AF', marginTop: 4, lineHeight: 1.45 }}>
                Tap the keys directly.<br />The camera is off.
              </div>
              <button onClick={handleSwitchInputMode} style={styles.modeSwitchBtn}>
                <Video size={13} /> Switch to hand in air
              </button>
            </div>
          ) : cameraError ? (
            <div style={styles.cameraError}>
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>📷</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Camera unavailable</div>
              <div style={{ fontSize: '0.8rem', color: '#9CA3AF' }}>Allow camera access for hand tracking.</div>
            </div>
          ) : (
            <>
              <video ref={videoRef} autoPlay muted playsInline style={styles.video} />
              {/* Canvas mains — effacé à chaque frame */}
              <canvas ref={canvasRef} width={640} height={360} style={styles.canvas} />
              {/* Canvas visage — persistant, jamais effacé par les mains */}
              <canvas
                ref={faceCanvasRef}
                width={640} height={360}
                style={{
                  ...styles.canvas,
                  pointerEvents: 'none',
                }}
              />
              {isTracking && (
                <div style={styles.trackingBadge}>
                  <span style={{
                    ...styles.trackingDot,
                    background: trackingConfidence > 75 ? '#10B981' : trackingConfidence > 45 ? '#F59E0B' : '#EF4444'
                  }} />
                  {calibrationStatus === 'Calibrating...' ? 'Calibrating...' : `Tracking (${trackingConfidence}%)`}
                </div>
              )}
              <motion.div
                style={styles.dwellBadge}
                animate={{
                  background: isDwelling
                    ? `rgba(34,211,238,${0.3 + dwellProgress * 0.5})`
                    : 'rgba(0,0,0,0.55)'
                }}
              >
                {isDwelling
                  ? `${Math.round(dwellProgress * 100)}% — Hold still!`
                  : hoveredKey ? `Key: ${hoveredKey}` : '☝️ Point at a key'
                }
              </motion.div>

              {/* Auto-calibration overlay. Shown whenever calibration is
                  running -- including when NO hand is visible, which is the
                  case that used to leave the child staring at a still screen
                  with no idea what was expected of them. */}
              {calibrationStatus === 'Calibrating...' && (
                <div style={{
                  position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                  background: 'rgba(15, 30, 34, 0.78)', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', zIndex: 10,
                  backdropFilter: 'blur(4px)'
                }}>
                  <div style={{ fontSize: '1.6rem', marginBottom: 8, animation: 'spin 3s linear infinite' }}>
                    {isTracking ? '🔄' : '✋'}
                  </div>
                  <div style={{ fontWeight: 800, color: '#22d3ee', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {isTracking ? 'Calibrating' : 'Waiting for your hand'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#9CA3AF', marginTop: 4, textAlign: 'center', padding: '0 12px' }}>
                    {isTracking
                      ? 'Move your hand slowly around the whole area you can reach'
                      : 'Hold your open hand in front of the camera'}
                  </div>
                  {/* The bar follows the real measurement. It used to be a
                      fixed 3-second animation that filled up and finished even
                      when nothing had been measured at all. */}
                  <div style={{ width: '60%', height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2, marginTop: 10, overflow: 'hidden' }}>
                    <motion.div
                      animate={{ width: `${Math.round((calibrationProgress || 0) * 100)}%` }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                      style={{ height: '100%', background: '#22d3ee' }}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Live metrics */}
        <div style={styles.metricsPanel}>
          <div style={{ ...styles.metricsPanelTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            Live Metrics
            <div style={styles.levelBadgeMini}>Level {learnerLevel}</div>
          </div>
          <div style={styles.metricsGrid}>
            {[
              { label: 'First-try accuracy', value: `${accuracyPct}%`, color: accuracyPct > 75 ? '#10B981' : '#F59E0B' },
              { label: 'Avg speed', value: fmtMetric(realtimeMetrics.avgResponseTime, v => `${(v / 1000).toFixed(1)}s`), color: '#22d3ee' },
              { label: 'Smoothness', value: fmtMetric(realtimeMetrics.smoothness, v => `${Math.round(v * 100)}%`), color: '#8B5CF6' },
              { label: 'Time', value: formatTime(sessionTime), color: '#E8841A' },
            ].map(m => (
              <div key={m.label} style={styles.metricItem}>
                <div style={{ ...styles.metricValue, color: m.color }}>{m.value}</div>
                <div style={styles.metricLabel}>{m.label}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: '0.72rem', color: '#9CA3AF' }}>Fatigue</span>
              <span style={{ fontSize: '0.72rem', color: '#9CA3AF' }}>
                {fmtMetric(realtimeMetrics.fatigue, v => `${Math.round(v * 100)}%`)}
              </span>
            </div>
            <div style={styles.fatigueBar}>
              <div style={{
                ...styles.fatigueFill, width: `${(realtimeMetrics.fatigue ?? 0) * 100}%`,
                background: (realtimeMetrics.fatigue ?? 0) > 0.6 ? '#EF4444' : (realtimeMetrics.fatigue ?? 0) > 0.35 ? '#F59E0B' : '#10B981'
              }} />
            </div>
          </div>

          {/* Tracking Telemetry Dashboard — camera mode only. In touch mode
              every figure here (frame rate, gaze, calibration, tracking
              confidence) describes a camera that is switched off; showing
              stale or zeroed values would read as a broken session. */}
          {!isTouchMode && (
          <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 12 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#0D5E6B', marginBottom: 8 }}>
              Camera tracking
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
              <div>
                <div style={{ fontSize: '0.62rem', color: '#9CA3AF', textTransform: 'uppercase' }}>FPS</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#22d3ee' }}>{fps} FPS</div>
              </div>
              <div>
                <div style={{ fontSize: '0.62rem', color: '#9CA3AF', textTransform: 'uppercase' }}>Gaze Status</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: gazeDetected ? '#10B981' : '#EF4444' }}>
                  {gazeDetected ? 'Focused' : 'Looking Away'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.62rem', color: '#9CA3AF', textTransform: 'uppercase' }}>Calibration</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: calibrationStatus === 'Calibrated' ? '#10B981' : '#F59E0B' }}>
                  {calibrationStatus === 'Calibrated' ? 'Calibrated' : 'Calibrating'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.62rem', color: '#9CA3AF', textTransform: 'uppercase' }}>Confidence</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: trackingConfidence > 75 ? '#10B981' : trackingConfidence > 45 ? '#F59E0B' : '#EF4444' }}>
                  {trackingConfidence}%
                </div>
              </div>
            </div>
            {/* Always available. It used to be hidden unless a hand was being
                tracked -- so a parent whose cursor was stuck in a corner had
                no way to start over. */}
            {(phase === 'playing' || phase === 'paused') && (
              <button
                onClick={handleRecalibrate}
                style={{
                  marginTop: 10, width: '100%', padding: '6px 12px', borderRadius: 8,
                  background: 'rgba(13,94,107,0.2)', border: '1px solid rgba(13,94,107,0.4)',
                  color: '#22d3ee', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                Recalibrate 🔄
              </button>
            )}
            <button onClick={handleSwitchInputMode} style={{ ...styles.modeSwitchBtn, width: '100%', marginTop: 8 }}>
              <Hand size={13} /> Switch to touch
            </button>
          </div>
          )}
        </div>

        {/* ── Saved Messages (Moved to Left Panel so keyboard doesn't move) ── */}
        {isSelfExpression && savedMessages.length > 0 && (
          <div style={{ ...seStyles.savedSection, marginTop: 16 }}>
            <div style={{ ...seStyles.savedTitle, color: '#fff' }}>Saved Messages ({savedMessages.length})</div>
            <div style={{ ...seStyles.savedList, maxHeight: '250px' }}>
              {savedMessages.map(msg => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  style={{ ...seStyles.savedItem, background: 'rgba(0,0,0,0.4)', borderColor: 'rgba(255,255,255,0.1)' }}
                >
                  <div style={{ ...seStyles.savedText, color: '#E5E7EB' }}>{msg.text}</div>
                  <div style={seStyles.savedBottom}>
                    <span style={{ ...seStyles.savedTime, color: '#9CA3AF' }}>{msg.timestamp}</span>
                    <button
                      onClick={() => handleSpeak(msg.text)}
                      style={{ ...seStyles.reSpeakBtn, background: 'rgba(255,255,255,0.1)' }}
                      title="Speak this message"
                    >
                      🔊
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* ── CENTER PANEL ─────────────────────────────────────────────── */}
      <div style={styles.centerPanel} className="gp-center">

        <AnimatePresence mode="wait">

          {/* ── SELF EXPRESSION MODE ───────────────────────────── */}
          {phase === 'playing' && isSelfExpression && (
            <motion.div key="self-expression" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="gp-selfexp"
              style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: 680, margin: '0 auto' }}>

              {/* Header */}
              <div style={seStyles.header} className="gp-se-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: '1.8rem' }}>💬</span>
                  <div>
                    <div style={seStyles.title}>Self Expression</div>
                    <div style={seStyles.subtitle}>Type freely — no prompts, no score. Express yourself!</div>
                  </div>
                </div>
                <span style={seStyles.betaBadge}>BETA</span>
              </div>

              {/* Text area */}
              <div style={seStyles.textareaWrapper} className="gp-se-editor">
                <textarea
                  ref={textareaRef}
                  value={freeText}
                  onChange={e => setFreeText(e.target.value)}
                  placeholder="Type anything you want to say…"
                  style={seStyles.textarea}
                  rows={5}
                  autoFocus
                />
                <div style={seStyles.charCount}>{freeText.length} characters</div>
              </div>

              {/* Action buttons */}
              <div style={seStyles.actions} className="gp-se-actions">
                <motion.button
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={() => handleSpeak()}
                  disabled={isSpeaking}
                  style={{
                    ...seStyles.btn,
                    ...seStyles.btnSpeak,
                    opacity: isSpeaking ? 0.6 : 1,
                  }}
                >
                  {isSpeaking ? (
                    <><span style={seStyles.speakingDot} /> Speaking…</>
                  ) : (
                    <>🔊 Speak</>
                  )}
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={handleSaveMessage}
                  style={{ ...seStyles.btn, ...seStyles.btnSave }}
                >
                  💾 Save
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={handleClearCanvas}
                  style={{ ...seStyles.btn, ...seStyles.btnClear }}
                >
                  🗑️ Clear
                </motion.button>
              </div>
              {/* Tip */}
              <div style={seStyles.tip} className="gp-se-tip">
                💡 No time limit. Express yourself freely. Use <strong>Speak</strong> to hear your words aloud.
              </div>
            </motion.div>
          )}

          {/* ── NORMAL GAME MODE ──────────────────────────────── */}
          {phase === 'playing' && !isSelfExpression && (
            <motion.div key="playing" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>

              {/* Progress bar */}
              <div style={styles.progressionContainer} className="gp-progress">
                <div style={styles.progressionText}>Words: {wordsCompleted} / {TARGET_WORDS}</div>
                <div style={styles.progressionBarBg}>
                  <div style={{ ...styles.progressionBarFill, width: `${(wordsCompleted / TARGET_WORDS) * 100}%` }} />
                </div>
              </div>

              {/* Word card */}
              <div style={styles.wordCard} className="word-card">
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                  <div className="word-emoji" style={{ filter: 'drop-shadow(0 10px 15px rgba(0,0,0,0.3))' }}>
                    {WORD_IMAGES[currentWord] || '❓'}
                  </div>
                  {isSpeaking && (
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: [1, 1.2, 1], opacity: 1 }}
                      transition={{ repeat: Infinity, duration: 1 }}
                      style={{
                        background: 'rgba(16, 185, 129, 0.15)',
                        border: '1px solid rgba(16, 185, 129, 0.4)',
                        borderRadius: '50%',
                        width: 36,
                        height: 36,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#10B981',
                        boxShadow: '0 0 12px rgba(16, 185, 129, 0.3)',
                      }}
                    >
                      <Volume2 size={18} />
                    </motion.div>
                  )}
                </div>
                {/* Target word/phrase display */}
                <div style={styles.targetTextContainer} className="gp-target-text">
                  {currentWord.split('').map((char, idx) => {
                    const isSpace = char === ' ';
                    const isCorrect = slots[idx]?.correct;

                    if (isSpace) {
                      return (
                        <span
                          key={`target-space-${idx}`}
                          style={{ width: '16px', display: 'inline-block' }}
                        />
                      );
                    }

                    return (
                      <motion.span
                        key={`target-letter-${idx}-${char}`}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{
                          scale: isCorrect ? [1.15, 1] : 1,
                          opacity: 1
                        }}
                        transition={{ duration: 0.25 }}
                        style={{
                          ...styles.targetLetter,
                          ...(isCorrect ? styles.targetLetterTyped : styles.targetLetterRemaining)
                        }}
                      >
                        {char}
                      </motion.span>
                    );
                  })}
                </div>
                {nextCorrectLetter && (
                  <div style={styles.nextLetterHint} className="gp-hint">
                    {isTouchMode ? (
                      <>Tap{' '}
                        <span style={{ color: '#10B981', fontWeight: 800 }}>{nextCorrectLetter}</span>
                        <span style={{ opacity: 0.5, marginLeft: 6, fontSize: '0.75rem' }}>(the green key)</span>
                      </>
                    ) : (
                      <>Point &amp; hold on{' '}
                        <span style={{ color: '#10B981', fontWeight: 800 }}>{nextCorrectLetter}</span>
                        {' '}for {dwellSeconds} s
                        <span style={{ opacity: 0.5, marginLeft: 6, fontSize: '0.75rem' }}>(the green key)</span>
                      </>
                    )}
                  </div>
                )}

                {/* Letter slots */}
                <div style={styles.slotsContainer} className="gp-slots">
                  {currentWord.split('').map((char, i) => {
                    const slot = slots[i] || { letter: null, correct: false };
                    const filled = slot.letter !== null;
                    const correct = slot.correct;
                    const isSpaceSlot = char === ' ';

                    // Space slots in sentences show as thin separators
                    if (isSpaceSlot) {
                      return (
                        <div
                          key={`slot-${i}-${currentWord}`}
                          style={{
                            width: 30, height: 60,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          <div style={{
                            width: filled && correct ? 20 : 10,
                            height: filled && correct ? 4 : 2,
                            background: filled && correct ? '#10B981' : 'rgba(34,211,238,0.3)',
                            borderRadius: 2,
                            boxShadow: filled && correct ? '0 0 10px #10B981' : 'none',
                            transition: 'all 0.3s ease'
                          }} />
                        </div>
                      );
                    }

                    const isFlashing = wrongFlash?.idx === i;
                    return (
                      <motion.div
                        key={`slot-${i}-${currentWord}`}
                        ref={el => slotRefs.current[i] = el}
                        /* A wrong letter shakes, then clears itself — it no
                           longer stays in the slot and locks the word. */
                        animate={isFlashing && !reducedMotion ? { x: [-4, 4, -4, 4, 0] } : {}}
                        transition={{ duration: 0.3 }}
                        style={{
                          ...styles.slot,
                          ...(filled && correct ? styles.slotCorrect : {}),
                          ...(filled && !correct ? styles.slotWrong : {}),
                          ...(!filled ? styles.slotEmpty : {}),
                        }}
                        className="slot"
                      >
                        {filled ? slot.letter : (
                          <span style={{ fontSize: '0.75rem', color: 'rgba(34,211,238,0.35)', fontWeight: 400 }}>{i + 1}</span>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}

          {phase === 'ending' && (
            <motion.div key="ending" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={styles.processingBanner}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              <div>Analysing your session…</div>
              <div style={{ fontSize: '0.8rem', color: '#C8E8ED', marginTop: 4 }}>The AI is processing your motor patterns</div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dynamic keyboard — SHARED ACROSS MODES */}
        {phase === 'playing' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{
              ...styles.letterBoard,
              /* The size preset the child picked, handed to CSS so it can be
                 capped against the viewport height instead of overflowing. */
              '--kb-key-w': `${kbCfg.keyW}px`,
              '--kb-key-h': `${kbCfg.keyH}px`,
              '--kb-bs-w': `${kbCfg.bsW}px`,
              '--kb-font': kbCfg.fontSize,
              '--kb-gap': `${kbCfg.gap}px`,
              '--kb-row-gap': `${kbCfg.rowGap}px`,
            }} ref={boardElRef} className="letter-board">
            {keyboardLayout.map((row, ri) => (
              <div key={ri} style={styles.letterRow} className="letter-row">
                {row.map(letter => {
                  // Space key maps to actual space character
                  const displayLetter = letter;
                  const actualChar = letter === '␣' ? ' ' : letter;
                  const isNextCorrect = actualChar === nextCorrectLetter || (letter === '␣' && nextCorrectLetter === ' ');
                  const isHovered = hoveredKey === letter;
                  const dwellingOnThis = isHovered && isDwelling;
                  const isBackspace = letter === '⌫';
                  const isSpace = letter === '␣';

                  return (
                    <motion.button
                      key={letter}
                      ref={el => keyRefs.current[letter] = el}
                      /* onPointerDown, not onClick: it covers mouse, pen and
                         touch in one handler and fires on contact rather than
                         on release, which is the difference between a key that
                         feels responsive and one that feels late. The gesture
                         is tagged as a tap so the session report never mixes
                         it with a dwell selection. */
                      onPointerDown={(e) => {
                        if (phase !== 'playing' || showSuperAnim) return;
                        e.preventDefault();
                        lastInputSource.current = 'touch';
                        if (letter === '⌫') handleDeleteLetter();
                        else handleTypeLetter(actualChar);
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                      disabled={phase === 'ending' || showSuperAnim}
                      animate={{
                        scale: dwellingOnThis ? 1.08 : isHovered ? 1.03 : 1,
                        boxShadow: isNextCorrect
                          ? '0 0 30px rgba(16,185,129,0.9), 0 0 8px rgba(16,185,129,0.5)'
                          : dwellingOnThis
                            ? '0 0 28px rgba(34,211,238,0.9)'
                            : isHovered
                              ? '0 0 14px rgba(34,211,238,0.4)'
                              : '0 4px 12px rgba(0,0,0,0.2)',
                      }}
                      style={{
                        ...styles.letterKey,
                        ...(isBackspace ? styles.letterKeyBackspace : {}),
                        ...(isSpace ? { background: 'rgba(139,92,246,0.08)', border: '2px solid rgba(139,92,246,0.22)', color: '#8B5CF6', letterSpacing: '0.08em' } : {}),
                        ...(isHovered ? styles.letterKeyHovered : {}),
                        ...(isNextCorrect ? styles.letterKeyCorrect : {}),
                        ...(dwellingOnThis ? styles.letterKeyDwelling : {}),
                        opacity: (phase === 'ending' || showSuperAnim) ? 0.5 : 1,
                      }}
                      className={`letter-key${isBackspace ? ' is-backspace' : ''}${isSpace ? ' is-space' : ''}`}
                    >
                      {isSpace ? 'SPACE' : displayLetter}

                      {/* Bottom-fill animation while dwelling */}
                      {dwellingOnThis && (
                        <div style={{
                          position: 'absolute', bottom: 0, left: 0, right: 0,
                          height: `${dwellProgress * 100}%`,
                          background: 'rgba(34,211,238,0.2)',
                          borderRadius: '0 0 12px 12px',
                          transition: 'height 0.1s linear',
                          pointerEvents: 'none',
                        }} />
                      )}

                      {/* Pulsing dot under correct key */}
                      {isNextCorrect && (
                        <motion.div
                          style={styles.correctDot}
                          animate={{ opacity: [0.5, 1, 0.5], scale: [0.8, 1.1, 0.8] }}
                          transition={{ repeat: Infinity, duration: 1.2 }}
                        />
                      )}
                    </motion.button>
                  );
                })}
              </div>
            ))}
          </motion.div>
        )}

        {/* Controls */}
        <div style={styles.controls} className="gp-controls">
          <button onClick={handlePause} style={styles.skipBtn}>
            <Pause size={13} style={{ verticalAlign: -2, marginRight: 5 }} />Pause
          </button>
          <button onClick={handleSkipWord} style={styles.skipBtn}>Skip word →</button>
          <button onClick={handleEndSession} disabled={processing} style={styles.endBtn}>
            {processing ? 'Processing…' : 'End session'}
          </button>
        </div>

      </div>

      {/* ── RIGHT PANEL ──────────────────────────────────────────────── */}
      <div style={styles.rightPanel} className="gp-right">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={styles.scoreTitle}>Session score</div>
          <button onClick={handleLogout} style={styles.logoutBtn} title="Sign out"><LogOut size={13} /></button>
        </div>

        {/* Accuracy ring */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <svg viewBox="0 0 120 120" style={{ width: 100, height: 100 }}>
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(200,232,237,0.15)" strokeWidth="8" />
            <circle cx="60" cy="60" r="52" fill="none" stroke="#E8841A" strokeWidth="8"
              strokeDasharray={`${2 * Math.PI * 52}`}
              strokeDashoffset={`${2 * Math.PI * 52 * (1 - accuracyPct / 100)}`}
              strokeLinecap="round" transform="rotate(-90 60 60)"
              style={{ transition: 'stroke-dashoffset 0.6s ease' }}
            />
            <text x="60" y="66" textAnchor="middle"
              style={{ fontFamily: 'Inter,sans-serif', fontWeight: 800, fontSize: '1.4rem', fill: '#0D5E6B' }}>
              {accuracyPct}%
            </text>
          </svg>
          <div style={{ fontSize: '0.75rem', color: '#6B7280' }}>First-try accuracy</div>
        </div>

        {/* Score breakdown */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 16 }}>
          {[
            { label: 'Correct ✅', count: score.perfect, color: '#10B981' },
            { label: 'Errors ❌', count: score.failed, color: '#EF4444' },
            /* Self-corrections and skips were recorded nowhere at all — a
               child who skipped every word scored the same as one who tried. */
            { label: 'Corrections ⌫', count: corrections, color: '#F59E0B' },
            { label: 'Words skipped →', count: wordsSkipped, color: '#8B5CF6' },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span style={{ fontSize: '0.8rem', color: '#6B7280' }}>{s.label}</span>
              <span style={{ fontFamily: 'Inter,sans-serif', fontWeight: 700, color: s.color }}>{s.count}</span>
            </div>
          ))}
        </div>

        {/* Interaction guide */}
        <div style={styles.interactionGuide}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#0D5E6B', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.1em' }}>How to play</div>
          {(isTouchMode ? [
            { icon: '👆', label: 'Tap a key' },
            { icon: '⚡', label: 'The letter is taken right away' },
            { icon: '⌫', label: 'Tap ⌫ to delete' },
            { icon: '🟢', label: 'Green key = next letter' },
            { icon: '✋', label: 'You can switch back to hand in air' },
          ] : [
            { icon: '☝️', label: 'Point at a key with your index finger' },
            { icon: '⏱️', label: `Hold ${dwellSeconds} s = select` },
            { icon: '↕️', label: 'Moving to another key resets it' },
            { icon: '⌫', label: `Hold ⌫ ${dwellSeconds} s to delete` },
            { icon: '👆', label: 'A direct tap works too' },
          ]).map((g, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.73rem', color: '#9CA3AF', padding: '3px 0' }}>
              <span style={{ fontSize: '0.95rem' }}>{g.icon}</span>{g.label}
            </div>
          ))}
        </div>

        {/* Last gesture feedback */}
        {lastGesture && (
          <AnimatePresence mode="wait">
            <motion.div
              key={`${lastGesture.letter}-${lastGesture.result}`}
              initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              style={{ ...styles.gestureFeedback, background: lastGesture.result === 'Perfect' ? '#D1FAE5' : '#FEE2E2' }}
            >
              <div style={{ fontSize: '1.4rem' }}>{lastGesture.result === 'Perfect' ? '✅' : '❌'}</div>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#1F2937' }}>{lastGesture.letter} — {lastGesture.result}</div>
            </motion.div>
          </AnimatePresence>
        )}
        </div>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = {
  /* Height, not min-height: the play screen is one viewport and never scrolls.
     The <1100px stylesheet switches this back to a scrolling column. */
  /* A column now: the settings bar sits above the three panels, which share
     the rest. Height, not min-height — the play screen never scrolls. */
  root: { display: 'flex', flexDirection: 'column', height: '100dvh', minHeight: 0, background: '#0F1E22', overflow: 'hidden', position: 'relative' },

  superOverlay: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(15,30,34,0.82)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 },
  superContent: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, zIndex: 2001 },
  superText: { fontFamily: 'Inter,sans-serif', fontWeight: 900, fontSize: '4rem', background: 'linear-gradient(135deg,#FCD34D,#F59E0B)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' },

  /* Dwell cursor. `left`/`top` stay at 0 and the RAF loop writes a transform,
     so moving the cursor never touches React state or triggers layout. */
  cursorOuter: {
    position: 'fixed',
    left: 0, top: 0,
    zIndex: 9999,
    pointerEvents: 'none',
    willChange: 'transform',
    transform: 'translate3d(-300px, -300px, 0)',
  },

  // Pause
  pauseOverlay: {
    position: 'absolute', inset: 0, zIndex: 2500,
    background: 'rgba(11,22,24,0.86)', backdropFilter: 'blur(10px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  pauseCard: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
    padding: '32px 44px', borderRadius: 22, textAlign: 'center', maxWidth: 420,
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
  },
  pauseTitle: {
    fontFamily: 'Inter,sans-serif', fontWeight: 900, fontSize: '1.7rem', color: '#E0F2FE',
  },
  pauseSub: { fontSize: '0.85rem', color: '#9CA3AF', lineHeight: 1.5 },
  pausePrimary: {
    display: 'flex', alignItems: 'center', gap: 7, padding: '11px 24px',
    borderRadius: 12, border: 'none', color: '#fff', fontWeight: 800, fontSize: '0.9rem',
    background: 'linear-gradient(135deg,#059669,#10B981)', cursor: 'pointer',
  },
  pauseGhost: {
    display: 'flex', alignItems: 'center', gap: 7, padding: '11px 20px',
    borderRadius: 12, background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.12)', color: '#9CA3AF',
    fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
  },
  lockBtn: {
    display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px',
    borderRadius: 9, fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer',
    transition: 'all 0.2s', whiteSpace: 'nowrap',
  },

  // Input mode
  touchPanel: {
    padding: 20, textAlign: 'center',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
  },
  modeSwitchBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 14, padding: '7px 14px', borderRadius: 9,
    background: 'rgba(139,92,246,0.14)', border: '1px solid rgba(139,92,246,0.35)',
    color: '#A78BFA', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  modeToggle: {
    display: 'flex', background: 'rgba(0,0,0,0.4)', borderRadius: 12, padding: 4,
    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)',
  },
  modeToggleBtn: {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '4px 11px', borderRadius: 8, border: 'none',
    fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
    transition: 'all 0.25s', whiteSpace: 'nowrap',
  },

  // Left panel
  leftPanel: { width: 300, minHeight: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(255,255,255,0.07)', zIndex: 10, background: '#0D1A1D' },
  cameraBox: { width: '100%', aspectRatio: '16 / 9', background: '#0D1A1D', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  video: { width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' },
  canvas: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', pointerEvents: 'none' },
  cameraError: { padding: 24, textAlign: 'center', color: '#9CA3AF' },
  trackingBadge: { position: 'absolute', top: 10, right: 10, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.6)', padding: '4px 10px', borderRadius: 99, fontSize: '0.72rem', color: '#10B981' },
  trackingDot: { display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#10B981' },
  dwellBadge: { position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', padding: '5px 14px', borderRadius: 99, fontSize: '0.74rem', color: '#fff', fontWeight: 700, whiteSpace: 'nowrap' },

  metricsPanel: { padding: '16px', background: '#0D1A1D', borderTop: '1px solid rgba(255,255,255,0.07)' },
  metricsPanelTitle: { fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#0D5E6B', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid rgba(13,94,107,0.1)' },
  levelBadgeMini: { background: 'linear-gradient(135deg,#1A8FA0,#14B8A6)', color: 'white', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: '800' },
  metricsGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  metricItem: { textAlign: 'center' },
  metricValue: { fontFamily: 'Inter,sans-serif', fontWeight: 800, fontSize: '1.2rem' },
  metricLabel: { fontSize: '0.68rem', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em' },
  fatigueBar: { height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' },
  fatigueFill: { height: '100%', borderRadius: 3, transition: 'width 0.4s ease,background 0.4s ease' },

  // Center panel
  /* min-height:0 is what lets this column shrink below its content, so the
     keyboard can give height back instead of pushing the page taller. */
  centerPanel: { flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10 },

  progressionContainer: { width: '100%', maxWidth: 560 },
  progressionText: { fontFamily: 'Inter,sans-serif', fontSize: '0.85rem', color: '#C8E8ED', fontWeight: 700, marginBottom: 8, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.08em' },
  progressionBarBg: { height: 10, background: 'rgba(255,255,255,0.1)', borderRadius: 5, overflow: 'hidden' },
  progressionBarFill: { height: '100%', background: 'linear-gradient(90deg,#E8841A,#F59E0B)', borderRadius: 5, transition: 'width 0.5s ease' },

  wordCard: { display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 24, boxShadow: '0 12px 40px rgba(0,0,0,0.2)' },
  targetTextContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '6px',
    marginTop: '14px',
    marginBottom: '10px',
    flexWrap: 'wrap',
  },
  targetLetter: {
    fontFamily: "'Inter', sans-serif",
    fontSize: '2.2rem',
    fontWeight: '800',
    textTransform: 'uppercase',
    transition: 'all 0.3s ease',
    padding: '0 2px',
  },
  targetLetterTyped: {
    color: '#10B981',
    textShadow: '0 0 10px rgba(16, 185, 129, 0.3)',
    opacity: 0.5,
  },
  targetLetterRemaining: {
    color: '#E0F2FE',
    textShadow: '0 2px 6px rgba(0,0,0,0.5)',
  },
  nextLetterHint: { fontSize: '0.82rem', color: 'rgba(255,255,255,0.5)', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 20, padding: '5px 16px' },

  slotsContainer: { display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center' },
  slot: { display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 14, fontFamily: 'Inter,sans-serif', fontWeight: 800, color: '#C8E8ED', transition: 'all 0.2s ease' },
  slotEmpty: { background: 'rgba(34,211,238,0.04)', border: '2px dashed rgba(34,211,238,0.35)', boxShadow: '0 0 16px rgba(34,211,238,0.06)' },
  slotCorrect: { background: 'rgba(16,185,129,0.15)', border: '2px solid #10B981', color: '#10B981', boxShadow: '0 0 18px rgba(16,185,129,0.4)' },
  slotWrong: { background: 'rgba(239,68,68,0.12)', border: '2px solid #EF4444', color: '#EF4444' },

  // Keyboard
  /* Gaps and key sizes now come from GamePage.css, driven by the --kb-*
     custom properties set on the board, so they can be capped against the
     window height. Nothing size-related belongs in these objects. */
  letterBoard: { display: 'flex', flexDirection: 'column' },
  letterRow: { display: 'flex', justifyContent: 'center' },
  letterKey: {
    position: 'relative',
    /* Touch mode is a real input path now: no 300 ms tap delay, no text
       selection on a long press, no iOS tap highlight flashing over the key. */
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
    WebkitUserSelect: 'none',
    background: 'rgba(255,255,255,0.07)',
    border: '2px solid rgba(255,255,255,0.14)',
    borderRadius: 14,
    color: '#C8E8ED',
    fontFamily: 'Inter, sans-serif', fontWeight: 700,
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    userSelect: 'none', overflow: 'hidden',
    transition: 'background 0.12s, border 0.12s',
  },
  letterKeyBackspace: { background: 'rgba(239,68,68,0.08)', border: '2px solid rgba(239,68,68,0.22)', color: '#EF4444' },
  letterKeyHovered: { background: 'rgba(34,211,238,0.13)', border: '2px solid rgba(34,211,238,0.45)' },
  letterKeyCorrect: { background: 'rgba(16,185,129,0.22)', border: '2px solid #10B981', color: '#10B981', boxShadow: '0 0 24px rgba(16,185,129,0.55)' },
  letterKeyDwelling: { background: 'rgba(34,211,238,0.18)', border: '2px solid #22d3ee' },
  correctDot: { position: 'absolute', bottom: 5, left: '50%', transform: 'translateX(-50%)', width: 6, height: 6, borderRadius: '50%', background: '#10B981' },

  processingBanner: { background: 'rgba(13,94,107,0.4)', border: '1px solid rgba(13,94,107,0.6)', borderRadius: 16, padding: '24px 40px', textAlign: 'center', color: '#C8E8ED', fontWeight: 600 },

  controls: { display: 'flex', gap: 12, marginTop: 4 },
  skipBtn: { padding: '10px 20px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, color: '#9CA3AF', fontFamily: 'Inter,sans-serif', fontWeight: 500, fontSize: '0.875rem', cursor: 'pointer' },
  endBtn: { padding: '10px 24px', background: '#EF4444', border: 'none', borderRadius: 10, color: '#fff', fontFamily: 'Inter,sans-serif', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer' },

  // Right panel
  rightPanel: { width: 220, minHeight: 0, overflow: 'hidden', background: '#0D1A1D', borderLeft: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 10 },
  scoreTitle: { fontFamily: 'Inter,sans-serif', fontWeight: 700, fontSize: '0.8rem', color: '#C8E8ED', textTransform: 'uppercase', letterSpacing: '0.08em' },
  logoutBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, color: '#6B7280', cursor: 'pointer' },
  interactionGuide: { width: '100%', background: 'rgba(13,94,107,0.15)', border: '1px solid rgba(13,94,107,0.25)', borderRadius: 12, padding: '12px' },
  gestureFeedback: { width: '100%', borderRadius: 10, padding: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginTop: 'auto' },
};

// ── Self Expression Mode Styles ──────────────────────────────────────────────
const seStyles = {
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', padding: '16px 20px',
    background: 'linear-gradient(135deg, rgba(14,165,233,0.08), rgba(139,92,246,0.06))',
    border: '1px solid rgba(14,165,233,0.18)',
    borderRadius: 16,
  },
  title: {
    fontFamily: 'Inter, sans-serif', fontWeight: 800,
    fontSize: '1.2rem', color: '#E0F2FE',
  },
  subtitle: {
    fontSize: '0.78rem', color: '#93C5FD', marginTop: 2,
  },
  betaBadge: {
    fontSize: '0.55rem', fontWeight: 800, letterSpacing: '0.12em',
    background: 'linear-gradient(135deg, #F59E0B, #D97706)',
    color: '#fff', padding: '3px 8px', borderRadius: 12,
    textTransform: 'uppercase', flexShrink: 0,
  },

  textareaWrapper: {
    width: '100%', position: 'relative',
  },
  textarea: {
    width: '100%', boxSizing: 'border-box',
    padding: '20px 22px',
    background: 'rgba(255,255,255,0.06)',
    border: '2px solid rgba(14,165,233,0.25)',
    borderRadius: 16,
    color: '#E0F2FE',
    fontFamily: "'Inter', sans-serif",
    fontSize: '1.15rem', fontWeight: 500,
    lineHeight: 1.7,
    resize: 'none',
    outline: 'none',
    transition: 'border-color 0.2s ease',
  },
  charCount: {
    position: 'absolute', bottom: 10, right: 16,
    fontSize: '0.68rem', color: 'rgba(148,163,184,0.5)',
    fontWeight: 600,
  },

  actions: {
    display: 'flex', gap: 10, width: '100%', flexWrap: 'wrap',
  },
  btn: {
    flex: 1, minWidth: 100,
    padding: '14px 18px',
    border: 'none', borderRadius: 14,
    fontFamily: "'Inter', sans-serif",
    fontWeight: 700, fontSize: '0.92rem',
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    transition: 'all 0.15s',
  },
  btnSpeak: {
    background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
    color: '#fff',
    boxShadow: '0 4px 16px rgba(13,94,107,0.4)',
  },
  btnSave: {
    background: 'linear-gradient(135deg, #059669, #10B981)',
    color: '#fff',
    boxShadow: '0 4px 16px rgba(16,185,129,0.3)',
  },
  btnClear: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: '#9CA3AF',
  },
  speakingDot: {
    display: 'inline-block', width: 8, height: 8,
    borderRadius: '50%', background: '#22D3EE',
    animation: 'pulse 1s infinite',
  },

  savedSection: {
    width: '100%',
  },
  savedTitle: {
    fontFamily: 'Inter, sans-serif', fontWeight: 700,
    fontSize: '0.78rem', color: '#93C5FD',
    textTransform: 'uppercase', letterSpacing: '0.08em',
    marginBottom: 10,
  },
  savedList: {
    display: 'flex', flexDirection: 'column', gap: 8,
    maxHeight: 200, overflowY: 'auto',
    scrollbarWidth: 'thin',
  },
  savedItem: {
    padding: '12px 16px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12,
  },
  savedText: {
    color: '#E0F2FE', fontSize: '0.95rem',
    fontFamily: "'Inter', sans-serif", fontWeight: 500,
    lineHeight: 1.5, marginBottom: 6,
    wordBreak: 'break-word',
  },
  savedBottom: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  savedTime: {
    fontSize: '0.68rem', color: '#64748B',
  },
  reSpeakBtn: {
    background: 'rgba(14,165,233,0.12)',
    border: '1px solid rgba(14,165,233,0.2)',
    borderRadius: 8,
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: '0.85rem',
    transition: 'all 0.15s',
  },

  tip: {
    fontSize: '0.78rem', color: '#64748B',
    textAlign: 'center', lineHeight: 1.5,
  },
};
