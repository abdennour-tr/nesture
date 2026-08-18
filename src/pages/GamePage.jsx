import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { LogOut, Settings, X, Volume2, VolumeX } from 'lucide-react';
import { useSessionStore, useAuthStore } from '../store';
import useTextToSpeech from '../hooks/useTextToSpeech';
import useMediaPipeTracking, { LANDMARKS, calculateSmoothness } from '../hooks/useMediaPipeTracking';
import { useReflexEngine } from '../hooks/useReflexEngine';
import api from '../services/api';
import { supabase } from '../services/supabaseClient';

// ── Constants ─────────────────────────────────────────────────────────────────
const DWELL_MS  = 2500;               // 2.5 s dwell to confirm
const DOT_R     = 4;                  // precision core dot radius
const INNER_R   = 11;                 // static inner ring radius
const RING_R    = 24;                 // outer progress ring radius
const TICK_LEN  = 5;                  // crosshair tick length
const RING_CIRC = 2 * Math.PI * RING_R;
const CANVAS    = (RING_R + 14) * 2; // SVG canvas = 76 px

// ── Full QWERTY layout (used as letter source) ──────────────────────────────
const ALL_LETTERS = 'QWERTYUIOPASDFGHJKLZXCVBNM'.split('');
const QWERTY_LAYOUT = [
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['Z','X','C','V','B','N','M'],
];

// ── Word banks — PRD v4.0: 5 difficulty modes ────────────────────────────────
const WORD_PROMPTS = {
  easy:              ['CAT','SUN','DOG','HAT','BUS','CUP','BOX','FAN','MAP','BED','PEN','RUN','HOP','JOY','HUG'],
  medium:            ['BREAD','LIGHT','PLANT','MUSIC','WATER','APPLE','HOUSE','TRAIN','CHAIR','CLOUD','DREAM','STONE'],
  complex_words:     ['JOURNEY','SCIENCE','FREEDOM','BALANCE','DOLPHIN','KINGDOM','MONSTER','VOLCANO','PUZZLES','LIBRARY'],
  complex_sentences: ['I WANT TO GO','HE IS MY FRIEND','I LOVE YOU','PLAY WITH ME','HELP ME PLEASE','I AM HAPPY','THANK YOU'],
  // self_expression has no prompts — free text mode
};

const WORD_IMAGES = {
  CAT:'🐱',SUN:'☀️',DOG:'🐶',HAT:'🎩',BUS:'🚌',CUP:'☕',BOX:'📦',FAN:'🌀',MAP:'🗺️',BED:'🛏️',PEN:'🖊️',RUN:'🏃',HOP:'🐰',JOY:'😊',HUG:'🤗',
  BREAD:'🍞',LIGHT:'💡',PLANT:'🌿',MUSIC:'🎵',WATER:'💧',APPLE:'🍎',HOUSE:'🏠',TRAIN:'🚆',CHAIR:'🪑',CLOUD:'☁️',DREAM:'💭',STONE:'🪨',
  JOURNEY:'🧭',SCIENCE:'🔬',FREEDOM:'🗽',BALANCE:'⚖️',DOLPHIN:'🐬',KINGDOM:'👑',MONSTER:'👾',VOLCANO:'🌋',PUZZLES:'🧩',LIBRARY:'📚',
  'I WANT TO GO':'🚶','HE IS MY FRIEND':'🤝','I LOVE YOU':'❤️','PLAY WITH ME':'🎮','HELP ME PLEASE':'🙏','I AM HAPPY':'😄','THANK YOU':'🙏',
};

// ── Dynamic keyboard builder ─────────────────────────────────────────────────
// PRD rule: visible keys always include ALL letters from the target word/phrase,
// plus random distractor letters to fill up to the keyboard size limit.
// The board rebuilds whenever the word or keyboard size changes.
function buildDynamicKeyboard(targetText, visibleKeyCount) {
  // If 26 keys → return full QWERTY + backspace
  if (visibleKeyCount >= 26) {
    return [
      ['Q','W','E','R','T','Y','U','I','O','P'],
      ['A','S','D','F','G','H','J','K','L'],
      ['Z','X','C','V','B','N','M','⌫'],
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

const ENCOURAGEMENTS = ['Awesome! 🌟','Great job! 🎉','Amazing! ✨','Champion! 🏆','Perfect! ⭐'];
const TARGET_WORDS   = 5;

// ── Helpers ───────────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Calcule les métriques gestuelles RÉELLES à partir du buffer de positions.
 * Remplace complètement simulateGestureDetection().
 */
function computeRealGestureMetrics(posBuffer, dwellStartMs, isCorrect) {
  const response_time_ms = dwellStartMs > 0 ? (performance.now() - dwellStartMs) : 2500;
  const trajectory_smoothness = calculateSmoothness(posBuffer.slice(-15));
  // Détecter le croisement de la ligne médiane (x=0.5)
  const xs = posBuffer.slice(-10).map(p => p.x);
  const midline_crossing = xs.length >= 2
    ? (Math.min(...xs) < 0.5 && Math.max(...xs) > 0.5)
    : false;
  // Head-hand coupling : ratio entre variation verticale tête et main (proxy via posBuffer y)
  const yVals = posBuffer.slice(-10).map(p => p.y);
  const yRange = yVals.length > 1 ? Math.max(...yVals) - Math.min(...yVals) : 0;
  const head_hand_coupling = Math.min(1, yRange * 8);
  // Fatigue : smoothness faible + response_time long = fatigue élevée
  const fatigue_indicator = Math.min(1, (1 - trajectory_smoothness) * 0.6 + Math.min(response_time_ms / 12000, 0.4));
  return {
    classification: isCorrect ? 'Perfect' : 'Failed',
    response_time_ms,
    trajectory_smoothness,
    midline_crossing,
    head_hand_coupling,
    fatigue_indicator,
  };
}

// ── Professional Reticle Cursor ─────────────────────────────────────────────
// Layers (back → front):
//   1. Outer glow halo (appears while dwelling)
//   2. Outer progress ring (sweeps clockwise, cyan → green, 2.5 s)
//   3. Crosshair ticks at 0°/90°/180°/270°
//   4. Static inner ring (precision 'aim zone')
//   5. Core dot + highlight glint
function DwellCursor({ progress, hovering }) {
  const cx  = CANVAS / 2;
  const cy  = CANVAS / 2;
  const off = RING_CIRC * (1 - progress);

  // Hue interpolation: steel-blue (210) idle → cyan (185) hover → emerald (130) at 100 %
  const baseHue = hovering ? 185 - progress * 55 : 210;
  const accent  = `hsl(${baseHue}, 92%, 60%)`;
  const accentD = `hsl(${baseHue}, 80%, 42%)`; // darker shade for depth
  const glow    = `hsl(${baseHue}, 90%, 65%)`;

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
          <stop offset="0%"  stopColor={glow} stopOpacity={0.35 * progress}/>
          <stop offset="100%" stopColor={glow} stopOpacity={0}/>
        </radialGradient>
        {/* Core dot gradient (sphere illusion) */}
        <radialGradient id="dotGrad" cx="35%" cy="32%" r="65%">
          <stop offset="0%"  stopColor="white"  stopOpacity={0.95}/>
          <stop offset="40%" stopColor={accent}  stopOpacity={1}/>
          <stop offset="100%" stopColor={accentD} stopOpacity={1}/>
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
      <circle cx={cx} cy={cy} r={RING_R}
        fill="none"
        stroke={accent}
        strokeWidth={2.8}
        strokeDasharray={RING_CIRC}
        strokeDashoffset={off}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{
          transition: progress === 0
            ? 'none'
            : 'stroke-dashoffset 0.1s linear, stroke 0.35s ease',
        }}
      />

      {/* ── Layer 3: crosshair ticks ── */}
      {TICKS.map(angle => {
        const rad    = (angle * Math.PI) / 180;
        const inner  = INNER_R + 4;
        const outer  = inner + TICK_LEN;
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
  big:      { keyW: 84, keyH: 84, fontSize: '2rem',   gap: 14, rowGap: 16, slotW: 68, slotH: 80, slotFont: '2.2rem', bsW: 98 },
  medium:   { keyW: 68, keyH: 68, fontSize: '1.65rem', gap: 11, rowGap: 13, slotW: 60, slotH: 72, slotFont: '2rem',   bsW: 82 },
  standard: { keyW: 54, keyH: 54, fontSize: '1.3rem',  gap: 8,  rowGap: 10, slotW: 50, slotH: 60, slotFont: '1.6rem', bsW: 68 },
};

export default function GamePage() {
  const [searchParams] = useSearchParams();
  const difficulty      = searchParams.get('difficulty')   || 'medium';
  const keyboardSize    = searchParams.get('keyboardSize') || 'medium';
  const kbCfg           = KB_SIZES[keyboardSize] || KB_SIZES.medium;
  const visibleKeyCount = KB_VISIBLE_KEYS[keyboardSize] || 26;
  const isSentenceMode  = difficulty === 'complex_sentences';
  const isSelfExpression = difficulty === 'self_expression';
  const navigate        = useNavigate();
  const { user, profile, logout } = useAuthStore();
  const { activeSession, startSession, recordGesture, endSession } = useSessionStore();

  // ── Tracking unifié : 1 seule caméra → mains + visage ─────────────────────
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);

  const {
    landmarks,
    multiHandData,
    isTracking,
    error: cameraError,
    positionBuffer,
    faceLandmarks,
    headPose,
    faceCanvasRef,
    // Telemetry & Calibrated cursor from hook
    smoothedCursorPos,
    fps,
    trackingConfidence,
    handDetected,
    gazeDetected,
    calibrationStatus,
    recalibrate,
  } = useMediaPipeTracking(videoRef, canvasRef, true);

  // ── Reflex Engine (temps réel) ─────────────────────────────────────────────
  const { startTracking, stopTracking, pushFrame } = useReflexEngine({ analyzeEveryMs: 4000 });
  const reflexEngineOutputRef = useRef(null);


  // ── DOM refs ───────────────────────────────────────────────────────────
  const timerRef  = useRef(null);
  const keyRefs   = useRef({});
  const keyRects  = useRef({});
  const slotRefs  = useRef([]);

  // ── Dwell refs (used inside RAF — never stale) ─────────────────────────
  const dwellKey        = useRef(null);   // key currently being dwelled on
  const dwellStart      = useRef(null);   // performance.now() when dwell started on current key
  const dwellRAF        = useRef(null);
  const latestLandmarks = useRef(null);   // mirror of landmarks state for RAF
  
  // Dwell hysteresis state & telemetry logging
  const dwellKeyPending = useRef(null);
  const dwellKeyPendingStart = useRef(null);
  const lastLogTime = useRef(performance.now());

  // Refs for tracking metrics to avoid stale closure in RAF
  const smoothedCursorPosRef = useRef({ x: 0.5, y: 0.5 });
  const trackingConfidenceRef = useRef(100);
  const gazeDetectedRef = useRef(false);
  const fpsRef = useRef(30);
  const calibrationStatusRef = useRef('Calibrating...');

  useEffect(() => { smoothedCursorPosRef.current = smoothedCursorPos; }, [smoothedCursorPos]);
  useEffect(() => { trackingConfidenceRef.current = trackingConfidence; }, [trackingConfidence]);
  useEffect(() => { gazeDetectedRef.current = gazeDetected; }, [gazeDetected]);
  useEffect(() => { fpsRef.current = fps; }, [fps]);
  useEffect(() => { calibrationStatusRef.current = calibrationStatus; }, [calibrationStatus]);

  // ── Game state ─────────────────────────────────────────────────────────
  const [phase,             setPhase]             = useState('playing');
  const [currentWord,       setCurrentWord]       = useState('');
  const [slots,             setSlots]             = useState([]);
  const [score,             setScore]             = useState({ perfect:0, failed:0, total:0 });
  const [lastGesture,       setLastGesture]       = useState(null);
  const [processing,        setProcessing]        = useState(false);
  const [sessionTime,       setSessionTime]       = useState(0);
  const [wordsCompleted,    setWordsCompleted]    = useState(0);
  const [showSuperAnim,     setShowSuperAnim]     = useState(false);
  const [encouragementText, setEncouragementText] = useState('');
  const [learnerLevel,      setLearnerLevel]      = useState(1);
  const [realtimeMetrics,   setRealtimeMetrics]   = useState({ avgResponseTime:0, accuracy:0, smoothness:0, fatigue:0 });

  // ── Self Expression state ──────────────────────────────────────────────
  const [freeText,       setFreeText]       = useState('');
  const [savedMessages,  setSavedMessages]  = useState([]);
  const textareaRef = useRef(null);

  // ── Text-To-Speech settings & hook ──
  const [ttsEnabled, setTtsEnabled] = useState(() => {
    const saved = localStorage.getItem('nesture-tts-enabled');
    return saved !== null ? saved === 'true' : true;
  });

  const { isSpeaking, speak: ttsSpeak, cancel: ttsCancel, voices } = useTextToSpeech(ttsEnabled);

  // ── Cursor UI state ────────────────────────────────────────────────────
  const [cursorPos,     setCursorPos]     = useState({ x:-300, y:-300 });
  const [hoveredKey,    setHoveredKey]    = useState(null);
  const [dwellProgress, setDwellProgress] = useState(0);  // 0–1
  const [showMobileSettings, setShowMobileSettings] = useState(false);

  // ── Stale-closure mirrors ──────────────────────────────────────────────
  const slotsRef          = useRef([]);
  const currentWordRef    = useRef('');
  const pendingEndSession = useRef(false);
  const wordQueueRef      = useRef([]);
  const dwellStartRef     = useRef(0); // timestamp début du dwell courant
  const gestureLog        = useRef([]);
  const showSuperAnimRef  = useRef(false);
  const phaseRef          = useRef('playing');
  const activeSessionRef  = useRef(null);
  const capturedPositions = useRef([]);
  const trackingSaved     = useRef(false);

  useEffect(() => { phaseRef.current        = phase;        }, [phase]);
  useEffect(() => { showSuperAnimRef.current = showSuperAnim; }, [showSuperAnim]);
  useEffect(() => { latestLandmarks.current  = landmarks;    }, [landmarks]);
  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);

  // ── Session init ───────────────────────────────────────────────────────
  useEffect(() => {
    initSession();
    return () => {
      clearInterval(timerRef.current);
      cancelAnimationFrame(dwellRAF.current);
    };
  }, []);

  const initSession = async () => {
    try {
      const learnerId = profile?.learner_id || user?.id || '00000000-0000-0000-0000-000000000010';
      api.get(`/sessions/learner/${learnerId}?limit=500`)
        .then(r => setLearnerLevel(Math.max(1, Math.floor(r.data.length / 2) + 1)))
        .catch(() => {});
      const res = await api.post('/sessions/start', { learner_id: learnerId, difficulty, game_name: 'LetterQuest' });
      startSession(res.data.session_id, learnerId, difficulty);
      // Démarrer le moteur de réflexes primitifs (temps réel)
      startTracking({ sessionId: res.data.session_id, learnerId });
      if (!isSelfExpression) pickNewWord();
      startTimer();
    } catch {
      toast.error('Could not start session');
      navigate('/play');
    }
  };

  const handleSettingChange = (type, val) => {
    let newDiff = difficulty;
    let newKb = keyboardSize;

    if (type === 'difficulty') {
      newDiff = val;
      const defaults = { easy: 'big', medium: 'medium', complex_words: 'medium', complex_sentences: 'standard', self_expression: 'standard' };
      newKb = defaults[newDiff] || 'medium';
    } else {
      newKb = val;
      if (newKb !== 'standard' && (difficulty === 'complex_sentences' || difficulty === 'self_expression')) {
        toast.error('This mode requires Standard keys.');
        return;
      }
    }
    window.location.href = `/play/game?difficulty=${newDiff}&keyboardSize=${newKb}`;
  };


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

  const startTimer = () => {
    timerRef.current = setInterval(() => setSessionTime(t => t + 1), 1000);
  };

  // ── Pick new word/phrase ────────────────────────────────────────────────
  const pickNewWord = useCallback(() => {
    const bank = WORD_PROMPTS[difficulty] || WORD_PROMPTS.medium;
    if (!bank) return; // self_expression has no prompts
    if (wordQueueRef.current.length === 0)
      wordQueueRef.current = shuffle([...bank]);
    const word = wordQueueRef.current.pop();
    currentWordRef.current = word;
    // For sentences, split by character (including spaces)
    const chars = isSentenceMode ? word.split('') : word.split('');
    const emptySlots = chars.map(() => ({ letter: null, correct: false }));
    slotsRef.current = emptySlots;
    setCurrentWord(word);
    setSlots(emptySlots);
  }, [difficulty, isSentenceMode]);

  // ── Cache key hitboxes ─────────────────────────────────────────────────
  useEffect(() => {
    const update = () => {
      const kr = {};
      for (const [k, el] of Object.entries(keyRefs.current)) {
        if (el) kr[k] = el.getBoundingClientRect();
      }
      keyRects.current = kr;
    };
    setTimeout(update, 400);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [phase, currentWord, slots, showSuperAnim]);

  // ── Letter actions ─────────────────────────────────────────────────────
  const handleDeleteLetter = useCallback(() => {
    if (isSelfExpression) {
      setFreeText(prev => prev.slice(0, -1));
      toast('Deleted ⌫', { icon: '🔙', duration: 800 });
      if (ttsEnabled) {
        ttsSpeak('⌫', { phonetic: true });
      }
      return;
    }

    const idx = slotsRef.current.map(s => s.letter !== null).lastIndexOf(true);
    if (idx === -1) return;
    const newSlots = [...slotsRef.current];
    newSlots[idx] = { letter: null, correct: false };
    slotsRef.current = newSlots;
    setSlots([...newSlots]);
    toast('Deleted ⌫', { icon: '🔙', duration: 800 });
    if (ttsEnabled) {
      ttsSpeak('⌫', { phonetic: true });
    }
  }, [ttsEnabled, ttsSpeak]);

  const handleTypeLetter = useCallback((letter) => {
    if (isSelfExpression) {
      if (letter === '⌫') {
        setFreeText(prev => prev.slice(0, -1));
      } else if (letter === '␣' || letter === 'SPACE') {
        setFreeText(prev => prev + ' ');
      } else {
        setFreeText(prev => prev + letter);
      }
      if (ttsEnabled) {
        ttsSpeak(letter, { phonetic: true });
      }
      return;
    }

    const word      = currentWordRef.current;
    let targetIdx = slotsRef.current.findIndex(s => s.letter === null);
    if (targetIdx === -1) return;

    const isCorrect = letter === word[targetIdx];
    const newSlots  = [...slotsRef.current];
    newSlots[targetIdx] = { letter, correct: isCorrect };

    slotsRef.current = newSlots;
    setSlots([...newSlots]);

    if (ttsEnabled) {
      ttsSpeak(letter, { phonetic: true });
    }

    // ── Calcul réel des métriques gestuelles ──────────────────────────────
    const realMetrics = computeRealGestureMetrics(
      positionBuffer?.current || [],
      dwellStartRef.current,
      isCorrect
    );
    const gesture = {
      target_letter: letter,
      ...realMetrics,
    };
    recordGesture(gesture);
    gestureLog.current.push(gesture);
    setLastGesture({ letter, result: gesture.classification });

    setScore(s => ({
      perfect: s.perfect + (isCorrect ? 1 : 0),
      failed:  s.failed  + (!isCorrect ? 1 : 0),
      total:   s.total   + 1,
    }));

    const log = gestureLog.current;
    setRealtimeMetrics({
      avgResponseTime: log.reduce((a, g) => a + g.response_time_ms, 0) / log.length,
      accuracy:        log.filter(g => g.classification === 'Perfect').length / log.length,
      smoothness:      log.reduce((a, g) => a + g.trajectory_smoothness, 0) / log.length,
      fatigue:         log[log.length - 1]?.fatigue_indicator || 0,
    });

    const allFilled  = newSlots.every(s => s.letter !== null);
    const allCorrect = newSlots.every((s, i) => s.letter === word[i]);
    if (allFilled && allCorrect) {
      const text = ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)];
      setEncouragementText(text);
      setShowSuperAnim(true);
      if (ttsEnabled) {
        ttsSpeak(word, { delay: 400 });
      }
      setTimeout(() => {
        setShowSuperAnim(false);
        setWordsCompleted(prev => {
          const next = prev + 1;
          if (next >= TARGET_WORDS) pendingEndSession.current = true;
          else pickNewWord();
          return next;
        });
      }, 3000);
    }
  }, [difficulty, pickNewWord, recordGesture, ttsEnabled, ttsSpeak]);

  // ── RAF dwell loop ─────────────────────────────────────────────────────
  // Resets ONLY when the finger moves to a different key (or off all keys).
  // Ignores natural hand jitter — tolerant by design.
  const runDwellLoop = useCallback(() => {
    const tick = () => {
      dwellRAF.current = requestAnimationFrame(tick);

      const lm = latestLandmarks.current;
      if (!lm || phaseRef.current !== 'playing' || showSuperAnimRef.current) {
        setCursorPos({ x: -300, y: -300 });
        setHoveredKey(null);
        setDwellProgress(0);
        dwellStart.current = null;
        dwellKey.current   = null;
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
      const sx = minLeft + smoothedCursorPosRef.current.x * (maxRight - minLeft);
      const sy = minTop + smoothedCursorPosRef.current.y * (maxBottom - minTop);
      setCursorPos({ x: sx, y: sy });

      // ── Capture raw positions (up to 1000) ─────────────────────────────────
      if (phaseRef.current === 'playing' && !trackingSaved.current && activeSessionRef.current?.id) {
        if (capturedPositions.current.length < 1000) {
          capturedPositions.current.push({ x: sx, y: sy, timestamp: Date.now() });
        } else {
          trackingSaved.current = true;
          const finalLearnerId = activeSessionRef.current.learnerId || profile?.learner_id || user?.id || '00000000-0000-0000-0000-000000000010';
          supabase.from('raw_hand_tracking').insert({
            session_id: activeSessionRef.current.id,
            child_id: finalLearnerId,
            positions: capturedPositions.current
          }).then(({ error }) => {
            if (error) console.error('Failed to save raw tracking:', error);
            else console.log('✅ 1000 hand tracking positions saved.');
          });
        }
      }

      // Detect which key (if any) the finger is over
      let hKey = null;
      for (const [k, rect] of Object.entries(keyRects.current)) {
        if (sx >= rect.left - 14 && sx <= rect.right  + 14 &&
            sy >= rect.top  - 14 && sy <= rect.bottom + 14) {
          hKey = k;
          break;
        }
      }
      setHoveredKey(hKey);

      // Throttled logging to console once every second
      const nowMs = performance.now();
      if (nowMs - lastLogTime.current >= 1000) {
        console.log(
          `[Telemetry Log] FPS: ${fpsRef.current} | Confidence: ${trackingConfidenceRef.current}% | Hand: ${isTracking ? 'Yes' : 'No'} | Gaze: ${gazeDetectedRef.current ? 'Yes' : 'No'} | Selected Key: ${hKey || 'None'} | Calibration: ${calibrationStatusRef.current}`
        );
        lastLogTime.current = nowMs;
      }

      // ── Hysteresis State Machine ──
      if (hKey === dwellKey.current) {
        if (dwellKey.current !== null) {
          // Stayed/returned to the active key -> cancel pending switches
          dwellKeyPending.current = null;
          dwellKeyPendingStart.current = null;
        } else if (hKey !== null) {
          // Initial hover on a key
          dwellKey.current = hKey;
          dwellStart.current = nowMs;
          dwellStartRef.current = nowMs;
          setDwellProgress(0);
        }
      } else {
        if (dwellKey.current === null) {
          // Hovered over key, initiate immediately
          if (hKey !== null) {
            dwellKey.current = hKey;
            dwellStart.current = nowMs;
            dwellStartRef.current = nowMs;
            dwellKeyPending.current = null;
            dwellKeyPendingStart.current = null;
            setDwellProgress(0);
          }
        } else {
          // Hovered key is different from active key -> start transition grace period
          if (dwellKeyPending.current === hKey) {
            const elapsedPending = nowMs - dwellKeyPendingStart.current;
            const threshold = hKey === null ? 250 : 200; // 250ms for empty space, 200ms for other key
            if (elapsedPending >= threshold) {
              // Grace period expired, commit switch
              dwellKey.current = hKey;
              dwellStart.current = hKey === null ? null : nowMs;
              dwellStartRef.current = hKey === null ? 0 : nowMs;
              dwellKeyPending.current = null;
              dwellKeyPendingStart.current = null;
              setDwellProgress(0);
            }
          } else {
            dwellKeyPending.current = hKey;
            dwellKeyPendingStart.current = nowMs;
          }
        }
      }

      // ── Pousser frame dans le moteur de réflexes (données RÉELLES) ────────
      if (lm) {
        pushFrame({
          leftHand:  multiHandData?.left  || null,
          rightHand: multiHandData?.right || lm,
          faceMesh:  faceLandmarks || null,        // ← 468 landmarks réels
          headPitch: headPose?.pitch ?? 0,         // ← pitch réel en degrés
          headYaw:   headPose?.yaw   ?? 0,         // ← yaw réel en degrés
        });
      }

      // ── Fixed Dwell Time of 2 seconds (2000ms) as requested ──
      const currentDwellMs = 2000;

      // Accumulate dwell time
      if (dwellKey.current !== null && dwellKeyPending.current === null) {
        const elapsed  = performance.now() - dwellStart.current;
        const progress = Math.min(elapsed / currentDwellMs, 1);
        setDwellProgress(progress);

        // Dwell complete → fire selection
        if (progress >= 1) {
          const selected     = dwellKey.current;
          dwellKey.current   = null;
          dwellStart.current = null;
          setDwellProgress(0);
          if (selected === '⌫') handleDeleteLetter();
          else                  handleTypeLetter(selected);
        }
      } else if (dwellKey.current === null) {
        setDwellProgress(0);
      }
    };

    dwellRAF.current = requestAnimationFrame(tick);
  }, [handleDeleteLetter, handleTypeLetter]);

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

    // Save remaining hand tracking positions if not saved yet
    if (!trackingSaved.current && capturedPositions.current.length > 0 && activeSessionRef.current?.id) {
      trackingSaved.current = true;
      const finalLearnerId = activeSessionRef.current.learnerId || profile?.learner_id || user?.id || '00000000-0000-0000-0000-000000000010';
      supabase.from('raw_hand_tracking').insert({
        session_id: activeSessionRef.current.id,
        child_id: finalLearnerId,
        positions: capturedPositions.current
      }).then(({ error }) => {
        if (error) console.error('Failed to save remaining raw tracking at end of session:', error);
        else console.log(`✅ ${capturedPositions.current.length} hand tracking positions saved at end.`);
      });
    }

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

  const handleLogout = () => {
    clearInterval(timerRef.current);
    cancelAnimationFrame(dwellRAF.current);
    if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(t => t.stop());
    logout();
    toast.success('Logged out');
    navigate('/login');
  };

  const formatTime  = s => `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  const accuracyPct = score.total > 0 ? Math.round((score.perfect / score.total) * 100) : 0;
  const nextSlotIdx = slots.findIndex(s => s.letter === null);
  const nextCorrectLetter = currentWord && nextSlotIdx !== -1 ? currentWord[nextSlotIdx] : null;
  const isDwelling  = dwellProgress > 0 && isTracking;

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
      <style>{`
        @media (max-width: 1100px) {
          .gp-root { flex-direction: column !important; overflow-y: auto !important; height: auto !important; min-height: 100vh; }
          .gp-left, .gp-right { width: 100% !important; border: none !important; }
          .gp-left { order: 2; border-top: 1px solid rgba(255,255,255,0.1) !important; }
          .gp-center { order: 1; min-height: 400px; padding-top: 70px !important; position: relative !important; }
          .gp-right { order: 3; border-top: 1px solid rgba(255,255,255,0.1) !important; padding-bottom: 60px !important; }
          .camera-box { height: 300px !important; flex: none !important; }

          .gp-control-bar { flex-wrap: wrap !important; gap: 12px !important; justify-content: center !important; padding: 15px !important; height: auto !important; }
          .gp-control-bar > div { flex: 1 1 auto !important; justify-content: center !important; }
          .gp-control-bar > div:last-child { border-left: none !important; }
          .gp-control-bar .divider { display: none !important; }
          
          /* Settings Toggle - Visible on all devices < 1100px (Tablets & Phones) */
          .mobile-settings-btn { 
            display: flex !important; align-items: center; gap: 8px; 
            position: fixed !important; top: 15px; left: 15px; 
            z-index: 5000 !important; 
            background: rgba(13, 94, 107, 0.5); color: white; 
            border: 1px solid rgba(255,255,255,0.3); 
            padding: 10px 16px; border-radius: 14px; 
            font-weight: 800; font-size: 0.85rem; 
            cursor: pointer; box-shadow: 0 6px 16px rgba(0,0,0,0.4); 
            transition: all 0.2s;
          }
          .mobile-settings-btn:active { transform: scale(0.95); }
          
          .gp-control-bar.mobile-hidden { display: none !important; }
          .gp-control-bar.mobile-visible { 
            display: flex !important; 
            position: absolute !important; 
            top: 70px; left: 10px; right: 10px; 
            width: calc(100% - 20px) !important;
            z-index: 5001 !important; 
            background: rgba(15, 30, 34, 0.98) !important;
            border: 1px solid rgba(255,255,255,0.15) !important;
            box-shadow: 0 25px 50px rgba(0,0,0,0.6) !important;
            pointer-events: auto !important;
          }
        }
        @media (max-width: 640px) {
          .gp-center { padding: 10px !important; gap: 12px !important; }
          .slot { width: 44px !important; height: 56px !important; fontSize: 1.4rem !important; }
          .word-card { padding: 15px 20px !important; }
          .letter-key { width: 48px !important; height: 48px !important; fontSize: 1.2rem !important; border-radius: 10px !important; }
          .letter-row { gap: 6px !important; }
          .letter-board { gap: 8px !important; }
        }
        @media (min-width: 1101px) {
          .mobile-settings-btn { display: none !important; }
          .gp-control-bar { display: flex !important; }
        }
      `}</style>

      {/* ── Celebration overlay ───────────────────────────────────────── */}
      <AnimatePresence>
        {showSuperAnim && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} style={styles.superOverlay}>
            <motion.div
              initial={{scale:0,rotate:-30}} animate={{scale:[0,1.2,1],rotate:0}}
              transition={{type:'spring',damping:10,stiffness:100}} style={styles.superContent}
            >
              <div style={{fontSize:'5rem',filter:'drop-shadow(0 0 30px rgba(255,215,0,0.8))'}}>✨ 🎉 ⭐</div>
              <div style={styles.superText}>{encouragementText}</div>
            </motion.div>
            {Array.from({length:20}).map((_,i)=>(
              <motion.div key={i}
                initial={{x:0,y:0,scale:0,opacity:1}}
                animate={{x:(Math.random()-.5)*800,y:(Math.random()-.5)*600,scale:Math.random()*2+.5,opacity:0,rotate:Math.random()*360}}
                transition={{duration:2.5,ease:'easeOut'}}
                style={{position:'absolute',fontSize:'2rem',zIndex:999}}
              >
                {['🌟','🎈','🎊','✨','🏆'][i%5]}
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Dwell cursor (follows MediaPipe index finger) ─────────────── */}
      {isTracking && (
        <div style={{ ...styles.cursorOuter, left: cursorPos.x, top: cursorPos.y }}>
          <DwellCursor progress={dwellProgress} hovering={!!hoveredKey} />
        </div>
      )}

      {/* ── LEFT PANEL ───────────────────────────────────────────────── */}
      <div style={styles.leftPanel} className="gp-left">
        <div style={styles.cameraBox} className="camera-box">
          {cameraError ? (
            <div style={styles.cameraError}>
              <div style={{fontSize:'2rem',marginBottom:8}}>📷</div>
              <div style={{fontWeight:600,marginBottom:4}}>Camera unavailable</div>
              <div style={{fontSize:'0.8rem',color:'#9CA3AF'}}>Allow camera access for hand tracking.</div>
            </div>
          ) : (
            <>
              <video ref={videoRef} autoPlay muted playsInline style={styles.video}/>
              {/* Canvas mains — effacé à chaque frame */}
              <canvas ref={canvasRef} width={640} height={360} style={styles.canvas}/>
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
                  }}/>
                  {calibrationStatus === 'Calibrating...' ? 'Calibrating...' : `Tracking (${trackingConfidence}%)`}
                </div>
              )}
              <motion.div
                style={styles.dwellBadge}
                animate={{ background: isDwelling
                  ? `rgba(34,211,238,${0.3 + dwellProgress * 0.5})`
                  : 'rgba(0,0,0,0.55)' }}
              >
                {isDwelling
                  ? `${Math.round(dwellProgress * 100)}% — Hold still!`
                  : hoveredKey ? `Key: ${hoveredKey}` : '☝️ Point at a key'
                }
              </motion.div>

              {/* Auto-calibration visual overlay */}
              {calibrationStatus === 'Calibrating...' && isTracking && (
                <div style={{
                  position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                  background: 'rgba(15, 30, 34, 0.78)', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', zIndex: 10,
                  backdropFilter: 'blur(4px)'
                }}>
                  <div style={{ fontSize: '1.6rem', marginBottom: 8, animation: 'spin 3s linear infinite' }}>🔄</div>
                  <div style={{ fontWeight: 800, color: '#22d3ee', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Auto-Calibrating</div>
                  <div style={{ fontSize: '0.72rem', color: '#9CA3AF', marginTop: 4 }}>Wave hand to establish range...</div>
                  <div style={{ width: '60%', height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2, marginTop: 10, overflow: 'hidden' }}>
                    <motion.div 
                      animate={{ width: ['0%', '100%'] }} 
                      transition={{ duration: 3, ease: 'linear' }}
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
          <div style={{...styles.metricsPanelTitle,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            Live Metrics
            <div style={styles.levelBadgeMini}>Level {learnerLevel}</div>
          </div>
          <div style={styles.metricsGrid}>
            {[
              {label:'Accuracy',   value:`${accuracyPct}%`,                                       color:accuracyPct>75?'#10B981':'#F59E0B'},
              {label:'Avg Speed',  value:`${(realtimeMetrics.avgResponseTime/1000).toFixed(1)}s`, color:'#22d3ee'},
              {label:'Smoothness', value:`${Math.round(realtimeMetrics.smoothness*100)}%`,        color:'#8B5CF6'},
              {label:'Time',       value:formatTime(sessionTime),                                 color:'#E8841A'},
            ].map(m=>(
              <div key={m.label} style={styles.metricItem}>
                <div style={{...styles.metricValue,color:m.color}}>{m.value}</div>
                <div style={styles.metricLabel}>{m.label}</div>
              </div>
            ))}
          </div>
          <div style={{marginTop:12}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:'0.72rem',color:'#9CA3AF'}}>Fatigue</span>
              <span style={{fontSize:'0.72rem',color:'#9CA3AF'}}>{Math.round(realtimeMetrics.fatigue*100)}%</span>
            </div>
            <div style={styles.fatigueBar}>
              <div style={{...styles.fatigueFill,width:`${realtimeMetrics.fatigue*100}%`,
                background:realtimeMetrics.fatigue>0.6?'#EF4444':realtimeMetrics.fatigue>0.35?'#F59E0B':'#10B981'}}/>
            </div>
          </div>

          {/* Tracking Telemetry Dashboard */}
          <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 12 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#0D5E6B', marginBottom: 8 }}>
              Tracking Telemetry
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
            {isTracking && (
              <button 
                onClick={recalibrate}
                style={{
                  marginTop: 10, width: '100%', padding: '6px 12px', borderRadius: 8,
                  background: 'rgba(13,94,107,0.2)', border: '1px solid rgba(13,94,107,0.4)',
                  color: '#22d3ee', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                Force Recalibrate 🔄
              </button>
            )}
          </div>
        </div>

        {/* ── Saved Messages (Moved to Left Panel so keyboard doesn't move) ── */}
        {isSelfExpression && savedMessages.length > 0 && (
          <div style={{...seStyles.savedSection, marginTop: 16}}>
            <div style={{...seStyles.savedTitle, color: '#fff'}}>Saved Messages ({savedMessages.length})</div>
            <div style={{...seStyles.savedList, maxHeight: '250px'}}>
              {savedMessages.map(msg => (
                <motion.div
                  key={msg.id}
                  initial={{opacity:0,x:-10}}
                  animate={{opacity:1,x:0}}
                  style={{...seStyles.savedItem, background: 'rgba(0,0,0,0.4)', borderColor: 'rgba(255,255,255,0.1)'}}
                >
                  <div style={{...seStyles.savedText, color: '#E5E7EB'}}>{msg.text}</div>
                  <div style={seStyles.savedBottom}>
                    <span style={{...seStyles.savedTime, color: '#9CA3AF'}}>{msg.timestamp}</span>
                    <button
                      onClick={() => handleSpeak(msg.text)}
                      style={{...seStyles.reSpeakBtn, background: 'rgba(255,255,255,0.1)'}}
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
          width: '100%', maxWidth: 960, margin: '0 auto 24px', padding: '10px 16px',
          background: 'rgba(13, 26, 29, 0.6)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.06)', borderRadius: 18, 
          display: 'flex', flexWrap: 'nowrap', gap: 24, alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)', overflowX: 'auto', WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none', msOverflowStyle: 'none'
        }}>
          {/* Level */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Mode</span>
            <div style={{ display: 'flex', background: 'rgba(0,0,0,0.4)', borderRadius: 12, padding: 4, boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)' }}>
              {['easy', 'medium'].map(lvl => {
                const isActive = difficulty === lvl;
                return (
                  <motion.button key={lvl} onClick={() => handleSettingChange('difficulty', lvl)}
                    whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.92 }}
                    style={{
                      padding: '4px 12px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 700, border: 'none', cursor: 'pointer', transition: 'all 0.25s',
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
                    whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.92 }}
                    style={{
                      padding: '4px 12px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 700, border: 'none', cursor: 'pointer', transition: 'all 0.25s',
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
                    whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.92 }}
                    style={{
                      padding: '4px 12px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 700, border: 'none', cursor: 'pointer', transition: 'all 0.25s',
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

        <AnimatePresence mode="wait">

          {/* ── SELF EXPRESSION MODE ───────────────────────────── */}
          {phase === 'playing' && isSelfExpression && (
            <motion.div key="self-expression" initial={{opacity:0,y:20}} animate={{opacity:1,y:0}}
              style={{width:'100%',display:'flex',flexDirection:'column',alignItems:'center',gap:16,maxWidth:680,margin:'0 auto'}}>

              {/* Header */}
              <div style={seStyles.header}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:'1.8rem'}}>💬</span>
                  <div>
                    <div style={seStyles.title}>Self Expression</div>
                    <div style={seStyles.subtitle}>Type freely — no prompts, no score. Express yourself!</div>
                  </div>
                </div>
                <span style={seStyles.betaBadge}>BETA</span>
              </div>

              {/* Text area */}
              <div style={seStyles.textareaWrapper}>
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
              <div style={seStyles.actions}>
                <motion.button
                  whileHover={{scale:1.03}} whileTap={{scale:0.97}}
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
                  whileHover={{scale:1.03}} whileTap={{scale:0.97}}
                  onClick={handleSaveMessage}
                  style={{...seStyles.btn, ...seStyles.btnSave}}
                >
                  💾 Save
                </motion.button>

                <motion.button
                  whileHover={{scale:1.03}} whileTap={{scale:0.97}}
                  onClick={handleClearCanvas}
                  style={{...seStyles.btn, ...seStyles.btnClear}}
                >
                  🗑️ Clear
                </motion.button>
              </div>
              {/* Tip */}
              <div style={seStyles.tip}>
                💡 No time limit. Express yourself freely. Use <strong>Speak</strong> to hear your words aloud.
              </div>
            </motion.div>
          )}

          {/* ── NORMAL GAME MODE ──────────────────────────────── */}
          {phase === 'playing' && !isSelfExpression && (
            <motion.div key="playing" initial={{opacity:0}} animate={{opacity:1}}
              style={{width:'100%',display:'flex',flexDirection:'column',alignItems:'center',gap:18}}>

              {/* Progress bar */}
              <div style={styles.progressionContainer}>
                <div style={styles.progressionText}>Words: {wordsCompleted} / {TARGET_WORDS}</div>
                <div style={styles.progressionBarBg}>
                  <div style={{...styles.progressionBarFill,width:`${(wordsCompleted/TARGET_WORDS)*100}%`}}/>
                </div>
              </div>

              {/* Word card */}
              <div style={styles.wordCard} className="word-card">
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                  <div style={{fontSize:'4rem',filter:'drop-shadow(0 10px 15px rgba(0,0,0,0.3))'}}>
                    {WORD_IMAGES[currentWord]||'❓'}
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
                <div style={styles.targetTextContainer}>
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
                  <div style={styles.nextLetterHint}>
                    Point & hold on{' '}
                    <span style={{color:'#10B981',fontWeight:800}}>{nextCorrectLetter}</span>
                    {' '}for 2.5 s
                    <span style={{opacity:0.5,marginLeft:6,fontSize:'0.75rem'}}>(glows green)</span>
                  </div>
                )}

                {/* Letter slots */}
                <div style={styles.slotsContainer}>
                  {currentWord.split('').map((char, i) => {
                    const slot    = slots[i] || { letter: null, correct: false };
                    const filled  = slot.letter !== null;
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

                    return (
                      <motion.div
                        key={`slot-${i}-${currentWord}`}
                        ref={el => slotRefs.current[i] = el}
                        animate={filled && !correct ? {x:[-3,3,-3,3,0]} : {}}
                        transition={{duration:0.3}}
                        style={{
                          ...styles.slot,
                          ...(filled && correct  ? styles.slotCorrect : {}),
                          ...(filled && !correct ? styles.slotWrong   : {}),
                          ...(!filled            ? styles.slotEmpty   : {}),
                        }}
                        className="slot"
                      >
                        {filled ? slot.letter : (
                          <span style={{fontSize:'0.75rem',color:'rgba(34,211,238,0.35)',fontWeight:400}}>{i+1}</span>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}

          {phase === 'ending' && (
            <motion.div key="ending" initial={{opacity:0}} animate={{opacity:1}} style={styles.processingBanner}>
              <div className="spinner" style={{margin:'0 auto 12px'}}/>
              <div>Analysing your session…</div>
              <div style={{fontSize:'0.8rem',color:'#C8E8ED',marginTop:4}}>The AI is processing your motor patterns</div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dynamic keyboard — SHARED ACROSS MODES */}
        {phase === 'playing' && (
          <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} style={{...styles.letterBoard, gap: kbCfg.rowGap, marginTop: 20}} className="letter-board">
            {keyboardLayout.map((row, ri) => (
              <div key={ri} style={{...styles.letterRow, gap: kbCfg.gap}} className="letter-row">
                {row.map(letter => {
                  // Space key maps to actual space character
                  const displayLetter = letter;
                  const actualChar = letter === '␣' ? ' ' : letter;
                  const isNextCorrect  = actualChar === nextCorrectLetter || (letter === '␣' && nextCorrectLetter === ' ');
                  const isHovered      = hoveredKey === letter;
                  const dwellingOnThis = isHovered && isDwelling;
                  const isBackspace    = letter === '⌫';
                  const isSpace        = letter === '␣';

                  return (
                    <motion.button
                      key={letter}
                      ref={el => keyRefs.current[letter] = el}
                      onClick={() => {
                        if (letter === '⌫') handleDeleteLetter();
                        else handleTypeLetter(actualChar);
                      }}
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
                        width: isBackspace ? kbCfg.bsW : isSpace ? kbCfg.bsW * 1.5 : kbCfg.keyW,
                        height: kbCfg.keyH,
                        fontSize: isSpace ? `calc(${kbCfg.fontSize} * 0.55)` : kbCfg.fontSize,
                        ...(isBackspace    ? {...styles.letterKeyBackspace, width: kbCfg.bsW, fontSize: `calc(${kbCfg.fontSize} * 0.72)`} : {}),
                        ...(isSpace        ? { background:'rgba(139,92,246,0.08)', border:'2px solid rgba(139,92,246,0.22)', color:'#8B5CF6', letterSpacing:'0.08em' } : {}),
                        ...(isHovered      ? styles.letterKeyHovered   : {}),
                        ...(isNextCorrect  ? styles.letterKeyCorrect   : {}),
                        ...(dwellingOnThis ? styles.letterKeyDwelling  : {}),
                        opacity: (phase==='ending'||showSuperAnim) ? 0.5 : 1,
                      }}
                      className="letter-key"
                    >
                      {isSpace ? 'SPACE' : displayLetter}

                      {/* Bottom-fill animation while dwelling */}
                      {dwellingOnThis && (
                        <div style={{
                          position:'absolute', bottom:0, left:0, right:0,
                          height:`${dwellProgress * 100}%`,
                          background:'rgba(34,211,238,0.2)',
                          borderRadius:'0 0 12px 12px',
                          transition:'height 0.1s linear',
                          pointerEvents:'none',
                        }}/>
                      )}

                      {/* Pulsing dot under correct key */}
                      {isNextCorrect && (
                        <motion.div
                          style={styles.correctDot}
                          animate={{opacity:[0.5,1,0.5],scale:[0.8,1.1,0.8]}}
                          transition={{repeat:Infinity,duration:1.2}}
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
        <div style={styles.controls}>
          <button onClick={pickNewWord} style={styles.skipBtn}>Skip Word →</button>
          <button onClick={handleEndSession} disabled={processing} style={styles.endBtn}>
            {processing ? 'Processing…' : 'End Session'}
          </button>
        </div>

        {/* TTS Diagnostics (Dev Only) */}
        {window.location.hostname === 'localhost' && (
          <div style={{
            marginTop: 20,
            width: '100%',
            maxWidth: 560,
            padding: 12,
            background: 'rgba(13, 26, 29, 0.4)',
            border: '1px dashed rgba(255,255,255,0.1)',
            borderRadius: 12,
            fontSize: '0.75rem',
            color: '#9CA3AF',
            textAlign: 'left'
          }}>
            <details style={{ cursor: 'pointer' }}>
              <summary style={{ fontWeight: 'bold', color: '#22D3EE', userSelect: 'none' }}>
                🛠️ TTS Diagnostics & Voices ({voices.length} detected)
              </summary>
              <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'monospace', paddingLeft: 8, marginTop: 8 }}>
                {voices.map((v, idx) => (
                  <div key={`${v.name}-${idx}`} style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: 4 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ color: '#F472B6', fontWeight: 'bold' }}>[{v.lang}]</span>
                      <span style={{ color: '#FFF' }}>{v.name}</span>
                      <span style={{ color: '#10B981', fontSize: '0.65rem' }}>{v.voiceURI}</span>
                    </div>
                    <div style={{ color: '#6B7280', fontSize: '0.65rem', marginTop: 2 }}>
                      Local Service: {v.localService ? 'True' : 'False'} | Default: {v.default ? 'Yes' : 'No'}
                    </div>
                  </div>
                ))}
                {voices.length === 0 && <span style={{ color: '#EF4444' }}>No voices loaded yet. If you are on Chrome/Safari, wait a few seconds or trigger onvoiceschanged.</span>}
              </div>
            </details>
          </div>
        )}
      </div>

      {/* ── RIGHT PANEL ──────────────────────────────────────────────── */}
      <div style={styles.rightPanel} className="gp-right">
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',width:'100%'}}>
          <div style={styles.scoreTitle}>Session Score</div>
          <button onClick={handleLogout} style={styles.logoutBtn} title="Sign out"><LogOut size={13}/></button>
        </div>

        {/* Accuracy ring */}
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
          <svg viewBox="0 0 120 120" style={{width:100,height:100}}>
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(200,232,237,0.15)" strokeWidth="8"/>
            <circle cx="60" cy="60" r="52" fill="none" stroke="#E8841A" strokeWidth="8"
              strokeDasharray={`${2*Math.PI*52}`}
              strokeDashoffset={`${2*Math.PI*52*(1-accuracyPct/100)}`}
              strokeLinecap="round" transform="rotate(-90 60 60)"
              style={{transition:'stroke-dashoffset 0.6s ease'}}
            />
            <text x="60" y="66" textAnchor="middle"
              style={{fontFamily:'Inter,sans-serif',fontWeight:800,fontSize:'1.4rem',fill:'#0D5E6B'}}>
              {accuracyPct}%
            </text>
          </svg>
          <div style={{fontSize:'0.75rem',color:'#6B7280'}}>Accuracy</div>
        </div>

        {/* Score breakdown */}
        <div style={{width:'100%',display:'flex',flexDirection:'column',gap:8,borderTop:'1px solid rgba(255,255,255,0.07)',paddingTop:16}}>
          {[
            {label:'Perfect ✅', count:score.perfect, color:'#10B981'},
            {label:'Failed ❌',  count:score.failed,  color:'#EF4444'},
            {label:'Total',      count:score.total,   color:'#0D5E6B'},
          ].map(s=>(
            <div key={s.label} style={{display:'flex',justifyContent:'space-between',padding:'4px 0'}}>
              <span style={{fontSize:'0.8rem',color:'#6B7280'}}>{s.label}</span>
              <span style={{fontFamily:'Inter,sans-serif',fontWeight:700,color:s.color}}>{s.count}</span>
            </div>
          ))}
        </div>

        {/* Interaction guide */}
        <div style={styles.interactionGuide}>
          <div style={{fontSize:'0.72rem',fontWeight:700,color:'#0D5E6B',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.1em'}}>How to play</div>
          {[
            {icon:'☝️', label:'Point index finger at a key'},
            {icon:'⏱️', label:'Hold still 2.5 s = select'},
            {icon:'↕️', label:'Move to another key resets'},
            {icon:'⌫',  label:'Hold ⌫ 2.5 s to delete'},
            {icon:'🟢', label:'Green key = next letter'},
          ].map((g,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:8,fontSize:'0.73rem',color:'#9CA3AF',padding:'3px 0'}}>
              <span style={{fontSize:'0.95rem'}}>{g.icon}</span>{g.label}
            </div>
          ))}
        </div>

        {/* Last gesture feedback */}
        {lastGesture && (
          <AnimatePresence mode="wait">
            <motion.div
              key={`${lastGesture.letter}-${lastGesture.result}`}
              initial={{opacity:0,scale:0.85}} animate={{opacity:1,scale:1}} exit={{opacity:0}}
              style={{...styles.gestureFeedback, background:lastGesture.result==='Perfect'?'#D1FAE5':'#FEE2E2'}}
            >
              <div style={{fontSize:'1.4rem'}}>{lastGesture.result==='Perfect'?'✅':'❌'}</div>
              <div style={{fontWeight:600,fontSize:'0.85rem',color:'#1F2937'}}>{lastGesture.letter} — {lastGesture.result}</div>
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = {
  root: { display:'flex', minHeight:'100vh', background:'#0F1E22', overflowX:'hidden', overflowY:'auto', position:'relative' },

  superOverlay: { position:'absolute',top:0,left:0,width:'100%',height:'100%',background:'rgba(15,30,34,0.82)',backdropFilter:'blur(12px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:2000 },
  superContent: { display:'flex',flexDirection:'column',alignItems:'center',gap:16,zIndex:2001 },
  superText:    { fontFamily:'Inter,sans-serif',fontWeight:900,fontSize:'4rem',background:'linear-gradient(135deg,#FCD34D,#F59E0B)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',textTransform:'uppercase',letterSpacing:'0.05em',textAlign:'center' },

  // Dwell cursor — perfectly centered on the tracked point
  cursorOuter: {
    position: 'fixed',
    zIndex: 9999,
    pointerEvents: 'none',
    transform: `translate(-${CANVAS / 2}px, -${CANVAS / 2}px)`,
  },

  // Left panel
  leftPanel:  { width:300,display:'flex',flexDirection:'column',borderRight:'1px solid rgba(255,255,255,0.07)',zIndex:10,background:'#0D1A1D' },
  cameraBox:  { width:'100%',aspectRatio:'16 / 9',background:'#0D1A1D',position:'relative',overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center' },
  video:      { width:'100%',height:'100%',objectFit:'cover',transform:'scaleX(-1)' },
  canvas:     { position:'absolute',top:0,left:0,width:'100%',height:'100%',objectFit:'cover',transform:'scaleX(-1)',pointerEvents:'none' },
  cameraError:  { padding:24,textAlign:'center',color:'#9CA3AF' },
  trackingBadge:{ position:'absolute',top:10,right:10,display:'flex',alignItems:'center',gap:6,background:'rgba(0,0,0,0.6)',padding:'4px 10px',borderRadius:99,fontSize:'0.72rem',color:'#10B981' },
  trackingDot:  { display:'inline-block',width:6,height:6,borderRadius:'50%',background:'#10B981' },
  dwellBadge:   { position:'absolute',bottom:10,left:'50%',transform:'translateX(-50%)',padding:'5px 14px',borderRadius:99,fontSize:'0.74rem',color:'#fff',fontWeight:700,whiteSpace:'nowrap' },

  metricsPanel:      { padding:'16px',background:'#0D1A1D',borderTop:'1px solid rgba(255,255,255,0.07)' },
  metricsPanelTitle: { fontSize:'0.9rem',fontWeight:700,textTransform:'uppercase',letterSpacing:'1px',color:'#0D5E6B',marginBottom:16,paddingBottom:8,borderBottom:'1px solid rgba(13,94,107,0.1)' },
  levelBadgeMini:    { background:'linear-gradient(135deg,#1A8FA0,#14B8A6)',color:'white',padding:'4px 10px',borderRadius:'12px',fontSize:'0.75rem',fontWeight:'800' },
  metricsGrid:  { display:'grid',gridTemplateColumns:'1fr 1fr',gap:10 },
  metricItem:   { textAlign:'center' },
  metricValue:  { fontFamily:'Inter,sans-serif',fontWeight:800,fontSize:'1.2rem' },
  metricLabel:  { fontSize:'0.68rem',color:'#9CA3AF',textTransform:'uppercase',letterSpacing:'0.05em' },
  fatigueBar:   { height:6,background:'rgba(255,255,255,0.1)',borderRadius:3,overflow:'hidden' },
  fatigueFill:  { height:'100%',borderRadius:3,transition:'width 0.4s ease,background 0.4s ease' },

  // Center panel
  centerPanel: { flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'20px 14px',gap:18,zIndex:10 },

  progressionContainer: { width:'100%',maxWidth:560 },
  progressionText:      { fontFamily:'Inter,sans-serif',fontSize:'0.85rem',color:'#C8E8ED',fontWeight:700,marginBottom:8,textAlign:'center',textTransform:'uppercase',letterSpacing:'0.08em' },
  progressionBarBg:     { height:10,background:'rgba(255,255,255,0.1)',borderRadius:5,overflow:'hidden' },
  progressionBarFill:   { height:'100%',background:'linear-gradient(90deg,#E8841A,#F59E0B)',borderRadius:5,transition:'width 0.5s ease' },

  wordCard:       { display:'flex',flexDirection:'column',alignItems:'center',gap:12,background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:24,padding:'20px 44px',boxShadow:'0 12px 40px rgba(0,0,0,0.2)' },
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
  nextLetterHint: { fontSize:'0.82rem',color:'rgba(255,255,255,0.5)',background:'rgba(16,185,129,0.08)',border:'1px solid rgba(16,185,129,0.2)',borderRadius:20,padding:'5px 16px' },

  slotsContainer: { display:'flex',gap:12,marginTop:4,flexWrap:'wrap',justifyContent:'center' },
  slot:           { width:60,height:72,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:14,fontSize:'2rem',fontFamily:'Inter,sans-serif',fontWeight:800,color:'#C8E8ED',transition:'all 0.2s ease' },
  slotEmpty:      { background:'rgba(34,211,238,0.04)',border:'2px dashed rgba(34,211,238,0.35)',boxShadow:'0 0 16px rgba(34,211,238,0.06)' },
  slotCorrect:    { background:'rgba(16,185,129,0.15)',border:'2px solid #10B981',color:'#10B981',boxShadow:'0 0 18px rgba(16,185,129,0.4)' },
  slotWrong:      { background:'rgba(239,68,68,0.12)',border:'2px solid #EF4444',color:'#EF4444' },

  // Keyboard
  letterBoard: { display:'flex',flexDirection:'column',gap:13 },
  letterRow:   { display:'flex',gap:11,justifyContent:'center' },
  letterKey: {
    position: 'relative',
    width: 68, height: 68,
    background: 'rgba(255,255,255,0.07)',
    border: '2px solid rgba(255,255,255,0.14)',
    borderRadius: 14,
    color: '#C8E8ED',
    fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: '1.65rem',
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    userSelect: 'none', overflow: 'hidden',
    transition: 'background 0.12s, border 0.12s',
  },
  letterKeyBackspace: { fontSize:'1.2rem',width:82,background:'rgba(239,68,68,0.08)',border:'2px solid rgba(239,68,68,0.22)',color:'#EF4444' },
  letterKeyHovered:   { background:'rgba(34,211,238,0.13)',border:'2px solid rgba(34,211,238,0.45)' },
  letterKeyCorrect:   { background:'rgba(16,185,129,0.22)',border:'2px solid #10B981',color:'#10B981',boxShadow:'0 0 24px rgba(16,185,129,0.55)' },
  letterKeyDwelling:  { background:'rgba(34,211,238,0.18)',border:'2px solid #22d3ee' },
  correctDot: { position:'absolute',bottom:5,left:'50%',transform:'translateX(-50%)',width:6,height:6,borderRadius:'50%',background:'#10B981' },

  processingBanner: { background:'rgba(13,94,107,0.4)',border:'1px solid rgba(13,94,107,0.6)',borderRadius:16,padding:'24px 40px',textAlign:'center',color:'#C8E8ED',fontWeight:600 },

  controls: { display:'flex',gap:12,marginTop:4 },
  skipBtn:  { padding:'10px 20px',background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:10,color:'#9CA3AF',fontFamily:'Inter,sans-serif',fontWeight:500,fontSize:'0.875rem',cursor:'pointer' },
  endBtn:   { padding:'10px 24px',background:'#EF4444',border:'none',borderRadius:10,color:'#fff',fontFamily:'Inter,sans-serif',fontWeight:700,fontSize:'0.9rem',cursor:'pointer' },

  // Right panel
  rightPanel:       { width:220,background:'#0D1A1D',borderLeft:'1px solid rgba(255,255,255,0.07)',padding:'24px 16px',display:'flex',flexDirection:'column',alignItems:'center',gap:16,zIndex:10 },
  scoreTitle:       { fontFamily:'Inter,sans-serif',fontWeight:700,fontSize:'0.8rem',color:'#C8E8ED',textTransform:'uppercase',letterSpacing:'0.08em' },
  logoutBtn:        { display:'flex',alignItems:'center',justifyContent:'center',padding:'5px',background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:7,color:'#6B7280',cursor:'pointer' },
  interactionGuide: { width:'100%',background:'rgba(13,94,107,0.15)',border:'1px solid rgba(13,94,107,0.25)',borderRadius:12,padding:'12px' },
  gestureFeedback:  { width:'100%',borderRadius:10,padding:'12px',display:'flex',flexDirection:'column',alignItems:'center',gap:4,marginTop:'auto' },
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
    resize: 'vertical',
    outline: 'none',
    minHeight: 140,
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
