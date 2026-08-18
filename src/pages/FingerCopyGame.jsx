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
import { LogOut, Volume2, VolumeX, Clock, ArrowLeft } from 'lucide-react';
import useHandTracking from '../hooks/useHandTracking';
import useGestureDetection, {
  LEVELS,
  GESTURE_INFO,
  GESTURE_DEFS,
} from '../hooks/useGestureDetection';
import { soundManager } from '../utils/soundManager';
import { useAuthStore, useSessionStore } from '../store';
import api from '../services/api';
import '../styles/FingerCopyGame.css';

// ── Constants ──────────────────────────────────────────────────────────────
const MATCH_THRESHOLD   = 100;   // Accuracy % needed to count as matching
const HOLD_DURATION_MS  = 1000;  // Hold gesture for 1 second to confirm
const SUCCESS_DELAY_MS  = 1800;  // Delay before advancing to next challenge
const COUNTDOWN_SECONDS = 3;     // 3…2…1…Go!

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
  } = useHandTracking(videoRef, canvasRef, trackingEnabled);

  // ── Game state ──────────────────────────────────────────────────────────
  const [gamePhase, setGamePhase]       = useState('countdown'); // countdown | playing | success | results
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

  // Save session when game finishes (results phase)
  useEffect(() => {
    if (gamePhase === 'results' && currentSessionId && !sessionSaved) {
      setSessionSaved(true);
      const durationSeconds = Math.max(1, Math.round((Date.now() - (gameStartTime || Date.now())) / 1000));
      const avgAccuracy = Math.round(
        sessionStats.accuracies.length > 0
          ? sessionStats.accuracies.reduce((a, b) => a + b, 0) / sessionStats.accuracies.length
          : 100
      );
      const accuracyScore = parseFloat((avgAccuracy / 100).toFixed(2));

      api.post('/sessions/end', {
        session_id: currentSessionId,
        duration_seconds: durationSeconds,
        accuracy_score: accuracyScore,
        accuracy: avgAccuracy,
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

  // ── Elapsed time ticker ─────────────────────────────────────────────────
  useEffect(() => {
    if (gamePhase !== 'playing') {
      clearInterval(elapsedRef.current);
      return;
    }

    elapsedRef.current = setInterval(() => {
      if (challengeStartTime) {
        setElapsedTime(((Date.now() - challengeStartTime) / 1000).toFixed(1));
      }
    }, 100);

    return () => clearInterval(elapsedRef.current);
  }, [gamePhase, challengeStartTime]);

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
    if (gamePhase !== 'playing' || !currentTargetGesture) return;

    const isMatching = accuracy >= MATCH_THRESHOLD;

    if (isMatching) {
      if (!holdStartTime) {
        // Start holding
        setHoldStartTime(Date.now());
      }
    } else {
      // Reset hold if gesture breaks
      if (holdStartTime) {
        setHoldStartTime(null);
        setHoldProgress(0);
      }
    }
  }, [accuracy, gamePhase, currentTargetGesture, holdStartTime]);

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
        // All challenges done
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
