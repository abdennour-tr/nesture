/**
 * FingerCopyGame.jsx
 * Main game page for Magic Finger Copy.
 *
 * Flow: Countdown → Show Target → Detect Hand → Match Gesture (1s hold) →
 *       Success Animation → Next Challenge → Session Results
 *
 * Uses useHandTracking for MediaPipe camera/model and useGestureDetection
 * for classification. Supports 3 levels including gesture sequences (Level 3).
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, Volume2, VolumeX, Clock, ArrowLeft, HelpCircle } from 'lucide-react';
import useHandTracking from '../hooks/useHandTracking';
import useGestureDetection, {
  LEVELS,
  GESTURE_INFO,
  GESTURE_DEFS,
} from '../hooks/useGestureDetection';
import { soundManager } from '../utils/soundManager';
import GameRules from '../components/game/GameRules';
import EndGameControl from '../components/game/EndGameControl';
import { useAuthStore, useSessionStore } from '../store';
import api from '../services/api';
import '../styles/FingerCopyGame.css';
/* NOTE: GameShell.css is NOT imported here on purpose. It is already pulled in
   by GameRules / EndGameControl above, and an ES module is evaluated once at
   its FIRST import — so a later import would be a no-op and could not change
   the CSS order. The shared game frame wins by SPECIFICITY instead: see
   section 11 of GameShell.css. */

// ── Constants ──────────────────────────────────────────────────────────────
/* 80, not 100. Demanding a perfect landmark match made the game unplayable for
   the children it is meant for: a hand with reduced motor control rarely hits
   every finger exactly, and MediaPipe itself jitters by a few percent. 80 still
   requires the right shape, but leaves room for a real hand. */
const MATCH_THRESHOLD   = 80;    // Accuracy % needed to count as matching
const HOLD_DURATION_MS  = 1000;  // Hold gesture for 1 second to confirm
const SUCCESS_DELAY_MS  = 1800;  // Delay before advancing to next challenge
const COUNTDOWN_SECONDS = 3;     // 3…2…1…Go!
const RULES_FLAG        = 'fingercopy_rules_seen';
/* Reference time (seconds) to produce one gesture at each level; the Speed
   sub-score is measured against it, so a level with harder shapes is not
   punished for taking longer. */
const LEVEL_REF_SEC     = { 1: 6, 2: 8, 3: 12 };

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ── Encouraging messages pool ──────────────────────────────────────────────
const ENCOURAGEMENTS = [
  '⭐ Great Job!',
  '🎉 Excellent!',
  '✨ Amazing!',
  '🏆 Champion!',
  '💪 Perfect!',
  '🌟 Wonderful!',
  '🚀 Incredible!',
  '💎 Superstar!',
];

// ── Shuffle utility ────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Build challenges for a given level ─────────────────────────────────────
function buildChallenges(level) {
  const lvl = LEVELS[level];
  if (!lvl) return [];

  if (lvl.isSequence) {
    // Level 3: return sequences
    return lvl.sequences.map((seq) => ({
      type: 'sequence',
      gestures: seq,
    }));
  }

  // Level 1 & 2: pick gestures
  const pool = lvl.allGestures || lvl.gestures;
  const shuffled = shuffle(pool);
  return shuffled.slice(0, lvl.challengeCount).map((g) => ({
    type: 'single',
    gesture: g,
  }));
}

/* ═══════════════════════════════════════════════════════════════════════════
   RULES MODAL — shown once per tab, before the countdown
   ═══════════════════════════════════════════════════════════════════════════ */
const RULES = [
  { icon: '✋', text: 'Copy the gesture on the card with your own hand.' },
  { icon: '🎯', text: `The ring shows how close you are — reach ${MATCH_THRESHOLD}% to start the hold.` },
  { icon: '⏱️', text: 'Hold the shape still for 1 second to validate it.' },
  { icon: '🔁', text: 'If your hand leaves the shape, the hold restarts from zero.' },
  { icon: '🔢', text: 'Level 3 chains several gestures — do them in order.' },
  { icon: '🖐️', text: 'Either hand works; the game notes which one you favour.' },
];

/* `resume` = opened from the in-game "How to play" button rather than shown
   automatically before the first round, so the primary button returns to the
   game instead of starting one. */
/* Thin wrapper over the shared rules card — see GameRules.jsx. */
function RulesModal({ level, onStart, resume = false }) {
  return (
    <GameRules
      emoji="🖐️"
      title="Magic Finger Copy"
      subtitle={`${LEVELS[level]?.label || ''} · ${LEVELS[level]?.isSequence ? 'sequences' : 'single shapes'}`}
      rules={RULES}
      note={<><strong>OT Score</strong> = Match accuracy 30% · Hold stability 25% · Speed 25% · Consistency 20%</>}
      onStart={onStart}
      resume={resume}
    />
  );
}

// ── Confetti component ─────────────────────────────────────────────────────
function Confetti({ show }) {
  if (!show) return null;
  const colors = ['#8B5CF6', '#EC4899', '#10B981', '#F59E0B', '#3B82F6', '#EF4444'];
  const pieces = Array.from({ length: 30 }, (_, i) => ({
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
          className="fc-confetti-piece"
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

// ═══════════════════════════════════════════════════════════════════════════
export default function FingerCopyGame() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const level = parseInt(searchParams.get('level') || '1', 10);

  // ── Session & Auth Integration ──────────────────────────────────────────
  const { user, profile } = useAuthStore();
  const { startSession: storeStartSession, endSession: storeEndSession } = useSessionStore();
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [gameStartTime, setGameStartTime] = useState(null);
  const [sessionSaved, setSessionSaved] = useState(false);

  // ── Refs ────────────────────────────────────────────────────────────────
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);

  // ── Hand tracking (MediaPipe) ───────────────────────────────────────────
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const {
    landmarks,
    multiHandData,
    isTracking,
    error: trackingError,
    isSimulationMode,
    releaseCamera,
  } = useHandTracking(videoRef, canvasRef, trackingEnabled);

  // ── Game state ──────────────────────────────────────────────────────────
  /* "How to play" — re-openable at any time from the header's "?" button.
     Client feedback: "there should be an optional provision for user to see
     [the instructions] again if they wish to." */
  const [showHelp, setShowHelp] = useState(false);
  const [gamePhase, setGamePhase]       = useState(
    () => (sessionStorage.getItem(RULES_FLAG) ? 'countdown' : 'rules')
  ); // rules | countdown | playing | success | results

  /* Whenever the round is not actually running, the camera must be off.
     This is the safety net that catches every exit path — finishing the last
     challenge, backing out, or any future phase we forget about.
     Declared after `gamePhase` so the dependency array can reference it. */
  useEffect(() => {
    if (gamePhase === 'results') {
      setTrackingEnabled(false);
      releaseCamera();
    }
  }, [gamePhase, releaseCamera]);
  const [countdown, setCountdown]       = useState(COUNTDOWN_SECONDS);
  const [challenges, setChallenges]     = useState([]);
  const [currentIdx, setCurrentIdx]     = useState(0);
  const [seqIdx, setSeqIdx]             = useState(0); // For Level 3 sequences
  const [score, setScore]               = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [encourageMsg, setEncourageMsg] = useState('');
  const [showConfetti, setShowConfetti] = useState(false);
  const [successPoints, setSuccessPoints] = useState(0);

  // ── Per-challenge tracking ──────────────────────────────────────────────
  const [challengeStartTime, setChallengeStartTime] = useState(null);
  const [holdStartTime, setHoldStartTime]           = useState(null);
  const [holdProgress, setHoldProgress]             = useState(0);
  const [elapsedTime, setElapsedTime]               = useState(0);

  // ── Session-level stats ─────────────────────────────────────────────────
  const [sessionStats, setSessionStats] = useState({
    totalScore: 0,
    accuracies: [],
    responseTimes: [],
    handsUsed: { left: 0, right: 0 },
  });

  /* Raw OT counters. They live in a ref because the match loop runs on every
     tracking frame and must never trigger a render. */
  const otRef = useRef({ holdBreaks: 0, holdsStarted: 0 });
  const [otResults, setOtResults] = useState(null);

  // ── Current target gesture ──────────────────────────────────────────────
  const currentChallenge = challenges[currentIdx] || null;
  let currentTargetGesture = null;

  if (currentChallenge) {
    if (currentChallenge.type === 'sequence') {
      currentTargetGesture = currentChallenge.gestures[seqIdx] || null;
    } else {
      currentTargetGesture = currentChallenge.gesture;
    }
  }

  // ── Gesture detection ───────────────────────────────────────────────────
  const { detectedGesture, fingerStates, accuracy, handedness, isHandDetected } =
    useGestureDetection(landmarks, multiHandData, currentTargetGesture);

  // ── Refs for interval/timeout IDs ───────────────────────────────────────
  const holdTimerRef   = useRef(null);
  const elapsedRef     = useRef(null);

  // ── Initialize challenges ───────────────────────────────────────────────
  useEffect(() => {
    const builtChallenges = buildChallenges(level);
    setChallenges(builtChallenges);
    // Sound manager init
    soundManager.init();
  }, [level]);

  // ── Session API integration ─────────────────────────────────────────────
  useEffect(() => {
    if (!currentSessionId && (gamePhase === 'countdown' || gamePhase === 'playing')) {
      const learnerId = profile?.learner_id || user?.id || '00000000-0000-0000-0000-000000000010';
      const diff = level === 1 ? 'easy' : level === 2 ? 'medium' : 'hard';
      setGameStartTime(Date.now());
      api.post('/sessions/start', {
        learner_id: learnerId,
        difficulty: diff,
        game_name: 'Magic Finger Copy'
      }).then(res => {
        const sid = res.data?.session_id;
        if (sid) {
          setCurrentSessionId(sid);
          storeStartSession(sid, learnerId, diff);
        }
      }).catch(err => console.warn('[FingerCopyGame] Could not start session:', err));
    }
  }, [gamePhase, currentSessionId, level, profile, user, storeStartSession]);

  /* ── OT score ──────────────────────────────────────────────────────────
     Computed in its own effect rather than inside the success timeout, so it
     reads the final sessionStats instead of a stale closure. */
  useEffect(() => {
    if (gamePhase !== 'results' || otResults) return;

    const accs = sessionStats.accuracies;
    const times = sessionStats.responseTimes;
    const ot = otRef.current;

    /* EVERY SUB-SCORE IS `null` WHEN THERE IS NO DATA FOR IT.
       These used to default to 100 on an empty accumulator — no holds meant no
       broken holds, no timings meant nothing slower than the reference, one
       gesture meant no spread. Ending the round on the first screen therefore
       produced a perfect OT score beside "0 gestures". Absence of evidence is
       not a perfect performance: unmeasured components are reported as null
       and left out of the composite, which is renormalised over what WAS
       measured. Nothing measured at all → no composite. */

    // 1. Match accuracy — how well the hand reproduced each shape.
    const matchAccuracy = accs.length
      ? accs.reduce((a, b) => a + b, 0) / accs.length : null;

    // 2. Hold stability — a hold that collapses before the second is up means
    //    the grip was not steady. Every restart costs.
    const stability = ot.holdsStarted
      ? clamp01(1 - ot.holdBreaks / ot.holdsStarted) * 100 : null;

    // 3. Speed — against a per-level reference, never above 100.
    const avgTime = times.length
      ? times.reduce((a, b) => a + b, 0) / times.length : 0;
    const speedScore = avgTime > 0
      ? clamp01((LEVEL_REF_SEC[level] || 8) / avgTime) * 100 : null;

    // 4. Consistency — spread of the per-gesture accuracies. A child who is
    //    steady across every shape scores higher than one who alternates
    //    between perfect and poor, even at the same average. Needs at least
    //    two gestures to mean anything.
    let consistency = null;
    if (accs.length > 1) {
      const variance = accs.reduce((a, v) => a + (v - matchAccuracy) ** 2, 0) / accs.length;
      consistency = clamp01(1 - Math.sqrt(variance) / 25) * 100;
    }

    const parts = [
      [matchAccuracy, 0.30],
      [stability,     0.25],
      [speedScore,    0.25],
      [consistency,   0.20],
    ].filter(([v]) => v != null);
    const weight = parts.reduce((a, [, w]) => a + w, 0);
    const composite = weight > 0
      ? Math.round(parts.reduce((a, [v, w]) => a + v * w, 0) / weight)
      : null;

    const round = (v) => (v == null ? null : Math.round(v));

    setOtResults({
      composite,
      matchAccuracy: round(matchAccuracy),
      stability:     round(stability),
      speedScore:    round(speedScore),
      consistency:   round(consistency),
      holdBreaks: ot.holdBreaks,
      avgResponseSec: avgTime,
      gesturesScored: accs.length,
    });
  }, [gamePhase, otResults, sessionStats, level]);

  // Save session when game finishes (results phase)
  useEffect(() => {
    if (gamePhase === 'results' && currentSessionId && !sessionSaved && otResults) {
      setSessionSaved(true);
      const durationSeconds = Math.max(1, Math.round((Date.now() - (gameStartTime || Date.now())) / 1000));
      /* 0, not 100, when nothing was attempted: this value is written to the
         session record, and an empty round must never be stored as perfect. */
      const avgAccuracy = Math.round(
        sessionStats.accuracies.length > 0
          ? sessionStats.accuracies.reduce((a, b) => a + b, 0) / sessionStats.accuracies.length
          : 0
      );
      /* The OT composite is the headline number for therapists; the raw match
         average stays as the fallback. */
      const otScore = otResults?.composite ?? avgAccuracy;
      const accuracyScore = parseFloat((otScore / 100).toFixed(2));

      api.post('/sessions/end', {
        session_id: currentSessionId,
        duration_seconds: durationSeconds,
        accuracy_score: accuracyScore,
        accuracy: otScore,
        metrics: otResults ? {
          otScore: otResults.composite,
          matchAccuracy: otResults.matchAccuracy,
          stability: otResults.stability,
          speedScore: otResults.speedScore,
          consistency: otResults.consistency,
          holdBreaks: otResults.holdBreaks,
        } : undefined,
        perfect_grabs: sessionStats.accuracies.length,
        total_attempts: challenges.length || 1,
        game_name: 'Magic Finger Copy'
      }).then(() => {
        storeEndSession({
          duration: durationSeconds,
          accuracy: avgAccuracy,
          perfectGrabs: sessionStats.accuracies.length
        });
      }).catch(err => console.error('[FingerCopyGame] Failed to save end session:', err));
    }
  }, [gamePhase, currentSessionId, sessionSaved, sessionStats, challenges.length, gameStartTime, storeEndSession]);
  // ── Countdown phase ─────────────────────────────────────────────────────
  useEffect(() => {
    if (gamePhase !== 'countdown') return;

    if (countdown <= 0) {
      // Go!
      if (soundEnabled) soundManager.playCountdownGo();
      setGamePhase('playing');
      setTrackingEnabled(true);
      setChallengeStartTime(Date.now());
      return;
    }

    const timer = setTimeout(() => {
      if (soundEnabled) soundManager.playCountdown();
      setCountdown((c) => c - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [gamePhase, countdown, soundEnabled]);

  /* Opening "How to play" mid-challenge must not cost the learner time: the
     ticker stops while the modal is up, and on close the challenge start time
     is pushed forward by exactly how long the modal was open. */
  const helpOpenedAtRef = useRef(0);

  const openHelp = useCallback(() => {
    helpOpenedAtRef.current = Date.now();
    setShowHelp(true);
  }, []);

  const closeHelp = useCallback(() => {
    const paused = helpOpenedAtRef.current ? Date.now() - helpOpenedAtRef.current : 0;
    helpOpenedAtRef.current = 0;
    setShowHelp(false);
    if (paused > 0) setChallengeStartTime((t) => (t ? t + paused : t));
  }, []);

  // ── Elapsed time ticker ─────────────────────────────────────────────────
  useEffect(() => {
    if (gamePhase !== 'playing' || showHelp) {
      clearInterval(elapsedRef.current);
      return;
    }

    elapsedRef.current = setInterval(() => {
      if (challengeStartTime) {
        setElapsedTime(((Date.now() - challengeStartTime) / 1000).toFixed(1));
      }
    }, 100);

    return () => clearInterval(elapsedRef.current);
  }, [gamePhase, challengeStartTime, showHelp]);

  // ── Track handedness stats ──────────────────────────────────────────────
  useEffect(() => {
    if (gamePhase === 'playing' && handedness && handedness !== 'both') {
      setSessionStats((prev) => ({
        ...prev,
        handsUsed: {
          ...prev.handsUsed,
          [handedness]: prev.handsUsed[handedness] + 1,
        },
      }));
    }
  }, [handedness, gamePhase]);

  // ── Gesture match & hold logic ──────────────────────────────────────────
  useEffect(() => {
    if (gamePhase !== 'playing' || showHelp || !currentTargetGesture) return;

    const isMatching = accuracy >= MATCH_THRESHOLD;

    if (isMatching) {
      if (!holdStartTime) {
        // Start holding
        otRef.current.holdsStarted += 1;
        setHoldStartTime(Date.now());
      }
    } else {
      // Reset hold if gesture breaks
      if (holdStartTime) {
        /* A hold that collapses before the second is up is the clearest signal
           of an unsteady grip — it is the Hold stability sub-score. */
        otRef.current.holdBreaks += 1;
        setHoldStartTime(null);
        setHoldProgress(0);
      }
    }
  }, [accuracy, gamePhase, showHelp, currentTargetGesture, holdStartTime]);

  // ── Handle successful gesture match ─────────────────────────────────────
  const handleSuccess = useCallback(() => {
    // Prevent double-trigger
    if (gamePhase !== 'playing') return;

    const responseTime = challengeStartTime
      ? (Date.now() - challengeStartTime) / 1000
      : 0;

    // Calculate points
    const timeBonus = Math.max(0, Math.round((30 - responseTime) * 2));
    const accuracyBonus = Math.floor(accuracy * 0.5);
    const points = 100 + timeBonus + accuracyBonus;

    // For Level 3 sequences: check if more gestures remain in sequence
    if (currentChallenge?.type === 'sequence') {
      const nextSeqIdx = seqIdx + 1;
      if (nextSeqIdx < currentChallenge.gestures.length) {
        // Advance within sequence
        if (soundEnabled) soundManager.playProgress();
        setSeqIdx(nextSeqIdx);
        setHoldStartTime(null);
        setHoldProgress(0);
        setEncourageMsg('✨ Next gesture!');
        setTimeout(() => setEncourageMsg(''), 1200);
        return;
      }
    }

    // Full challenge complete
    setGamePhase('success');
    setSuccessPoints(points);
    setScore((s) => s + points);
    setShowConfetti(true);

    // Pick random encouragement
    const msg = ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)];
    setEncourageMsg(msg);

    // Sound
    if (soundEnabled) soundManager.playComplete();

    // Update session stats
    setSessionStats((prev) => ({
      ...prev,
      totalScore: prev.totalScore + points,
      accuracies: [...prev.accuracies, accuracy],
      responseTimes: [...prev.responseTimes, responseTime],
    }));

    // After delay, advance to next challenge or show results
    setTimeout(() => {
      setShowConfetti(false);

      const nextIdx = currentIdx + 1;
      if (nextIdx >= challenges.length) {
        // All challenges done — the round is over, so release the webcam.
        // `trackingEnabled` was previously set to true at the start of play and
        // never set back, which left the camera (and its privacy light) on
        // through the whole results screen.
        setTrackingEnabled(false);
        setGamePhase('results');
        if (soundEnabled) soundManager.playCelebration();
      } else {
        // Next challenge
        setCurrentIdx(nextIdx);
        setSeqIdx(0);
        setHoldStartTime(null);
        setHoldProgress(0);
        setChallengeStartTime(Date.now());
        setElapsedTime(0);
        setEncourageMsg('');
        setGamePhase('playing');
      }
    }, SUCCESS_DELAY_MS);
  }, [
    gamePhase, challengeStartTime, accuracy, currentChallenge,
    seqIdx, currentIdx, challenges.length, soundEnabled, score,
  ]);

  // ── Smooth Hold Progress Timer ───────────────────────────────────────────
  useEffect(() => {
    let interval;
    if (holdStartTime) {
      interval = setInterval(() => {
        const elapsed = Date.now() - holdStartTime;
        const progress = Math.min(1, elapsed / HOLD_DURATION_MS);
        setHoldProgress(progress);

        if (progress >= 1) {
          handleSuccess();
          setHoldStartTime(null); // Prevent multiple triggers
        }
      }, 50); // 20fps for smooth progress bar
    } else {
      setHoldProgress(0);
    }
    return () => clearInterval(interval);
  }, [holdStartTime, handleSuccess]);

  // ── Toggle sound ────────────────────────────────────────────────────────
  const toggleSound = () => {
    const newState = soundManager.toggle();
    setSoundEnabled(newState);
  };

  // ── Play again ──────────────────────────────────────────────────────────
  const handlePlayAgain = () => {
    const builtChallenges = buildChallenges(level);
    setChallenges(builtChallenges);
    setCurrentIdx(0);
    setSeqIdx(0);
    setScore(0);
    setHoldStartTime(null);
    setHoldProgress(0);
    setElapsedTime(0);
    setCountdown(COUNTDOWN_SECONDS);
    setGamePhase('countdown');
    setEncourageMsg('');
    setCurrentSessionId(null);
    setSessionSaved(false);
    otRef.current = { holdBreaks: 0, holdsStarted: 0 };
    setOtResults(null);
    setSessionStats({
      totalScore: 0,
      accuracies: [],
      responseTimes: [],
      handsUsed: { left: 0, right: 0 },
    });
  };

  // ── Match ring SVG parameters ───────────────────────────────────────────
  const ringRadius     = 42;
  const ringCirc       = 2 * Math.PI * ringRadius;
  const accuracyFill   = ringCirc - (ringCirc * Math.min(accuracy, 100)) / 100;
  const isHighAccuracy = accuracy >= MATCH_THRESHOLD;

  // ── Finger status display ───────────────────────────────────────────────
  const fingerNames = ['thumb', 'index', 'middle', 'ring', 'pinky'];
  const fingerLabels = { thumb: 'T', index: 'I', middle: 'M', ring: 'R', pinky: 'P' };

  function getFingerStatus(fingerName) {
    if (!fingerStates || !currentTargetGesture) return '';
    const def = GESTURE_DEFS[currentTargetGesture];
    if (!def) return '';
    const expected = def[fingerName];
    if (expected === 'special' || expected === 'any') return 'correct'; // Don't show error for special
    return fingerStates[fingerName] === expected ? 'correct' : 'wrong';
  }

  // ── Compute session results ─────────────────────────────────────────────
  const avgAccuracy = sessionStats.accuracies.length
    ? Math.round(sessionStats.accuracies.reduce((a, b) => a + b, 0) / sessionStats.accuracies.length)
    : 0;
  const avgResponseTime = sessionStats.responseTimes.length
    ? (sessionStats.responseTimes.reduce((a, b) => a + b, 0) / sessionStats.responseTimes.length).toFixed(1)
    : '0.0';
  const preferredHand =
    sessionStats.handsUsed.right > sessionStats.handsUsed.left
      ? 'Right ✋'
      : sessionStats.handsUsed.left > sessionStats.handsUsed.right
      ? 'Left 🤚'
      : 'Both 🙌';

  // ── Target gesture info ─────────────────────────────────────────────────
  const targetInfo = currentTargetGesture ? GESTURE_INFO[currentTargetGesture] : null;

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="fc-page">
      {/* ── Confetti ─────────────────────────────────────────────────── */}
      <Confetti show={showConfetti} />

      {/* ── Rules ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {gamePhase === 'rules' && (
          <RulesModal
            key="rules"
            level={level}
            onStart={() => {
              /* Remembered per tab: replaying skips the rules, a fresh visit
                 always shows them. */
              sessionStorage.setItem(RULES_FLAG, '1');
              setGamePhase('countdown');
            }}
          />
        )}

        {/* Same modal, reopened on demand from the header's "?" button. */}
        {showHelp && gamePhase !== 'rules' && (
          <RulesModal
            key="help"
            level={level}
            resume
            onStart={closeHelp}
          />
        )}
      </AnimatePresence>

      {/* ── Countdown Overlay ────────────────────────────────────────── */}
      <AnimatePresence>
        {gamePhase === 'countdown' && (
          <motion.div
            className="fc-countdown-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              key={countdown}
              initial={{ scale: 0.3, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 2, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 15 }}
            >
              <div className="fc-countdown-number">
                {countdown > 0 ? countdown : 'Go!'}
              </div>
            </motion.div>
            <div className="fc-countdown-label">Get your hand ready!</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Success Overlay ──────────────────────────────────────────── */}
      <AnimatePresence>
        {gamePhase === 'success' && (
          <motion.div
            className="fc-success-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="fc-success-content">
              <div className="fc-success-emoji">🎉</div>
              <div className="fc-success-text">{encourageMsg}</div>
              <div className="fc-success-points">+{successPoints} points</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Results Overlay ──────────────────────────────────────────── */}
      <AnimatePresence>
        {gamePhase === 'results' && (
          <motion.div
            className="fc-results-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <motion.div
              className="fc-results-card"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 18, delay: 0.2 }}
            >
              <div style={{ fontSize: '3rem', marginBottom: 8 }}>🏆</div>
              <div className="fc-results-title">Session Complete!</div>
              <div className="fc-results-subtitle">
                Level {level} — {LEVELS[level]?.label}
              </div>

              {/* `null` = not measured: shown as "—" with an empty bar, never
                  as 0% (reads as failure) and never as 100% (what it used to
                  do). With nothing measured at all the block is replaced by a
                  plain note — a report a therapist reads must not imply a
                  result it does not have. */}
              {otResults && otResults.composite != null && (
                <div className="fc-ot-block">
                  <div className="fc-perf-ring" style={{ '--pct': otResults.composite }}>
                    <div className="fc-perf-inner">
                      <span className="fc-perf-val">{otResults.composite}</span>
                      <span className="fc-perf-lbl">OT Score</span>
                    </div>
                  </div>
                  <div className="fc-ot-bars">
                    {[
                      ['Match accuracy', otResults.matchAccuracy, '30%'],
                      ['Hold stability', otResults.stability,     '25%'],
                      ['Speed',          otResults.speedScore,    '25%'],
                      ['Consistency',    otResults.consistency,   '20%'],
                    ].map(([label, value, weight]) => (
                      <div className="fc-ot-bar" key={label}>
                        <div className="fc-ot-bar-head">
                          <span>{label} <em>{weight}</em></span>
                          <strong>{value == null ? '—' : `${value}%`}</strong>
                        </div>
                        <div className="fc-ot-bar-track">
                          <motion.div
                            className="fc-ot-bar-fill"
                            initial={{ width: 0 }}
                            animate={{ width: `${value == null ? 0 : value}%` }}
                            transition={{ duration: 0.7, delay: 0.3 }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {otResults && otResults.composite == null && (
                <div className="tt-ot-none">
                  No OT score for this session — the round ended before any
                  gesture was completed, so there is nothing to measure.
                </div>
              )}

              <div className="fc-results-grid">
                <div className="fc-result-item">
                  <div className="fc-result-value" style={{ color: '#22D3EE' }}>
                    {sessionStats.totalScore}
                  </div>
                  <div className="fc-result-label">Total Score</div>
                </div>
                <div className="fc-result-item">
                  <div className="fc-result-value" style={{ color: '#10B981' }}>
                    {avgAccuracy}%
                  </div>
                  <div className="fc-result-label">Avg Accuracy</div>
                </div>
                <div className="fc-result-item">
                  <div className="fc-result-value" style={{ color: '#E8841A' }}>
                    {avgResponseTime}s
                  </div>
                  <div className="fc-result-label">Avg Response</div>
                </div>
                <div className="fc-result-item">
                  <div className="fc-result-value" style={{ color: '#A78BFA' }}>
                    {preferredHand}
                  </div>
                  <div className="fc-result-label">Preferred Hand</div>
                </div>
              </div>

              <div className="fc-results-actions">
                <button className="fc-btn-primary" onClick={handlePlayAgain}>
                  🔄 Play Again
                </button>
                <button className="fc-btn-secondary" onClick={() => navigate('/play')}>
                  🏠 Home
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="fc-header">
        <div className="fc-header-left">
          <div className="fc-score-badge">
            <span className="score-icon">⭐</span>
            <span>{score}</span>
          </div>
          <div className="fc-level-badge">
            🖐️ Level {level} — {LEVELS[level]?.label}
          </div>
        </div>
        <div className="fc-header-right">
          {/* End the round early and go straight to the report — the same
              control LetterQuest has. Setting the phase to 'results' is all
              that is needed here: the OT score is computed by an effect keyed
              on that phase, so a short session is scored exactly like a full
              one, from whatever has been done. */}
          <EndGameControl
            className="fc-sound-btn gs-end-btn"
            compact
            disabled={gamePhase !== 'playing'}
            onConfirm={() => { setTrackingEnabled(false); setGamePhase('results'); }}
          />
          <button
            className="fc-sound-btn"
            onClick={openHelp}
            title="How to play"
            aria-label="How to play"
          >
            <HelpCircle size={18} />
          </button>
          <div className="fc-timer">
            <Clock size={16} />
            <span>{elapsedTime}s</span>
          </div>
          <button className="fc-sound-btn" onClick={toggleSound} title="Toggle sound">
            {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button className="fc-exit-btn" onClick={() => navigate('/play')}>
            <LogOut size={16} />
            Exit
          </button>
        </div>
      </div>

      {/* ── Main Content ─────────────────────────────────────────────── */}
      <div className="fc-main">
        {/* ── Game Area ─────────────────────────────────────────────── */}
        <div className="fc-game-area">
          {/* ── Target Card ──────────────────────────────────────────── */}
          <motion.div
            className={`fc-target-card ${isHighAccuracy && holdProgress > 0 ? 'matched' : ''}`}
            key={currentTargetGesture}
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          >
            <div className="fc-target-label">Copy this gesture</div>

            {targetInfo ? (
              <>
                <div className="fc-target-emoji">{targetInfo.emoji}</div>
                <div className="fc-target-name">{targetInfo.name}</div>
                <div className="fc-target-hint">
                  Hold the gesture for 1 second
                </div>
              </>
            ) : (
              <>
                <div className="fc-target-emoji">🖐️</div>
                <div className="fc-target-name">Get Ready!</div>
              </>
            )}

            {/* ── Sequence indicator (Level 3) ───────────────────────── */}
            {currentChallenge?.type === 'sequence' && (
              <div className="fc-sequence-row">
                {currentChallenge.gestures.map((g, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="fc-seq-arrow">→</span>}
                    <div
                      className={`fc-seq-step ${
                        i === seqIdx ? 'active' : i < seqIdx ? 'completed' : ''
                      }`}
                    >
                      <span className="seq-emoji">{GESTURE_INFO[g]?.emoji}</span>
                      <span className="seq-dot" />
                    </div>
                  </React.Fragment>
                ))}
              </div>
            )}
          </motion.div>

          {/* ── Webcam ───────────────────────────────────────────────── */}
          <div className="fc-webcam-container">
            {/* Hidden video element for MediaPipe */}
            <video
              ref={videoRef}
              className="fc-webcam-video"
              playsInline
              muted
              autoPlay
            />
            {/* Canvas overlay for landmark drawing */}
            <canvas
              ref={canvasRef}
              className="fc-webcam-canvas"
              width={640}
              height={480}
            />

            {/* Webcam overlay info */}
            <div className="fc-webcam-overlay">
              <div className="fc-detected-label">
                <span
                  className={`fc-hand-indicator ${!isHandDetected ? 'no-hand' : ''}`}
                />
                {isHandDetected
                  ? `${detectedGesture ? GESTURE_INFO[detectedGesture]?.name || 'Unknown' : 'Detecting...'}`
                  : 'Show your hand'}
              </div>
              {handedness && handedness !== 'both' && (
                <div className="fc-detected-label" style={{ opacity: 0.7, fontSize: '0.8rem' }}>
                  {handedness === 'right' ? '✋ Right' : '🤚 Left'}
                </div>
              )}
            </div>

            {/* Simulation mode notice */}
            {isSimulationMode && (
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  left: 12,
                  background: 'rgba(245, 158, 11, 0.9)',
                  color: '#fff',
                  padding: '4px 12px',
                  borderRadius: 8,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}
              >
                📷 Camera unavailable — Simulation mode
              </div>
            )}
          </div>
        </div>

        {/* ── Progress Bar ────────────────────────────────────────────── */}
        <div className="fc-progress-section">
          <div className="fc-progress-bar-bg">
            <div
              className="fc-progress-bar-fill"
              style={{
                width: `${challenges.length ? ((currentIdx + (gamePhase === 'results' ? 1 : 0)) / challenges.length) * 100 : 0}%`,
              }}
            />
          </div>
          <span className="fc-progress-text">
            {Math.min(currentIdx + 1, challenges.length)} / {challenges.length}
          </span>
        </div>

        {/* ── Match Section ───────────────────────────────────────────── */}
        {gamePhase === 'playing' && (
          <motion.div
            className="fc-match-section"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {/* Match Ring */}
            <div className="fc-match-ring-wrapper">
              <svg className="fc-match-ring-svg" viewBox="0 0 100 100">
                <circle
                  className="fc-match-ring-bg"
                  cx="50"
                  cy="50"
                  r={ringRadius}
                />
                <circle
                  className={`fc-match-ring-progress ${isHighAccuracy ? 'high' : ''}`}
                  cx="50"
                  cy="50"
                  r={ringRadius}
                  strokeDasharray={ringCirc}
                  strokeDashoffset={accuracyFill}
                />
              </svg>
              <div className="fc-match-center">
                <div className="fc-match-percent">{accuracy}%</div>
                <div className="fc-match-label">Match</div>
              </div>
            </div>

            {/* Hold Progress Bar */}
            <div className="fc-hold-info">
              <div className="fc-hold-text">
                {holdProgress > 0
                  ? `Hold: ${Math.round(holdProgress * 100)}%`
                  : 'Match the gesture to start hold'}
              </div>
              <div className="fc-hold-bar-bg">
                <div
                  className="fc-hold-bar-fill"
                  style={{ width: `${holdProgress * 100}%` }}
                />
              </div>
            </div>

            {/* Finger Status */}
            {fingerStates && currentTargetGesture && (
              <div className="fc-finger-status">
                {fingerNames.map((f) => (
                  <div key={f} className="fc-finger-dot">
                    <div className={`dot ${getFingerStatus(f)}`} />
                    <span className="label">{fingerLabels[f]}</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* ── Encouraging Message ─────────────────────────────────────── */}
        <AnimatePresence>
          {encourageMsg && gamePhase === 'playing' && (
            <motion.div
              className="fc-encourage"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
            >
              <span className="fc-encourage-text">{encourageMsg}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
