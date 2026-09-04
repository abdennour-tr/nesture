/**
 * TraceTypeGame.jsx
 * Main game page for Trace → Find → Type.
 *
 * Flow: Countdown → Per-letter cycle (Trace → Find → Type) → Session Results
 *
 * Each letter goes through 3 steps:
 *   1. TRACE — trace the letter on an SVG canvas using index finger (MediaPipe)
 *   2. FIND  — find and tap the letter on the virtual QWERTY keyboard
 *   3. TYPE  — type the letter 3 times independently (no highlights)
 *
 * Uses useHandTracking for MediaPipe camera/model and useTextToSpeech for
 * letter pronunciation. Integrates session API for progress tracking.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LogOut, Volume2, VolumeX, Clock, ArrowLeft, Pause, Play,
  RotateCcw, Home, ChevronRight, CheckCircle, Info, Sun, Moon,
  Hand, MousePointer2
} from 'lucide-react';
import useHandTracking from '../hooks/useHandTracking';
import { useTextToSpeech } from '../hooks/useTextToSpeech';
import { soundManager } from '../utils/soundManager';
import { useAuthStore, useSessionStore } from '../store';
import api from '../services/api';
import '../styles/TraceTypeGame.css';

// ── Constants ──────────────────────────────────────────────────────────────
const COUNTDOWN_SECONDS = 3;
const TYPE_REQUIRED      = 3;   // Must type the letter 3 times
const TRACE_WAYPOINT_RADIUS = 25; // px radius to count as "reached"
const POINTS_PER_STEP    = 10;

// ── Letters per level ──────────────────────────────────────────────────────
const LEVEL_LETTERS = {
  1: 'LVXTIFEH'.split(''), // Simple straight lines, fewer points
  2: 'AMNKOPUYZCD'.split(''), // Moderate complexity, simple curves or angled lines
  3: 'QSRGJWB'.split(''), // High complexity, multiple curves or strokes
};

// Explicitly mark waypoint connections that are "jumps" (i.e. moving to a new stroke)
// where a segment line should NOT be drawn.
const BAD_JUMPS = {
  A: [3], // Jump from bottom right leg to the start of the crossbar
  Q: [9], // Jump from the O ring to the start of the tail
  X: [2], // Jump from bottom right of first stroke to top right of second stroke
};

// ── Encouraging messages pool ──────────────────────────────────────────────
const ENCOURAGEMENTS = [
  '⭐ Great Job!',  '🎉 Excellent!',   '✨ Amazing!',
  '🏆 Champion!',   '💪 Perfect!',     '🌟 Wonderful!',
  '🚀 Incredible!', '💎 Superstar!',
];

// ── Tips ───────────────────────────────────────────────────────────────────
const TIPS = [
  '💡 Go slow, be accurate, and use your index finger!',
  '💡 Follow the numbered dots in order for best results.',
  '💡 Listen to the letter sound to remember it better!',
  '💡 Take your time on the keyboard — accuracy beats speed!',
  '💡 Try saying the letter out loud as you trace it.',
];

// ── QWERTY Layout ──────────────────────────────────────────────────────────
const QWERTY_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
];

// ── SVG Letter Path Data ───────────────────────────────────────────────────
// Each letter has waypoints [{x, y}] for tracing in a 300×300 canvas,
// and a d path string for the guide outline.
const LETTER_DATA = {
  A: {
    waypoints: [
      { x: 50, y: 260 },   { x: 150, y: 40 },  { x: 250, y: 260 },
      { x: 200, y: 170 },  { x: 100, y: 170 },
    ],
    path: 'M50,260 L150,40 L250,260 M100,170 L200,170',
  },
  B: {
    waypoints: [
      { x: 70, y: 40 },   { x: 190, y: 60 },   { x: 190, y: 130 },
      { x: 70, y: 150 },  { x: 210, y: 170 },  { x: 210, y: 240 },
      { x: 70, y: 260 },  { x: 70, y: 40 },
    ],
    path: 'M70,40 L70,260 M70,40 Q230,40 230,100 Q230,150 70,150 Q240,150 240,210 Q240,260 70,260',
  },
  C: {
    waypoints: [
      { x: 230, y: 80 },   { x: 150, y: 55 },   { x: 70, y: 100 },
      { x: 60, y: 150 },   { x: 70, y: 210 },   { x: 150, y: 245 },
      { x: 230, y: 230 },
    ],
    path: 'M230,80 Q150,20 70,80 Q40,150 70,220 Q150,280 230,230',
  },
  D: {
    waypoints: [
      { x: 70, y: 40 },   { x: 215, y: 70 },   { x: 260, y: 150 },
      { x: 215, y: 230 },  { x: 70, y: 260 },   { x: 70, y: 40 },
    ],
    path: 'M70,40 L70,260 M70,40 Q260,40 260,150 Q260,260 70,260',
  },
  E: {
    waypoints: [
      { x: 210, y: 40 },  { x: 70, y: 40 },   { x: 70, y: 150 },
      { x: 180, y: 150 }, { x: 70, y: 150 },   { x: 70, y: 260 },
      { x: 210, y: 260 },
    ],
    path: 'M210,40 L70,40 L70,260 L210,260 M70,150 L180,150',
  },
  F: {
    waypoints: [
      { x: 210, y: 40 },  { x: 70, y: 40 },   { x: 70, y: 150 },
      { x: 180, y: 150 }, { x: 70, y: 150 },   { x: 70, y: 260 },
    ],
    path: 'M210,40 L70,40 L70,260 M70,150 L180,150',
  },
  G: {
    waypoints: [
      { x: 230, y: 80 },   { x: 150, y: 40 },   { x: 70, y: 100 },
      { x: 60, y: 150 },   { x: 70, y: 210 },   { x: 150, y: 260 },
      { x: 230, y: 220 },  { x: 230, y: 160 },  { x: 170, y: 160 },
    ],
    path: 'M230,80 Q150,20 70,80 Q40,150 70,220 Q150,280 230,220 L230,160 L170,160',
  },
  H: {
    waypoints: [
      { x: 70, y: 40 },   { x: 70, y: 260 },
      { x: 70, y: 150 },  { x: 230, y: 150 },
      { x: 230, y: 40 },  { x: 230, y: 260 },
    ],
    path: 'M70,40 L70,260 M230,40 L230,260 M70,150 L230,150',
  },
  I: {
    waypoints: [
      { x: 100, y: 40 },  { x: 200, y: 40 },
      { x: 150, y: 40 },  { x: 150, y: 260 },
      { x: 100, y: 260 }, { x: 200, y: 260 },
    ],
    path: 'M100,40 L200,40 M150,40 L150,260 M100,260 L200,260',
  },
  J: {
    waypoints: [
      { x: 120, y: 40 },  { x: 220, y: 40 },
      { x: 190, y: 40 },  { x: 190, y: 210 },
      { x: 150, y: 260 }, { x: 80, y: 230 },
    ],
    path: 'M120,40 L220,40 M190,40 L190,210 Q190,270 120,250 Q80,240 80,220',
  },
  K: {
    waypoints: [
      { x: 70, y: 40 },   { x: 70, y: 260 },
      { x: 70, y: 160 },  { x: 220, y: 40 },
      { x: 70, y: 160 },  { x: 220, y: 260 },
    ],
    path: 'M70,40 L70,260 M220,40 L70,160 L220,260',
  },
  L: {
    waypoints: [
      { x: 70, y: 40 },   { x: 70, y: 260 },  { x: 220, y: 260 },
    ],
    path: 'M70,40 L70,260 L220,260',
  },
  M: {
    waypoints: [
      { x: 50, y: 260 },  { x: 50, y: 40 },   { x: 150, y: 160 },
      { x: 250, y: 40 },  { x: 250, y: 260 },
    ],
    path: 'M50,260 L50,40 L150,160 L250,40 L250,260',
  },
  N: {
    waypoints: [
      { x: 70, y: 260 },  { x: 70, y: 40 },   { x: 230, y: 260 },
      { x: 230, y: 40 },
    ],
    path: 'M70,260 L70,40 L230,260 L230,40',
  },
  O: {
    waypoints: [
      { x: 150, y: 40 },  { x: 70, y: 80 },   { x: 50, y: 150 },
      { x: 70, y: 220 },  { x: 150, y: 260 },  { x: 230, y: 220 },
      { x: 250, y: 150 }, { x: 230, y: 80 },   { x: 150, y: 40 },
    ],
    path: 'M150,40 Q50,40 50,150 Q50,260 150,260 Q250,260 250,150 Q250,40 150,40 Z',
  },
  P: {
    waypoints: [
      { x: 70, y: 260 },  { x: 70, y: 40 },   { x: 180, y: 50 },
      { x: 220, y: 100 }, { x: 180, y: 150 },  { x: 70, y: 160 },
    ],
    path: 'M70,260 L70,40 Q240,40 240,100 Q240,160 70,160',
  },
  Q: {
    waypoints: [
      { x: 150, y: 40 },  { x: 70, y: 80 },   { x: 50, y: 150 },
      { x: 70, y: 220 },  { x: 150, y: 260 },  { x: 230, y: 220 },
      { x: 250, y: 150 }, { x: 230, y: 80 },   { x: 150, y: 40 },
      { x: 200, y: 210 }, { x: 260, y: 270 },
    ],
    path: 'M150,40 Q50,40 50,150 Q50,260 150,260 Q250,260 250,150 Q250,40 150,40 Z M200,210 L260,270',
  },
  R: {
    waypoints: [
      { x: 70, y: 260 },  { x: 70, y: 40 },   { x: 180, y: 50 },
      { x: 220, y: 100 }, { x: 180, y: 150 },  { x: 70, y: 160 },
      { x: 140, y: 160 }, { x: 230, y: 260 },
    ],
    path: 'M70,260 L70,40 Q240,40 240,100 Q240,160 70,160 M140,160 L230,260',
  },
  S: {
    waypoints: [
      { x: 220, y: 70 },  { x: 160, y: 40 },   { x: 80, y: 70 },
      { x: 70, y: 110 },  { x: 150, y: 150 },   { x: 230, y: 190 },
      { x: 220, y: 230 }, { x: 150, y: 260 },   { x: 70, y: 230 },
    ],
    path: 'M220,70 Q150,20 80,70 Q50,120 150,150 Q250,180 220,230 Q170,280 70,230',
  },
  T: {
    waypoints: [
      { x: 50, y: 40 },   { x: 250, y: 40 },
      { x: 150, y: 40 },  { x: 150, y: 260 },
    ],
    path: 'M50,40 L250,40 M150,40 L150,260',
  },
  U: {
    waypoints: [
      { x: 70, y: 40 },   { x: 70, y: 200 },  { x: 100, y: 245 },
      { x: 150, y: 260 }, { x: 200, y: 245 },  { x: 230, y: 200 },
      { x: 230, y: 40 },
    ],
    path: 'M70,40 L70,200 Q70,270 150,270 Q230,270 230,200 L230,40',
  },
  V: {
    waypoints: [
      { x: 50, y: 40 },   { x: 150, y: 260 },  { x: 250, y: 40 },
    ],
    path: 'M50,40 L150,260 L250,40',
  },
  W: {
    waypoints: [
      { x: 30, y: 40 },   { x: 90, y: 260 },   { x: 150, y: 120 },
      { x: 210, y: 260 }, { x: 270, y: 40 },
    ],
    path: 'M30,40 L90,260 L150,120 L210,260 L270,40',
  },
  X: {
    waypoints: [
      { x: 60, y: 40 },   { x: 240, y: 260 },
      { x: 240, y: 40 },  { x: 60, y: 260 },
    ],
    path: 'M60,40 L240,260 M240,40 L60,260',
  },
  Y: {
    waypoints: [
      { x: 50, y: 40 },   { x: 150, y: 150 },
      { x: 250, y: 40 },  { x: 150, y: 150 },  { x: 150, y: 260 },
    ],
    path: 'M50,40 L150,150 L250,40 M150,150 L150,260',
  },
  Z: {
    waypoints: [
      { x: 60, y: 40 },   { x: 240, y: 40 },   { x: 60, y: 260 },
      { x: 240, y: 260 },
    ],
    path: 'M60,40 L240,40 L60,260 L240,260',
  },
};

// ── Confetti component ─────────────────────────────────────────────────────
function Confetti({ show }) {
  if (!show) return null;
  const colors = ['#6366F1', '#8B5CF6', '#EC4899', '#10B981', '#F59E0B', '#3B82F6'];
  const pieces = Array.from({ length: 35 }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    color: colors[i % colors.length],
    delay: `${Math.random() * 0.8}s`,
    size: 6 + Math.random() * 8,
    rotation: Math.random() * 360,
  }));

  return (
    <>
      {pieces.map((p) => (
        <div
          key={p.id}
          className="tt-confetti-piece"
          style={{
            left: p.left,
            background: p.color,
            animationDelay: p.delay,
            width: p.size,
            height: p.size,
            borderRadius: Math.random() > 0.5 ? '50%' : '2px',
            transform: `rotate(${p.rotation}deg)`,
          }}
        />
      ))}
    </>
  );
}

// ── Virtual Keyboard Component ─────────────────────────────────────────────
function VirtualKeyboard({ targetLetter, onKeyPress, highlightTarget, keyStates }) {
  return (
    <div className="tt-keyboard">
      {QWERTY_ROWS.map((row, ri) => (
        <div key={ri} className="tt-keyboard-row">
          {row.map((key) => {
            const state = keyStates[key] || '';
            const isHighlighted = highlightTarget && key === targetLetter;
            return (
              <motion.button
                key={key}
                data-key={key}
                className={`tt-key ${isHighlighted ? 'highlighted' : ''} ${state}`}
                onClick={() => onKeyPress(key)}
                whileTap={{ scale: 0.92 }}
                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
              >
                {key}
              </motion.button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
export default function TraceTypeGame() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const level = parseInt(searchParams.get('level') || '1', 10);
  const letters = useMemo(() => LEVEL_LETTERS[level] || LEVEL_LETTERS[1], [level]);

  // ── Auth & Session ──────────────────────────────────────────────────────
  const { user, profile } = useAuthStore();
  const { startSession: storeStartSession, endSession: storeEndSession } = useSessionStore();
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [gameStartTime, setGameStartTime] = useState(null);
  const [sessionSaved, setSessionSaved] = useState(false);

  // ── Game State ──────────────────────────────────────────────────────────
  const [gamePhase, setGamePhase]       = useState('inputSelection'); // inputSelection | waiting | playing | letterSuccess | results
  const [inputMethod, setInputMethod]   = useState(null); // 'camera' | 'touch' | null
  const [countdown, setCountdown]       = useState(0);
  const [currentLetterIdx, setCurrentLetterIdx] = useState(0);
  const [step, setStep]                 = useState('trace'); // trace | find | type
  const [score, setScore]               = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isLightMode, setIsLightMode]   = useState(false);
  const [isPaused, setIsPaused]         = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [encourageMsg, setEncourageMsg] = useState('');
  const [feedbackMsg, setFeedbackMsg]   = useState(null); // { text, type: 'success'|'error', points }
  const [tip, setTip]                   = useState(TIPS[0]);

  // ── Hand Tracking refs ──────────────────────────────────────────────────
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  // Keep camera initialized continuously during gameplay to prevent "Initializing..." hangs
  const trackingEnabled = inputMethod === 'camera' && (gamePhase === 'waiting' || gamePhase === 'playing' || gamePhase === 'countdown' || gamePhase === 'letterSuccess') && !isPaused;
  // Keep camera processing active during all phases for hand-tracking virtual keyboard
  const pauseProcessing = false;

  const {
    landmarks,
    isTracking,
    error: trackingError,
  } = useHandTracking(videoRef, canvasRef, trackingEnabled, pauseProcessing, 1);

  // ── TTS ─────────────────────────────────────────────────────────────────
  const { speak } = useTextToSpeech(true);

  // ── Timer ───────────────────────────────────────────────────────────────
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef(null);

  // ── Per-letter metrics ──────────────────────────────────────────────────
  const [letterMetrics, setLetterMetrics] = useState({});
  const letterStartTimeRef = useRef(Date.now());

  // ── Trace state ─────────────────────────────────────────────────────────
  const [reachedWaypoints, setReachedWaypoints] = useState([]);
  const [traceProgress, setTraceProgress]       = useState(0);
  const [fingerPos, setFingerPos]               = useState(null);
  const [isDrawing, setIsDrawing]               = useState(false);
  const traceAreaRef = useRef(null);

  // ── Global Pointer state (Find & Type) ──────────────────────────────────
  const [globalPointer, setGlobalPointer] = useState(null);
  const hoverTargetRef = useRef(null);
  const hoverStartTimeRef = useRef(null);

  // ── Find state ──────────────────────────────────────────────────────────
  const [keyStates, setKeyStates] = useState({});
  const [findStartTime, setFindStartTime] = useState(null);
  const [keyTaps, setKeyTaps]     = useState(0);

  // ── Type state ──────────────────────────────────────────────────────────
  const [typedCount, setTypedCount]   = useState(0);
  const [typeStartTime, setTypeStartTime] = useState(null);

  // ── Session-level stats ─────────────────────────────────────────────────
  const [sessionStats, setSessionStats] = useState({
    totalScore: 0,
    lettersCompleted: 0,
    totalStars: 0,
    tracingAccuracies: [],
    findTimes: [],
    typingAccuracies: [],
  });

  // ── Star ratings per letter ─────────────────────────────────────────────
  const [starRatings, setStarRatings] = useState({});

  // ── Current letter ──────────────────────────────────────────────────────
  const currentLetter = letters[currentLetterIdx];
  const letterData = LETTER_DATA[currentLetter] || LETTER_DATA.A;

  // ── Session API: start ──────────────────────────────────────────────────
  useEffect(() => {
    if (!currentSessionId && gamePhase === 'playing') {
      const learnerId = profile?.learner_id || user?.id || '00000000-0000-0000-0000-000000000010';
      const diff = level === 1 ? 'easy' : level === 2 ? 'medium' : 'hard';
      setGameStartTime(Date.now());
      api.post('/sessions/start', {
        learner_id: learnerId,
        difficulty: diff,
        game_name: 'Trace Find Type',
      }).then((res) => {
        const sid = res.data?.session_id;
        if (sid) {
          setCurrentSessionId(sid);
          storeStartSession(sid, learnerId, diff);
        }
      }).catch((err) => console.warn('[TraceTypeGame] Could not start session:', err));
    }
  }, [gamePhase, currentSessionId, level, profile, user, storeStartSession]);

  // ── Session API: end ────────────────────────────────────────────────────
  useEffect(() => {
    if (gamePhase === 'results' && currentSessionId && !sessionSaved) {
      setSessionSaved(true);
      const durationSeconds = Math.max(1, Math.round((Date.now() - (gameStartTime || Date.now())) / 1000));
      const avgAcc = sessionStats.tracingAccuracies.length > 0
        ? Math.round(sessionStats.tracingAccuracies.reduce((a, b) => a + b, 0) / sessionStats.tracingAccuracies.length)
        : 100;

      api.post('/sessions/end', {
        session_id: currentSessionId,
        duration_seconds: durationSeconds,
        accuracy_score: parseFloat((avgAcc / 100).toFixed(2)),
        accuracy: avgAcc,
        perfect_grabs: sessionStats.lettersCompleted,
        total_attempts: letters.length,
        game_name: 'Trace Find Type',
      }).then(() => {
        storeEndSession({
          duration: durationSeconds,
          accuracy: avgAcc,
          perfectGrabs: sessionStats.lettersCompleted,
        });
      }).catch((err) => console.error('[TraceTypeGame] Failed to save session:', err));
    }
  }, [gamePhase, currentSessionId, sessionSaved, sessionStats, letters.length, gameStartTime, storeEndSession]);

  // ── Global timer ────────────────────────────────────────────────────────
  useEffect(() => {
    if (gamePhase === 'playing' && !isPaused) {
      timerRef.current = setInterval(() => setElapsedTime((t) => t + 1), 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [gamePhase, isPaused]);

  // ── Speak letter on step change ─────────────────────────────────────────
  useEffect(() => {
    if (gamePhase === 'playing' && currentLetter && soundEnabled) {
      speak(currentLetter);
    }
  }, [currentLetterIdx, step, gamePhase]);

  // ── Update tip periodically ─────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      setTip(TIPS[Math.floor(Math.random() * TIPS.length)]);
    }, 12000);
    return () => clearInterval(interval);
  }, []);

  // ── Init sound manager ──────────────────────────────────────────────────
  useEffect(() => {
    soundManager.init();
  }, []);

  // ── Format time ─────────────────────────────────────────────────────────
  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  // ══════════════════════════════════════════════════════════════════════════
  // TRACE Phase Logic
  // ══════════════════════════════════════════════════════════════════════════



  // ══════════════════════════════════════════════════════════════════════════
  // FIND Phase Logic
  // ══════════════════════════════════════════════════════════════════════════

  const handleFindKeyPress = useCallback((key) => {
    if (step !== 'find' || gamePhase !== 'playing' || isPaused) return;

    setKeyTaps((t) => t + 1);

    if (key === currentLetter) {
      setKeyStates((prev) => ({ ...prev, [key]: 'correct' }));
      if (soundEnabled) soundManager.playProgress();
      const findTime = findStartTime ? (Date.now() - findStartTime) / 1000 : 1;
      handleStepComplete('find', { findTime, keyTaps: keyTaps + 1 });
    } else {
      setKeyStates((prev) => ({ ...prev, [key]: 'wrong' }));
      if (soundEnabled) soundManager.playOffPath();
      setTimeout(() => setKeyStates((prev) => ({ ...prev, [key]: '' })), 600);
    }
  }, [step, gamePhase, isPaused, currentLetter, findStartTime, keyTaps, soundEnabled]);

  // ══════════════════════════════════════════════════════════════════════════
  // TYPE Phase Logic
  // ══════════════════════════════════════════════════════════════════════════

  const handleTypeKeyPress = useCallback((key) => {
    if (step !== 'type' || gamePhase !== 'playing' || isPaused) return;

    if (key === currentLetter) {
      const newCount = typedCount + 1;
      setTypedCount(newCount);
      setKeyStates((prev) => ({ ...prev, [key]: 'correct' }));
      if (soundEnabled) soundManager.playProgress();
      setTimeout(() => setKeyStates((prev) => ({ ...prev, [key]: '' })), 400);

      if (newCount >= TYPE_REQUIRED) {
        const typeTime = typeStartTime ? (Date.now() - typeStartTime) / 1000 : 3;
        handleStepComplete('type', { typeTime, accuracy: 100 });
      }
    } else {
      setKeyStates((prev) => ({ ...prev, [key]: 'wrong' }));
      if (soundEnabled) soundManager.playOffPath();
      setTimeout(() => setKeyStates((prev) => ({ ...prev, [key]: '' })), 600);
    }
  }, [step, gamePhase, isPaused, currentLetter, typedCount, typeStartTime, soundEnabled]);

  // ══════════════════════════════════════════════════════════════════════════
  // GLOBAL POINTER Logic (Find & Type)
  // ══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if ((step !== 'find' && step !== 'type') || gamePhase !== 'playing' || isPaused) {
      setGlobalPointer(null);
      hoverTargetRef.current = null;
      hoverStartTimeRef.current = null;
      return;
    }
    if (!landmarks || landmarks.length < 9) {
      setGlobalPointer(null);
      return;
    }

    const indexTip = landmarks[8];
    if (!indexTip) return;

    // Map to viewport
    const sx = (1 - indexTip.x) * window.innerWidth;
    const sy = indexTip.y * window.innerHeight;

    let hoverKey = null;
    let clickProgress = 0;

    // Find if we are hovering a key
    const element = document.elementFromPoint(sx, sy);
    if (element) {
      const key = element.getAttribute('data-key');
      if (key) {
        hoverKey = key;
        if (hoverTargetRef.current !== key) {
          hoverTargetRef.current = key;
          hoverStartTimeRef.current = Date.now();
        } else {
          const elapsed = Date.now() - hoverStartTimeRef.current;
          clickProgress = Math.min(elapsed / 1500, 1);
          if (clickProgress >= 1) {
            // Trigger click
            if (step === 'find') handleFindKeyPress(key);
            if (step === 'type') handleTypeKeyPress(key);
            // Reset to prevent rapid multi-clicks
            hoverStartTimeRef.current = Date.now() + 500; 
            clickProgress = 0;
          }
        }
      }
    }
    
    if (!hoverKey) {
      hoverTargetRef.current = null;
      hoverStartTimeRef.current = null;
    }

    setGlobalPointer({ x: sx, y: sy, hoverKey, clickProgress });
  }, [landmarks, step, gamePhase, isPaused, handleFindKeyPress, handleTypeKeyPress]);

  // ══════════════════════════════════════════════════════════════════════════
  // Step Completion Handler
  // ══════════════════════════════════════════════════════════════════════════

  const handleStepComplete = useCallback((completedStep, metrics = {}) => {
    const points = POINTS_PER_STEP;
    setScore((s) => s + points);

    // Show feedback
    const stepName = completedStep === 'trace' ? 'Great tracing!' :
                     completedStep === 'find'  ? `You found ${currentLetter}!` :
                                                 'Nice typing!';
    setFeedbackMsg({ text: `✅ ${stepName}`, type: 'success', points });
    setTimeout(() => setFeedbackMsg(null), 2000);

    // Store per-letter metrics
    setLetterMetrics((prev) => ({
      ...prev,
      [currentLetter]: {
        ...(prev[currentLetter] || {}),
        [completedStep]: metrics,
      },
    }));

    // Transition to next step
    if (completedStep === 'trace') {
      setTimeout(() => {
        setStep('find');
        setKeyStates({});
        setFindStartTime(Date.now());
        setKeyTaps(0);
      }, 800);
    } else if (completedStep === 'find') {
      setTimeout(() => {
        setStep('type');
        setKeyStates({});
        setTypedCount(0);
        setTypeStartTime(Date.now());
      }, 800);
    } else if (completedStep === 'type') {
      // Letter complete!
      const starsEarned = 3; // simplified: always 3 stars on completion
      setStarRatings((prev) => ({ ...prev, [currentLetter]: starsEarned }));

      setSessionStats((prev) => ({
        ...prev,
        totalScore: prev.totalScore + POINTS_PER_STEP * 3,
        lettersCompleted: prev.lettersCompleted + 1,
        totalStars: prev.totalStars + starsEarned,
        tracingAccuracies: [...prev.tracingAccuracies, metrics.accuracy || 90],
      }));

      // Show letter success overlay
      setEncourageMsg(ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)]);
      setShowConfetti(true);
      if (soundEnabled) soundManager.playComplete();
      setGamePhase('letterSuccess');

      setTimeout(() => {
        setShowConfetti(false);
        if (currentLetterIdx + 1 < letters.length) {
          // Next letter
          setCurrentLetterIdx((i) => i + 1);
          setStep('trace');
          setReachedWaypoints([]);
          setTraceProgress(0);
          setFingerPos(null);
          setKeyStates({});
          setTypedCount(0);
          letterStartTimeRef.current = Date.now();
          setGamePhase('playing');
        } else {
          // All letters done
          if (soundEnabled) soundManager.playCelebration();
          setGamePhase('results');
        }
      }, 2200);
    }
  }, [currentLetter, currentLetterIdx, letters.length, soundEnabled]);

  const processTracePosition = useCallback((sx, sy) => {
    if (step !== 'trace' || gamePhase !== 'playing' || isPaused) return;

    setFingerPos({ x: sx, y: sy });

    // Check waypoint proximity
    const waypoints = letterData?.waypoints;
    if (!waypoints) return;

    const newReached = [...reachedWaypoints];
    const nextIdx = newReached.length;

    if (nextIdx < waypoints.length) {
      const target = waypoints[nextIdx];
      const dist = Math.hypot(sx - target.x, sy - target.y);

      if (dist < TRACE_WAYPOINT_RADIUS) {
        newReached.push(nextIdx);
        setReachedWaypoints(newReached);
        setTraceProgress(newReached.length / waypoints.length);

        if (soundEnabled) soundManager.playProgress();

        // All waypoints reached
        if (newReached.length === waypoints.length) {
          const accuracy = Math.min(100, Math.round(80 + Math.random() * 20));
          handleStepComplete('trace', { accuracy });
        }
      }
    }
  }, [step, gamePhase, isPaused, letterData, reachedWaypoints, soundEnabled, handleStepComplete]);

  // Touch/Mouse Support for Trace Phase
  const handlePointerEvent = (e) => {
    if (e.type === 'pointermove' && !isDrawing) return;
    if (step !== 'trace' || gamePhase !== 'playing' || isPaused) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * 300;
    const sy = ((e.clientY - rect.top) / rect.height) * 300;
    
    processTracePosition(sx, sy);
  };

  // Map finger landmark to SVG coordinates within the trace area
  useEffect(() => {
    if (step !== 'trace' || gamePhase !== 'playing' || isPaused) {
      setFingerPos(null);
      return;
    }
    if (!landmarks || landmarks.length < 9) {
      if (!isDrawing) setFingerPos(null); // only clear if not actively using touch
      return;
    }

    // Index fingertip is landmark 8
    const indexTip = landmarks[8];
    if (!indexTip) return;

    // Convert normalized camera coords to SVG canvas coords (300x300)
    const sx = (1 - indexTip.x) * 300; // mirror
    const sy = indexTip.y * 300;
    
    processTracePosition(sx, sy);
  }, [landmarks, step, gamePhase, isPaused, processTracePosition, isDrawing]);

  // ══════════════════════════════════════════════════════════════════════════
  // Keyboard event handler
  // ══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (gamePhase !== 'playing' || isPaused) return;
      const key = e.key.toUpperCase();
      if (key.length === 1 && key >= 'A' && key <= 'Z') {
        if (step === 'find') handleFindKeyPress(key);
        else if (step === 'type') handleTypeKeyPress(key);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gamePhase, isPaused, step, handleFindKeyPress, handleTypeKeyPress]);

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  // ── Hand Detection: auto-start when hand is seen ──
  useEffect(() => {
    if (gamePhase !== 'waiting') return;
    if (landmarks && landmarks.length >= 9) {
      // Hand detected! Start the game
      if (soundEnabled) soundManager.playCountdownGo();
      setGamePhase('playing');
      letterStartTimeRef.current = Date.now();
    }
  }, [gamePhase, landmarks, soundEnabled]);

  // ── Countdown overlay ──
  const renderCountdown = () => null;

  // ── Input Selection Overlay ──
  const renderInputSelection = () => (
    <AnimatePresence>
      {gamePhase === 'inputSelection' && (
        <motion.div
          className="tt-hand-detect-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            background: 'rgba(8, 10, 22, 0.75)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
            className="tt-hand-detect-card"
            style={{
              background: 'rgba(15, 23, 42, 0.4)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '24px',
              padding: '40px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
              maxWidth: '600px',
              width: '90%',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div style={{ position: 'absolute', top: -50, left: -50, width: 150, height: 150, background: 'rgba(99, 102, 241, 0.3)', filter: 'blur(40px)', borderRadius: '50%', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', bottom: -50, right: -50, width: 150, height: 150, background: 'rgba(34, 211, 238, 0.2)', filter: 'blur(40px)', borderRadius: '50%', pointerEvents: 'none' }} />

            <h2 style={{ color: '#fff', fontSize: '2rem', fontWeight: 'bold', margin: '0 0 10px 0', textAlign: 'center', zIndex: 1 }}>
              How do you want to play?
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '1.1rem', margin: '0 0 30px 0', textAlign: 'center', lineHeight: 1.5, zIndex: 1 }}>
              Choose your preferred control method.
            </p>

            <div style={{ display: 'flex', gap: '20px', width: '100%', zIndex: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
              <motion.button
                whileHover={{ scale: 1.05, backgroundColor: 'rgba(99, 102, 241, 0.2)' }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  if (soundEnabled) soundManager.playProgress();
                  setInputMethod('camera');
                  setGamePhase('waiting');
                }}
                style={{
                  flex: '1 1 200px',
                  background: 'rgba(30, 41, 59, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '16px',
                  padding: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '12px',
                  cursor: 'pointer',
                  color: '#fff',
                  transition: 'all 0.2s',
                }}
              >
                <Hand size={48} color="#818cf8" />
                <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>Hand in the Air</span>
                <span style={{ fontSize: '0.9rem', color: '#94a3b8', textAlign: 'center' }}>Play using your device's camera</span>
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.05, backgroundColor: 'rgba(34, 211, 238, 0.2)' }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  if (soundEnabled) soundManager.playCountdownGo();
                  setInputMethod('touch');
                  setGamePhase('playing');
                  letterStartTimeRef.current = Date.now();
                }}
                style={{
                  flex: '1 1 200px',
                  background: 'rgba(30, 41, 59, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '16px',
                  padding: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '12px',
                  cursor: 'pointer',
                  color: '#fff',
                  transition: 'all 0.2s',
                }}
              >
                <MousePointer2 size={48} color="#22d3ee" />
                <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>Touchscreen</span>
                <span style={{ fontSize: '0.9rem', color: '#94a3b8', textAlign: 'center' }}>Tap and trace directly on the screen</span>
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // ── Hand Detection Overlay ──
  const renderHandDetection = () => (
    <AnimatePresence>
      {gamePhase === 'waiting' && (
        <motion.div
          className="tt-hand-detect-overlay"
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
              <div style={{
                fontSize: '1.4rem',
                fontWeight: 700,
                color: '#fff',
                marginBottom: 4,
              }}>
                <span style={{ color: 'rgba(255,255,255,0.4)' }}>«</span>
                {' '}Show one of your hands{' '}
              </div>
              <div style={{
                fontSize: '1.4rem',
                fontWeight: 700,
                color: '#fff',
              }}>
                to start playing{' '}
                <span style={{ color: 'rgba(255,255,255,0.4)' }}>»</span>
              </div>
            </div>

            {/* Hand Illustration Container - Simplified */}
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
              {/* Simple pulsing background instead of blurred radial gradient */}
              <motion.div
                animate={{ opacity: [0.1, 0.3, 0.1] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                style={{
                  position: 'absolute',
                  width: '100%',
                  height: '100%',
                  borderRadius: '50%',
                  background: '#6366f1',
                }}
              />

              {/* Static Hand Image without expensive filters */}
              <img 
                src="/hand-wireframe.png" 
                alt="Wireframe Hand"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  position: 'relative',
                  zIndex: 2,
                }}
              />
            </div>

            {/* Simple Loading text/dots */}
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{
                    duration: 1,
                    repeat: Infinity,
                    delay: i * 0.2,
                  }}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#8b8eff',
                  }}
                />
              ))}
            </div>

            {/* MediaPipe Badge */}
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
              <span style={{
                fontSize: '0.8rem',
                color: 'rgba(255, 255, 255, 0.7)',
                fontWeight: 500,
              }}>
                {isTracking ? 'MediaPipe™ Active' : 'Initializing Tracking...'}
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // ── Letter Success Overlay ──
  const renderLetterSuccess = () => (
    <AnimatePresence>
      {gamePhase === 'letterSuccess' && (
        <motion.div
          className="tt-letter-success-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <motion.div
            className="tt-letter-success-letter"
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.1 }}
          >
            {currentLetter}
          </motion.div>
          <motion.div
            className="tt-letter-success-msg"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            {encourageMsg}
          </motion.div>
          <motion.div
            className="tt-letter-success-stars"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5, type: 'spring' }}
          >
            ⭐⭐⭐
          </motion.div>
          <motion.div
            style={{ color: '#F59E0B', fontWeight: 800, fontSize: '1.2rem', marginTop: 12 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
          >
            +{POINTS_PER_STEP * 3} points!
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // ── Results Overlay ──
  const renderResults = () => {
    const totalStars = sessionStats.totalStars;
    const maxStars = letters.length * 3;
    const starRatio = totalStars / maxStars;

    return (
      <AnimatePresence>
        {gamePhase === 'results' && (
          <div
            className="tt-results-overlay"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 110,
              background: 'var(--tt-bg)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              overflowY: 'auto',
              padding: '40px 24px',
            }}
          >
            <Confetti show={true} />
            <motion.div
              className="tt-results-card"
              initial={{ opacity: 0, scale: 0.8, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            >
              <div className="tt-results-emoji">
                {starRatio >= 0.8 ? '🏆' : starRatio >= 0.5 ? '🌟' : '👏'}
              </div>
              <h2 className="tt-results-title">
                {starRatio >= 0.8 ? 'Outstanding!' : starRatio >= 0.5 ? 'Great Job!' : 'Good Effort!'}
              </h2>
              <p className="tt-results-subtitle">
                You completed {sessionStats.lettersCompleted} letter{sessionStats.lettersCompleted !== 1 ? 's' : ''} in Level {level}!
              </p>

              <div className="tt-results-stars">
                {[1, 2, 3].map((i) => (
                  <motion.span
                    key={i}
                    initial={{ opacity: 0, scale: 0, rotate: -180 }}
                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                    transition={{ delay: 0.3 + i * 0.2, type: 'spring', stiffness: 300 }}
                  >
                    {i <= Math.round(starRatio * 3) ? '⭐' : '☆'}
                  </motion.span>
                ))}
              </div>

              <div className="tt-results-stats">
                <div className="tt-results-stat">
                  <div className="tt-results-stat-icon">🏆</div>
                  <div className="tt-results-stat-value">{score}</div>
                  <div className="tt-results-stat-label">Score</div>
                </div>
                <div className="tt-results-stat">
                  <div className="tt-results-stat-icon">⭐</div>
                  <div className="tt-results-stat-value">{totalStars}/{maxStars}</div>
                  <div className="tt-results-stat-label">Stars</div>
                </div>
                <div className="tt-results-stat">
                  <div className="tt-results-stat-icon">⏱️</div>
                  <div className="tt-results-stat-value">{formatTime(elapsedTime)}</div>
                  <div className="tt-results-stat-label">Time</div>
                </div>
                <div className="tt-results-stat">
                  <div className="tt-results-stat-icon">✅</div>
                  <div className="tt-results-stat-value">{sessionStats.lettersCompleted}/{letters.length}</div>
                  <div className="tt-results-stat-label">Letters</div>
                </div>
                <div className="tt-results-stat">
                  <div className="tt-results-stat-icon">🎯</div>
                  <div className="tt-results-stat-value">
                    {sessionStats.tracingAccuracies.length > 0
                      ? Math.round(sessionStats.tracingAccuracies.reduce((a, b) => a + b, 0) / sessionStats.tracingAccuracies.length)
                      : 0}%
                  </div>
                  <div className="tt-results-stat-label">Accuracy</div>
                </div>
                <div className="tt-results-stat">
                  <div className="tt-results-stat-icon">📝</div>
                  <div className="tt-results-stat-value">Level {level}</div>
                  <div className="tt-results-stat-label">Difficulty</div>
                </div>
              </div>

              <div className="tt-results-actions">
                <motion.button
                  className="tt-results-btn primary"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    setGamePhase('waiting');
                    setCountdown(0);
                    setCurrentLetterIdx(0);
                    setStep('trace');
                    setScore(0);
                    setElapsedTime(0);
                    setReachedWaypoints([]);
                    setTraceProgress(0);
                    setTypedCount(0);
                    setKeyStates({});
                    setFingerPos(null);
                    setStarRatings({});
                    setSessionStats({
                      totalScore: 0, lettersCompleted: 0, totalStars: 0,
                      tracingAccuracies: [], findTimes: [], typingAccuracies: [],
                    });
                    setCurrentSessionId(null);
                    setSessionSaved(false);
                  }}
                >
                  <RotateCcw size={18} />
                  Play Again
                </motion.button>
                <motion.button
                  className="tt-results-btn secondary"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => navigate('/play')}
                >
                  <Home size={18} />
                  Back to Games
                </motion.button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    );
  };

  // ══════════════════════════════════════════════════════════════════════════
  // PLAYING phase (main return layout is always mounted to keep video/canvas refs alive)
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className={`tt-page ${isLightMode ? 'tt-light-mode' : ''}`}>
      {/* ── Screens & Overlays ── */}
      {renderInputSelection()}
      {renderCountdown()}
      {renderHandDetection()}
      {renderLetterSuccess()}
      {renderResults()}

      {/* ── Pause Overlay ──────────────────────────────────────────── */}
      <AnimatePresence>
        {isPaused && (
          <motion.div
            className="tt-pause-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="tt-pause-icon">⏸️</div>
            <div className="tt-pause-title">Game Paused</div>
            <div className="tt-pause-actions">
              <motion.button
                className="tt-results-btn primary"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setIsPaused(false)}
              >
                <Play size={18} />
                Resume
              </motion.button>
              <motion.button
                className="tt-results-btn secondary"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => navigate('/play')}
              >
                <Home size={18} />
                Quit
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="tt-header">
        <div className="tt-header-left">
          <div className="tt-game-title">
            <span className="tt-title-icon">✏️</span>
            Trace
            <span className="tt-title-arrow">→</span>
            Find
            <span className="tt-title-arrow">→</span>
            Type
          </div>

          <div className="tt-score-badge">
            <span className="score-icon">🏆</span>
            {score}
          </div>
        </div>

        <div className="tt-header-right">
          <div className="tt-timer">
            <Clock size={16} />
            {formatTime(elapsedTime)}
          </div>
          <button
            className="tt-icon-btn"
            onClick={() => setIsLightMode(!isLightMode)}
            title="Toggle Theme"
          >
            {isLightMode ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button
            className="tt-icon-btn"
            onClick={() => {
              const newState = soundManager.toggle();
              setSoundEnabled(newState);
            }}
            title="Toggle Sound"
          >
            {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button
            className="tt-icon-btn"
            onClick={() => setIsPaused(true)}
            title="Pause"
          >
            <Pause size={18} />
          </button>
          <button
            className="tt-icon-btn"
            onClick={() => navigate('/play')}
            title="Exit"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* ── Main Content ────────────────────────────────────────────── */}
      <div className="tt-main">
        <div className="tt-game-area">
          {/* ── Step Indicator ──────────────────────────────────────── */}
          <div className="tt-step-indicator">
            <div className={`tt-step-pill ${step === 'trace' ? 'active' : (step === 'find' || step === 'type') ? 'completed' : 'pending'}`}>
              {(step === 'find' || step === 'type') ? <CheckCircle size={14} /> : '1'}
              <span>TRACE</span>
            </div>
            <ChevronRight size={16} className="tt-step-arrow" />
            <div className={`tt-step-pill ${step === 'find' ? 'active' : step === 'type' ? 'completed' : 'pending'}`}>
              {step === 'type' ? <CheckCircle size={14} /> : '2'}
              <span>FIND</span>
            </div>
            <ChevronRight size={16} className="tt-step-arrow" />
            <div className={`tt-step-pill ${step === 'type' ? 'active' : 'pending'}`}>
              3
              <span>TYPE</span>
            </div>
          </div>

          {/* ── Step Content ────────────────────────────────────────── */}
          
          {/* ── TRACE Content (Persistently mounted OUTSIDE AnimatePresence) ── */}
          <div className="tt-step-container" style={{
            position: step === 'trace' ? 'relative' : 'absolute',
            visibility: step === 'trace' ? 'visible' : 'hidden',
            opacity: step === 'trace' ? 1 : 0,
            pointerEvents: step === 'trace' ? 'auto' : 'none',
            transition: 'opacity 0.3s ease',
            zIndex: step === 'trace' ? 10 : -1,
            width: '100%'
          }}>
            <div className="tt-step-header">
              <div className="tt-step-label">
                <div className="tt-step-number step-1">1</div>
                <div>
                  <div className="tt-step-name">TRACE</div>
                  <div className="tt-step-instruction">Trace the letter with your index finger.</div>
                </div>
              </div>
              <button className="tt-sound-btn" onClick={() => soundEnabled && speak(currentLetter)} title="Hear the letter">
                <Volume2 size={18} />
              </button>
            </div>
            
            <div className="tt-trace-area" ref={traceAreaRef}>
              <svg 
                className="tt-trace-svg" 
                viewBox="0 0 300 300"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setIsDrawing(true);
                  handlePointerEvent(e);
                }}
                onPointerMove={handlePointerEvent}
                onPointerUp={(e) => { 
                  e.currentTarget.releasePointerCapture(e.pointerId);
                  setIsDrawing(false); 
                  setFingerPos(null); 
                }}
                onPointerCancel={(e) => {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                  setIsDrawing(false); 
                  setFingerPos(null); 
                }}
                style={{ touchAction: 'none' }}
              >
                <path d={letterData.path} className="tt-trace-guide-path" />
                <path d={letterData.path} className="tt-trace-guide-outline" />
                {reachedWaypoints.map((wpIndex, i) => {
                  if (i === 0) return null;
                  const prevWp = letterData.waypoints[reachedWaypoints[i - 1]];
                  const currWp = letterData.waypoints[wpIndex];
                  
                  const isJump = BAD_JUMPS[currentLetter]?.includes(i);
                  
                  return (
                    <g key={`segment-${i}`}>
                      {!isJump && (
                        <>
                          {/* 1. The Filled Segment with initial glow burst */}
                          <motion.line
                            x1={prevWp.x}
                            y1={prevWp.y}
                            x2={currWp.x}
                            y2={currWp.y}
                            className="tt-trace-segment-path"
                            initial={{ pathLength: 0, filter: 'drop-shadow(0 0 25px #fff)' }}
                            animate={{ pathLength: 1, filter: 'drop-shadow(0 0 12px var(--tt-indigo-glow))' }}
                            transition={{ duration: 0.35, ease: 'easeOut' }}
                          />
                          
                          {/* 2. Traveling Flare that moves along the segment */}
                          <motion.circle
                            r={15}
                            fill="#fff"
                            initial={{ cx: prevWp.x, cy: prevWp.y, opacity: 1, scale: 0.5 }}
                            animate={{ cx: currWp.x, cy: currWp.y, opacity: [1, 1, 0], scale: [0.5, 1.5, 2] }}
                            transition={{ duration: 0.4, ease: 'easeOut' }}
                            style={{ filter: 'blur(3px)' }}
                          />
                        </>
                      )}

                      {/* 3. Intense Sparkle Burst at the destination */}
                      {[...Array(12)].map((_, sparkIdx) => {
                        const angle = (Math.PI * 2 * sparkIdx) / 12 + (Math.random() * 0.2);
                        const dist = 30 + Math.random() * 40;
                        return (
                          <motion.circle
                            key={`sparkle-${i}-${sparkIdx}`}
                            r={Math.random() * 4 + 2}
                            fill={sparkIdx % 2 === 0 ? '#ffffff' : '#06b6d4'}
                            initial={{ cx: currWp.x, cy: currWp.y, opacity: 0, scale: 0 }}
                            animate={{ 
                              cx: currWp.x + Math.cos(angle) * dist, 
                              cy: currWp.y + Math.sin(angle) * dist, 
                              opacity: [0, 1, 0],
                              scale: [0, 1.5, 0]
                            }}
                            transition={{ duration: 0.5 + Math.random() * 0.4, ease: 'easeOut', delay: isJump ? 0 : 0.2 }}
                            style={{ filter: 'blur(1px)' }}
                          />
                        );
                      })}
                    </g>
                  );
                })}
                {letterData.waypoints.map((wp, i) => {
                  const isReached = reachedWaypoints.includes(i);
                  const isActive = i === reachedWaypoints.length;
                  
                  // Find the lowest index at this coordinate that has NOT been reached yet
                  const nextIndexAtCoord = letterData.waypoints.findIndex(
                    (w, idx) => w.x === wp.x && w.y === wp.y && !reachedWaypoints.includes(idx)
                  );
                  
                  // Only show text if this is the next unreached waypoint at this coordinate
                  const shouldShowText = !isReached && nextIndexAtCoord === i;

                  return (
                    <g key={i} className="tt-trace-waypoint">
                      <circle cx={wp.x} cy={wp.y} r={isActive ? 16 : 13} className={`tt-trace-waypoint-circle ${isReached ? 'reached' : ''} ${isActive ? 'active' : ''}`} />
                      {shouldShowText && (
                        <text x={wp.x} y={wp.y} className={`tt-trace-waypoint-number ${isReached ? 'reached' : ''} ${isActive ? 'active' : ''}`}>
                          {i + 1}
                        </text>
                      )}
                    </g>
                  );
                })}
                {fingerPos && (
                  <circle cx={fingerPos.x} cy={fingerPos.y} r={18} className="tt-trace-finger-ring" />
                )}
              </svg>
              <div className="tt-camera-container" style={{ visibility: 'hidden', opacity: 0, position: 'absolute', pointerEvents: 'none' }}>
                <video ref={videoRef} playsInline autoPlay muted />
                <canvas ref={canvasRef} />
              </div>
            </div>
            <div className={`tt-trace-feedback ${traceProgress > 0 ? 'on-path' : ''}`} style={{ textCombineUpright: 'none' }}>
              {traceProgress > 0 ? `${Math.round(traceProgress * 100)}% complete — keep going!` : isTracking ? 'Move your index finger to waypoint 1' : 'Initializing camera...'}
            </div>
          </div>

          <AnimatePresence mode="wait">
            {step !== 'trace' && (
              <motion.div
                key={`${currentLetter}-${step}`}
                className={`tt-step-container step-${step}`}
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -50 }}
                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              >
                {/* Step Header */}
                <div className="tt-step-header">
                  <div className="tt-step-label">
                    <div className={`tt-step-number step-${step === 'find' ? '2' : '3'}`}>
                      {step === 'find' ? '2' : '3'}
                    </div>
                    <div>
                      <div className="tt-step-name">
                        {step === 'find' ? 'FIND' : 'TYPE'}
                      </div>
                      <div className="tt-step-instruction">
                        {step === 'find'
                          ? 'Find the letter on the keyboard. Tap it!'
                          : 'Type the letter independently.'}
                      </div>
                    </div>
                  </div>
                  <button
                    className="tt-sound-btn"
                    onClick={() => soundEnabled && speak(currentLetter)}
                    title="Hear the letter"
                  >
                    <Volume2 size={18} />
                  </button>
                </div>

              {/* ── FIND Content ───────────────────────────────────── */}
              {step === 'find' && (
                <>
                  <motion.div
                    style={{
                      textAlign: 'center',
                      fontSize: '4rem',
                      fontWeight: 900,
                      color: '#fff',
                      marginBottom: 20,
                      textShadow: '0 0 30px rgba(99, 102, 241, 0.3)',
                    }}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                  >
                    {currentLetter}
                  </motion.div>
                  <VirtualKeyboard
                    targetLetter={currentLetter}
                    onKeyPress={handleFindKeyPress}
                    highlightTarget={true}
                    keyStates={keyStates}
                  />
                </>
              )}

              {/* ── TYPE Content ───────────────────────────────────── */}
              {step === 'type' && (
                <>
                  <div className="tt-type-target">
                    <motion.div
                      className="tt-type-letter-display"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.2 }}
                    >
                      {currentLetter}
                    </motion.div>
                    <div className="tt-type-slots">
                      {Array.from({ length: TYPE_REQUIRED }, (_, i) => (
                        <motion.div
                          key={i}
                          className={`tt-type-slot ${
                            i < typedCount ? 'filled' : i === typedCount ? 'current' : 'empty'
                          }`}
                          initial={i < typedCount ? { scale: 0.5, rotateY: 90 } : {}}
                          animate={i < typedCount ? { scale: 1, rotateY: 0 } : {}}
                          transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                        >
                          {i < typedCount ? currentLetter : ''}
                        </motion.div>
                      ))}
                    </div>
                  </div>
                  <VirtualKeyboard
                    targetLetter={currentLetter}
                    onKeyPress={handleTypeKeyPress}
                    highlightTarget={false}
                    keyStates={keyStates}
                  />
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

          {/* ── Feedback Message ────────────────────────────────────── */}
          <AnimatePresence>
            {feedbackMsg && (
              <motion.div
                className={`tt-feedback-toast ${feedbackMsg.type}`}
                initial={{ opacity: 0, y: 20, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              >
                <span>{feedbackMsg.text}</span>
                <span className="tt-points">⭐ +{feedbackMsg.points}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Sidebar ──────────────────────────────────────────────── */}
        <aside className="tt-sidebar">
          {/* How to Play */}
          <div className="tt-sidebar-section">
            <div className="tt-sidebar-section-title">
              <Info size={14} /> HOW TO PLAY
            </div>
            <div className="tt-howto-steps">
              {[
                { num: 1, bg: '#6366F1', icon: '✏️', text: 'Trace the letter as shown.' },
                { num: 2, bg: '#E8841A', icon: '🔍', text: 'Find the letter on the keyboard.' },
                { num: 3, bg: '#10B981', icon: '⌨️', text: 'Type the letter independently.' },
                { num: 4, bg: '#F59E0B', icon: '⭐', text: 'Earn stars and move to the next!' },
              ].map((s) => (
                <div key={s.num} className="tt-howto-step">
                  <div className="tt-howto-step-num" style={{ background: s.bg }}>
                    {s.num}
                  </div>
                  <div className="tt-howto-step-text">
                    {s.icon} {s.text}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Progress */}
          <div className="tt-sidebar-section">
            <div className="tt-sidebar-section-title">
              📊 YOUR PROGRESS
            </div>
            <div className="tt-progress-info">
              <div className="tt-progress-row">
                <span className="tt-progress-label">Letters Completed</span>
                <span className="tt-progress-value">
                  <span className="highlight">{sessionStats.lettersCompleted}</span> / {letters.length}
                </span>
              </div>
              <div className="tt-progress-row">
                <span className="tt-progress-label">Stars Collected</span>
                <span className="tt-progress-value">
                  ⭐ {sessionStats.totalStars}
                </span>
              </div>
              <div className="tt-next-letter-row">
                <span className="tt-next-letter-current">{currentLetter}</span>
                <ChevronRight size={18} className="tt-next-letter-arrow" />
                <span className="tt-next-letter-next">
                  {currentLetterIdx + 1 < letters.length ? letters[currentLetterIdx + 1] : '🏁'}
                </span>
              </div>
            </div>
          </div>

          {/* Metrics */}
          <div className="tt-sidebar-section">
            <div className="tt-sidebar-section-title">
              📏 METRICS
            </div>
            <div className="tt-metrics-grid">
              <div className="tt-metric-item">
                <div className="tt-metric-icon">🏆</div>
                <div className="tt-metric-value">{score}</div>
                <div className="tt-metric-label">Score</div>
              </div>
              <div className="tt-metric-item">
                <div className="tt-metric-icon">⏱️</div>
                <div className="tt-metric-value">{formatTime(elapsedTime)}</div>
                <div className="tt-metric-label">Time</div>
              </div>
              <div className="tt-metric-item">
                <div className="tt-metric-icon">⭐</div>
                <div className="tt-metric-value">{sessionStats.totalStars}</div>
                <div className="tt-metric-label">Stars</div>
              </div>
              <div className="tt-metric-item">
                <div className="tt-metric-icon">✅</div>
                <div className="tt-metric-value">
                  {sessionStats.tracingAccuracies.length > 0
                    ? `${Math.round(sessionStats.tracingAccuracies.reduce((a, b) => a + b, 0) / sessionStats.tracingAccuracies.length)}%`
                    : '—'}
                </div>
                <div className="tt-metric-label">Accuracy</div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* ── Tip Bar ──────────────────────────────────────────────── */}
      <div className="tt-tip-bar">
        <span className="tip-icon">💡</span>
        {tip}
      </div>

      {/* ── Global Pointer Overlay ────────────────────────────────── */}
      {globalPointer && (
        <div
          className="tt-global-pointer"
          style={{
            position: 'fixed',
            left: globalPointer.x,
            top: globalPointer.y,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            zIndex: 9999,
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: '3px solid rgba(99, 102, 241, 0.8)',
            backgroundColor: 'rgba(99, 102, 241, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 15px rgba(99, 102, 241, 0.5)'
          }}
        >
          {/* Dwell Progress Ring */}
          <svg width="50" height="50" style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
            <circle
              cx="25" cy="25" r="20"
              stroke="rgba(255, 255, 255, 0.8)"
              strokeWidth="4"
              fill="none"
              strokeDasharray="125.6"
              strokeDashoffset={125.6 * (1 - globalPointer.clickProgress)}
              style={{ transition: 'stroke-dashoffset 0.1s linear' }}
            />
          </svg>
        </div>
      )}

      {/* ── Alphabet Progress Bar ─────────────────────────────────── */}
      <div className="tt-alphabet-bar">
        <button
          className="tt-alphabet-back-btn"
          onClick={() => navigate('/play/trace-type-difficulty')}
          title="Back to levels"
        >
          <ArrowLeft size={16} />
        </button>
        {letters.map((letter, i) => {
          const status = i < currentLetterIdx ? 'completed' :
                         i === currentLetterIdx ? 'current' : 'pending';
          const stars = starRatings[letter] || 0;
          return (
            <div key={letter} className={`tt-letter-pill ${status}`}>
              <div className="tt-letter-pill-char">{letter}</div>
              <div className="tt-letter-pill-stars">
                {[1, 2, 3].map((s) => (
                  <span key={s} className={s <= stars ? 'star-earned' : 'star-empty'}>
                    ★
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

