import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { ArrowLeft, Volume2, VolumeX, Clock, LogOut, Menu, X } from 'lucide-react';
import { useSessionStore, useAuthStore } from '../store';
import { supabase } from '../services/supabaseClient';
import useMediaPipeTracking, { LANDMARKS, calculateSmoothness } from '../hooks/useMediaPipeTracking';
import { useReflexEngine } from '../hooks/useReflexEngine';
import api from '../services/api';
import { ALL_PATHS, DIFFICULTY_CONFIG, samplePathPoints, getRandomPaths } from '../components/game/pathData';
import { soundManager } from '../utils/soundManager';
import useSoundEnabled from '../hooks/useSoundEnabled';
import '../styles/PathTracingGame.css';

// ── Constants ─────────────────────────────────────────────────────────────────
const TARGET_PATHS     = 5;       // paths per session
const COUNTDOWN_SECS   = 3;       // 3-2-1 countdown
const DWELL_START_MS   = 1500;    // 1.5s dwell to start tracing
const CELEBRATION_MS   = 3000;    // celebration duration between paths
const CANVAS_SIZE      = 400;     // logical canvas size (matches viewBox)
const SAMPLE_POINTS    = 200;     // points to sample from each SVG path

const ENCOURAGEMENTS = [
  'Super ! 🌟', 'Bravo ! 🎉', 'Incroyable ! ✨',
  'Champion ! 🏆', 'Parfait ! ⭐', 'Génial ! 🐾',
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function distToPath(px, py, points) {
  let minDist = Infinity;
  let closestIdx = 0;
  for (let i = 0; i < points.length; i++) {
    const dx = px - points[i].x;
    const dy = py - points[i].y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < minDist) {
      minDist = d;
      closestIdx = i;
    }
  }
  return { distance: minDist, closestIndex: closestIdx };
}

function formatTime(s) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function PathTracingGame() {
  const [searchParams] = useSearchParams();
  const difficulty = searchParams.get('difficulty') || 'easy';
  const config = DIFFICULTY_CONFIG[difficulty] || DIFFICULTY_CONFIG.easy;
  const navigate = useNavigate();
  const { user, profile, logout } = useAuthStore();
  const { activeSession, startSession, recordGesture, endSession } = useSessionStore();

  // ── Tracking ─────────────────────────────────────────────────────
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  
  // Hand tracking saving refs
  const activeSessionRef  = useRef(null);
  const capturedPositions = useRef([]);
  const trackingSaved     = useRef(false);
  // Turned off the moment the round ends or the player leaves, so the
  // webcam light goes off instead of staying lit until unmount.
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const {
    landmarks, multiHandData, isTracking, error: cameraError,
    positionBuffer, faceLandmarks, headPose, faceCanvasRef,
    /* One finger traces the shape, so one hand owns the round — the other
       hand, however much it moves, is ignored. */
  } = useMediaPipeTracking(videoRef, canvasRef, cameraEnabled, { handSideLock: true });

  // ── Reflex Engine ────────────────────────────────────────────────
  const { startTracking, stopTracking, pushFrame } = useReflexEngine({ analyzeEveryMs: 4000 });
  const reflexEngineOutputRef = useRef(null);

  /* ── What the reflex engine is fed ──────────────────────────────────────
     The game loop below is a useCallback whose dependency list does not
     include multiHandData, faceLandmarks or headPose, so it captured them from
     the render in which it was created and never saw another value: the engine
     spent every session correlating against a frozen null face and a head pose
     of {pitch:0, yaw:0}. A constant series has zero variance, so Pearson
     returns 0 and every head- and face-based reflex reads as "none".

     Refs, updated by their own effects, are what a 60 Hz loop can safely read.
     The face mesh is additionally computed on one camera frame in five, so a
     frame carries it only when it is genuinely a new observation — repeating
     the same landmarks four times told the engine the eyes were motionless. */
  const multiHandDataRef  = useRef(null);
  const faceLandmarksRef  = useRef(null);
  const headPoseRef       = useRef({ pitch: 0, yaw: 0 });
  const lastPushedFaceRef = useRef(null);
  const pushFrameRef      = useRef(pushFrame);
  useEffect(() => { multiHandDataRef.current = multiHandData; }, [multiHandData]);
  useEffect(() => { faceLandmarksRef.current = faceLandmarks; }, [faceLandmarks]);
  useEffect(() => { headPoseRef.current = headPose || { pitch: 0, yaw: 0 }; }, [headPose]);
  useEffect(() => { pushFrameRef.current = pushFrame; }, [pushFrame]);

  // ── Game state ───────────────────────────────────────────────────
  const [phase, setPhase]                     = useState('countdown'); // countdown | waiting | tracing | celebration | complete
  const [countdownVal, setCountdownVal]       = useState(COUNTDOWN_SECS);
  const [pathQueue, setPathQueue]             = useState([]);
  const [currentPathIdx, setCurrentPathIdx]   = useState(0);
  const [pathPoints, setPathPoints]           = useState([]);
  const [traceProgress, setTraceProgress]     = useState(0); // 0-1
  const [trailPoints, setTrailPoints]         = useState([]);
  const [fingerPos, setFingerPos]             = useState(null); // { x, y } in canvas coords
  const [onPath, setOnPath]                   = useState(false);
  const [sessionTime, setSessionTime]         = useState(0);
  const [pathsCompleted, setPathsCompleted]   = useState(0);
  const [encouragement, setEncouragement]     = useState('');
  /* Shared app-wide sound state — the icon always matches what you hear. */
  const [soundEnabled, setSoundEnabled] = useSoundEnabled();
  const [processing, setProcessing]           = useState(false);
  const [showSuperAnim, setShowSuperAnim]     = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen]   = useState(false);

  // ── Metrics ──────────────────────────────────────────────────────
  const [metrics, setMetrics] = useState({
    accuracy: 0,
    smoothness: 0,
    avgDistance: 0,
    timeOnPath: 0,
    timeOffPath: 0,
    currentScore: 0,
  });

  // ── Refs (for RAF / avoiding stale closures) ─────────────────────
  const phaseRef          = useRef('countdown');
  const pathPointsRef     = useRef([]);
  const traceProgressRef  = useRef(0);
  const highestProgressRef= useRef(0);
  const trailRef          = useRef([]);
  const metricsRef        = useRef({ onPathFrames: 0, offPathFrames: 0, totalDistance: 0, frameCount: 0 });
  const timerRef          = useRef(null);
  const rafRef            = useRef(null);
  const latestLandmarks   = useRef(null);
  const gameCanvasRef     = useRef(null);
  const canvasSizeRef     = useRef({ width: CANVAS_SIZE, height: CANVAS_SIZE, scale: 1 });
  const gestureLog        = useRef([]);
  const dwellStartRef     = useRef(null);
  const onStartPoint      = useRef(false);
  const ambientStarted    = useRef(false);
  const pathQueueRef      = useRef([]);

  // Mirror state to refs
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { pathPointsRef.current = pathPoints; }, [pathPoints]);
  useEffect(() => { latestLandmarks.current = landmarks; }, [landmarks]);
  useEffect(() => { pathQueueRef.current = pathQueue; }, [pathQueue]);
  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);

  const currentPath = useMemo(() => pathQueue[currentPathIdx] || null, [pathQueue, currentPathIdx]);

  // ── Initialize session ──────────────────────────────────────────
  useEffect(() => {
    initGame();
    return () => {
      clearInterval(timerRef.current);
      cancelAnimationFrame(rafRef.current);
      soundManager.stopAmbient();
      soundManager.dispose();
    };
  }, []);

  // Close mobile menu dropdown when shape changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [currentPathIdx]);

  const initGame = async () => {
    try {
      // Initialize sound
      soundManager.init();

      // Pick random paths
      const paths = getRandomPaths(difficulty, TARGET_PATHS);
      setPathQueue(paths);
      pathQueueRef.current = paths;

      // Start session
      const learnerId = profile?.learner_id || user?.id || '00000000-0000-0000-0000-000000000010';
      const res = await api.post('/sessions/start', { learner_id: learnerId, difficulty, game_type: 'pathtracer' });
      startSession(res.data.session_id, learnerId, difficulty);
      startTracking({ sessionId: res.data.session_id, learnerId });

      // Start countdown
      runCountdown();
    } catch (err) {
      console.error('Failed to init PathTracer session:', err);
      toast.error('Could not start session');
      navigate('/play');
    }
  };

  // ── Countdown ───────────────────────────────────────────────────
  /* The 3-2-1 countdown was removed (client feedback): the round now starts
     the instant the session is ready, instead of making the child wait
     through a ticking overlay. */
  const runCountdown = () => {
    // Load first path
    loadPath(0);
    setPhase('waiting');
    phaseRef.current = 'waiting';
    startTimer();
    // Start ambient sound
    if (!ambientStarted.current) {
      soundManager.startAmbient();
      ambientStarted.current = true;
    }
  };

  // ── Load a path ─────────────────────────────────────────────────
  const loadPath = useCallback((idx) => {
    const queue = pathQueueRef.current;
    if (idx >= queue.length) return;
    const path = queue[idx];
    try {
      const points = samplePathPoints(path.svgPath, SAMPLE_POINTS);
      setPathPoints(points);
      pathPointsRef.current = points;
    } catch (e) {
      console.error('Failed to sample path:', e);
      // Fallback: create dummy points along a circle
      const pts = [];
      for (let i = 0; i < SAMPLE_POINTS; i++) {
        const t = (i / SAMPLE_POINTS) * Math.PI * 2;
        pts.push({ x: 200 + Math.cos(t) * 100, y: 200 + Math.sin(t) * 100 });
      }
      setPathPoints(pts);
      pathPointsRef.current = pts;
    }
    setTraceProgress(0);
    traceProgressRef.current = 0;
    highestProgressRef.current = 0;
    setTrailPoints([]);
    trailRef.current = [];
    setOnPath(false);
    setFingerPos(null);
    dwellStartRef.current = null;
    onStartPoint.current = false;
    metricsRef.current = { onPathFrames: 0, offPathFrames: 0, totalDistance: 0, frameCount: 0 };
    setCurrentPathIdx(idx);
    soundManager.playStartChime();
  }, []);

  // ── Timer ───────────────────────────────────────────────────────
  const startTimer = () => {
    timerRef.current = setInterval(() => setSessionTime(t => t + 1), 1000);
  };

  // ── Main game loop (RAF) ────────────────────────────────────────
  const gameLoop = useCallback(() => {
    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);

      const lm = latestLandmarks.current;
      const pts = pathPointsRef.current;
      const currentPhase = phaseRef.current;

      if (!lm || !pts.length || (currentPhase !== 'waiting' && currentPhase !== 'tracing')) {
        return;
      }

      // Get index finger tip
      const tip = lm[LANDMARKS.INDEX_TIP];
      if (!tip) return;

      // Convert to canvas coordinates (mirrored)
      const canvas = gameCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const sx = (1 - tip.x) * window.innerWidth;
      const sy = tip.y * window.innerHeight;

      // Convert screen coords to canvas coords (0-400 range)
      const cx = ((sx - rect.left) / rect.width) * CANVAS_SIZE;
      const cy = ((sy - rect.top) / rect.height) * CANVAS_SIZE;

      setFingerPos({ x: cx, y: cy, screenX: sx, screenY: sy });

      // ── Capture raw hand tracking positions (up to 1000) ──
      if ((currentPhase === 'waiting' || currentPhase === 'tracing') && !trackingSaved.current && activeSessionRef.current?.id) {
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
            else console.log('✅ 1000 hand tracking positions saved (PathTracer).');
          });
        }
      }

      // Push frame to reflex engine — see the refs above for why none of this
      // reads React state directly any more.
      if (lm) {
        const face = faceLandmarksRef.current;
        const faceIsNew = face && face !== lastPushedFaceRef.current;
        if (faceIsNew) lastPushedFaceRef.current = face;
        pushFrameRef.current({
          leftHand:  multiHandDataRef.current?.left  || null,
          rightHand: multiHandDataRef.current?.right || lm,
          faceMesh:  faceIsNew ? face : null,
          headPitch: headPoseRef.current?.pitch ?? 0,
          headYaw:   headPoseRef.current?.yaw   ?? 0,
        });
      }

      // === WAITING PHASE: Check if finger is on start point ===
      if (currentPhase === 'waiting') {
        const startPt = pts[0];
        const distToStart = Math.sqrt((cx - startPt.x) ** 2 + (cy - startPt.y) ** 2);

        if (distToStart < config.tolerance * 1.5) {
          if (!onStartPoint.current) {
            onStartPoint.current = true;
            dwellStartRef.current = performance.now();
          }
          const elapsed = performance.now() - dwellStartRef.current;
          if (elapsed >= DWELL_START_MS) {
            // Start tracing!
            setPhase('tracing');
            phaseRef.current = 'tracing';
            soundManager.playProgress();
          }
        } else {
          onStartPoint.current = false;
          dwellStartRef.current = null;
        }
        return;
      }

      // === TRACING PHASE: Track finger along path ===
      const { distance, closestIndex } = distToPath(cx, cy, pts);
      const isOnPath = distance <= config.tolerance;
      setOnPath(isOnPath);

      // Update metrics
      const m = metricsRef.current;
      m.frameCount++;
      m.totalDistance += distance;
      if (isOnPath) m.onPathFrames++;
      else m.offPathFrames++;

      // Progress: track the furthest point reached
      const normalizedProgress = closestIndex / (pts.length - 1);
      if (normalizedProgress > highestProgressRef.current && isOnPath) {
        highestProgressRef.current = normalizedProgress;
        traceProgressRef.current = normalizedProgress;
        setTraceProgress(normalizedProgress);

        // Add to trail
        trailRef.current.push({ x: cx, y: cy, onPath: isOnPath });
        setTrailPoints([...trailRef.current]);

        // Play progress sounds at checkpoints
        if (normalizedProgress > 0.25 && normalizedProgress < 0.27) soundManager.playProgress();
        if (normalizedProgress > 0.50 && normalizedProgress < 0.52) soundManager.playProgress();
        if (normalizedProgress > 0.75 && normalizedProgress < 0.77) soundManager.playProgress();
      } else {
        // Still add to trail even if off-path (for visual feedback)
        if (m.frameCount % 3 === 0) {
          trailRef.current.push({ x: cx, y: cy, onPath: isOnPath });
          if (trailRef.current.length > 500) trailRef.current = trailRef.current.slice(-400);
          setTrailPoints([...trailRef.current]);
        }
      }

      // Update displayed metrics
      if (m.frameCount % 10 === 0) {
        const accuracy = m.frameCount > 0 ? m.onPathFrames / m.frameCount : 0;
        const avgDist = m.frameCount > 0 ? m.totalDistance / m.frameCount : 0;
        const smoothness = calculateSmoothness(positionBuffer?.current?.slice(-20) || []);
        setMetrics({
          accuracy,
          smoothness,
          avgDistance: avgDist,
          timeOnPath: m.onPathFrames,
          timeOffPath: m.offPathFrames,
          currentScore: Math.round(accuracy * 100),
        });
      }

      // === Check if path is complete ===
      if (highestProgressRef.current >= 0.95) {
        handlePathComplete();
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [config.tolerance]);

  // Start game loop
  useEffect(() => {
    gameLoop();
    return () => cancelAnimationFrame(rafRef.current);
  }, [gameLoop]);

  // ── Path complete ───────────────────────────────────────────────
  const handlePathComplete = useCallback(() => {
    if (phaseRef.current !== 'tracing') return;
    setPhase('celebration');
    phaseRef.current = 'celebration';
    soundManager.playComplete();

    // Record gesture metrics
    const m = metricsRef.current;
    const accuracy = m.frameCount > 0 ? m.onPathFrames / m.frameCount : 0;
    const smoothness = calculateSmoothness(positionBuffer?.current?.slice(-30) || []);
    const gesture = {
      target_letter: currentPath?.name || 'path',
      classification: accuracy > 0.6 ? 'Perfect' : 'Failed',
      response_time_ms: sessionTime * 1000,
      trajectory_smoothness: smoothness,
      midline_crossing: false,
      head_hand_coupling: 0,
      fatigue_indicator: Math.min(1, (1 - smoothness) * 0.5),
    };
    recordGesture(gesture);
    gestureLog.current.push(gesture);

    // Celebration
    const text = ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)];
    setEncouragement(text);
    setShowSuperAnim(true);

    setTimeout(() => {
      setShowSuperAnim(false);
      const newCompleted = pathsCompleted + 1;
      setPathsCompleted(newCompleted);

      if (newCompleted >= TARGET_PATHS) {
        handleEndSession();
      } else {
        // Load next path
        loadPath(currentPathIdx + 1);
        setPhase('waiting');
        phaseRef.current = 'waiting';
      }
    }, CELEBRATION_MS);
  }, [currentPath, currentPathIdx, pathsCompleted, sessionTime, loadPath, recordGesture]);

  // ── End session ─────────────────────────────────────────────────
  const handleEndSession = async () => {
    if (processing) return;
    setProcessing(true);
    setPhase('complete');
    phaseRef.current = 'complete';
    clearInterval(timerRef.current);
    cancelAnimationFrame(rafRef.current);
    soundManager.playCelebration();
    soundManager.stopAmbient();
    setCameraEnabled(false);

    // Stop camera
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(t => t.stop());
    }

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
        else console.log(`✅ ${capturedPositions.current.length} hand tracking positions saved at end (PathTracer).`);
      });
    }

    // Stop reflex engine
    const reflexOutput = stopTracking();
    reflexEngineOutputRef.current = reflexOutput;

    try {
      const analysis = await endSession(reflexOutput);
      if (analysis) {
        navigate(`/play/results/${analysis.session_id || 'pathtracer'}`, {
          /* `gameId` tells the shared report which activity it is describing,
             so the reflex section lists Path Tracing's targets rather than
             LetterQuest's. Without it the route defaults to LetterQuest. */
          state: { analysis, reflexEngineOutput: reflexOutput, gameId: 'path-tracing' },
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

  // ── Sound toggle ────────────────────────────────────────────────
  const toggleSound = () => {
    soundManager.toggle();
    setSoundEnabled(soundManager.isEnabled());
    soundManager.playClick();
  };

  // ── Logout ──────────────────────────────────────────────────────
  const handleLogout = () => {
    clearInterval(timerRef.current);
    cancelAnimationFrame(rafRef.current);
    soundManager.stopAmbient();
    setCameraEnabled(false);
    if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(t => t.stop());
    logout();
    toast.success('See you next time! 👋');
    navigate('/login');
  };

  // ── Canvas rendering ────────────────────────────────────────────
  useEffect(() => {
    const canvas = gameCanvasRef.current;
    if (!canvas || !currentPath) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Scale factor
    const sx = w / CANVAS_SIZE;
    const sy = h / CANVAS_SIZE;
    ctx.save();
    ctx.scale(sx, sy);

    // ── Draw base path (dashed, semi-transparent) ──
    const path2d = new Path2D(currentPath.svgPath);
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.2)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(path2d);
    ctx.setLineDash([]);

    // ── Draw progress trail (colored) ──
    if (trailPoints.length > 1) {
      ctx.beginPath();
      ctx.moveTo(trailPoints[0].x, trailPoints[0].y);
      for (let i = 1; i < trailPoints.length; i++) {
        const pt = trailPoints[i];
        ctx.lineTo(pt.x, pt.y);
      }
      const grad = ctx.createLinearGradient(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      grad.addColorStop(0, '#8B5CF6');
      grad.addColorStop(0.5, '#A78BFA');
      grad.addColorStop(1, '#C4B5FD');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // ── Draw guide point (glowing dot on path) ──
    if (pathPoints.length > 0 && (phase === 'waiting' || phase === 'tracing')) {
      const guideIdx = phase === 'waiting'
        ? 0
        : Math.min(Math.floor(highestProgressRef.current * pathPoints.length) + 10, pathPoints.length - 1);
      const guidePt = pathPoints[guideIdx];
      if (guidePt) {
        // Glow
        const glowGrad = ctx.createRadialGradient(guidePt.x, guidePt.y, 0, guidePt.x, guidePt.y, 20);
        glowGrad.addColorStop(0, phase === 'waiting' ? 'rgba(34, 197, 94, 0.5)' : 'rgba(139, 92, 246, 0.4)');
        glowGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(guidePt.x, guidePt.y, 20, 0, Math.PI * 2);
        ctx.fill();

        // Dot
        ctx.fillStyle = phase === 'waiting' ? '#22C55E' : '#A78BFA';
        ctx.beginPath();
        ctx.arc(guidePt.x, guidePt.y, 6, 0, Math.PI * 2);
        ctx.fill();

        // Label for start
        if (phase === 'waiting') {
          ctx.fillStyle = '#22C55E';
          ctx.font = 'bold 12px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('START', guidePt.x, guidePt.y - 16);
        }
      }
    }

    // ── Draw finger position indicator (on canvas) ──
    if (fingerPos && (phase === 'tracing' || phase === 'waiting')) {
      const fpx = fingerPos.x;
      const fpy = fingerPos.y;
      // Only draw if within canvas bounds
      if (fpx >= 0 && fpx <= CANVAS_SIZE && fpy >= 0 && fpy <= CANVAS_SIZE) {
        // Outer ring
        ctx.strokeStyle = onPath ? 'rgba(34, 197, 94, 0.6)' : 'rgba(239, 68, 68, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(fpx, fpy, config.tolerance, 0, Math.PI * 2);
        ctx.stroke();

        // Center dot
        ctx.fillStyle = onPath ? '#22C55E' : '#EF4444';
        ctx.beginPath();
        ctx.arc(fpx, fpy, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ── Draw end point ──
    if (pathPoints.length > 0) {
      const endPt = pathPoints[pathPoints.length - 1];
      ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
      ctx.beginPath();
      ctx.arc(endPt.x, endPt.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#EF4444';
      ctx.beginPath();
      ctx.arc(endPt.x, endPt.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#EF4444';
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('END', endPt.x, endPt.y - 12);
    }

    ctx.restore();
  }, [currentPath, trailPoints, fingerPos, onPath, pathPoints, phase, config.tolerance]);

  // ── Accuracy ring for score card ──────────────────────────────
  const accuracyPct = Math.round(metrics.accuracy * 100);
  const ringCirc = 2 * Math.PI * 38;
  const ringOff  = ringCirc * (1 - metrics.accuracy);

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="ptg-root">
      {/* ── Paw cursor ─────────────────────────────────────────── */}
      {isTracking && fingerPos && (
        <div
          className={`ptg-paw-cursor ${onPath ? 'on-path' : 'off-path'}`}
          style={{ left: fingerPos.screenX, top: fingerPos.screenY }}
        >
          🐾
        </div>
      )}

      {/* ── Celebration overlay ─────────────────────────────────── */}
      <AnimatePresence>
        {showSuperAnim && (
          <motion.div
            className="ptg-celebration"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div
              className="ptg-celebration-content"
              initial={{ scale: 0, rotate: -30 }}
              animate={{ scale: [0, 1.2, 1], rotate: 0 }}
              transition={{ type: 'spring', damping: 10, stiffness: 100 }}
            >
              <div className="ptg-celebration-emoji">✨ 🎉 ⭐</div>
              <div className="ptg-celebration-text">{encouragement}</div>
            </motion.div>
            {Array.from({ length: 16 }).map((_, i) => (
              <motion.div key={i}
                initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
                animate={{
                  x: (Math.random() - 0.5) * 800,
                  y: (Math.random() - 0.5) * 600,
                  scale: Math.random() * 2 + 0.5,
                  opacity: 0,
                  rotate: Math.random() * 360,
                }}
                transition={{ duration: 2.5, ease: 'easeOut' }}
                style={{ position: 'absolute', fontSize: '2rem', zIndex: 999 }}
              >
                {['🌟', '🐾', '🎊', '✨', '🏆'][i % 5]}
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── LEFT PANEL — Camera ─────────────────────────────────── */}
      <div className="ptg-left">
        <div className="ptg-camera-box">
          {cameraError ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              height: '100%', color: '#94A3B8', textAlign: 'center', padding: 16,
            }}>
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>📷</div>
              <div style={{ fontWeight: 600, marginBottom: 4, fontSize: '0.85rem' }}>Camera unavailable</div>
              <div style={{ fontSize: '0.75rem', color: '#64748B' }}>Allow camera access for hand tracking.</div>
            </div>
          ) : (
            <>
              <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
              <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', pointerEvents: 'none' }} />
              <canvas ref={faceCanvasRef} width={640} height={360} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', pointerEvents: 'none', opacity: 0.5 }} />
              <div className="ptg-camera-label">🤚 Hand Tracking</div>
              <div className={`ptg-tracking-dot ${isTracking ? '' : 'inactive'}`} />
            </>
          )}
        </div>

        {/* Metrics cards in left panel */}
        <div className="ptg-metric">
          <div className="ptg-metric-header">
            <span className="ptg-metric-label">Smoothness</span>
            <span className="ptg-metric-value">{Math.round(metrics.smoothness * 100)}%</span>
          </div>
          <div className="ptg-metric-bar">
            <div className="ptg-metric-bar-fill" style={{
              width: `${metrics.smoothness * 100}%`,
              background: 'linear-gradient(90deg, #8B5CF6, #A78BFA)',
            }} />
          </div>
        </div>

        <div className="ptg-metric">
          <div className="ptg-metric-header">
            <span className="ptg-metric-label">Avg Distance</span>
            <span className="ptg-metric-value">{Math.round(metrics.avgDistance)}px</span>
          </div>
          <div className="ptg-metric-bar">
            <div className="ptg-metric-bar-fill" style={{
              width: `${Math.max(0, 100 - metrics.avgDistance * 2)}%`,
              background: metrics.avgDistance < config.tolerance
                ? 'linear-gradient(90deg, #22C55E, #86EFAC)'
                : 'linear-gradient(90deg, #EF4444, #FCA5A5)',
            }} />
          </div>
        </div>

        <div className="ptg-metric">
          <div className="ptg-metric-header">
            <span className="ptg-metric-label">Fatigue</span>
            <span className="ptg-metric-value">
              {Math.round((1 - metrics.smoothness) * 50 + (metrics.avgDistance > config.tolerance ? 20 : 0))}%
            </span>
          </div>
          <div className="ptg-metric-bar">
            <div className="ptg-metric-bar-fill" style={{
              width: `${(1 - metrics.smoothness) * 50 + (metrics.avgDistance > config.tolerance ? 20 : 0)}%`,
              background: 'linear-gradient(90deg, #F59E0B, #FBBF24)',
            }} />
          </div>
        </div>
      </div>

      {/* ── CENTER PANEL — Game Area ────────────────────────────── */}
      <div className="ptg-center">
        {/* Top bar */}
        <div className="ptg-topbar">
          <div className="ptg-topbar-left">
            <button className="ptg-back-btn" onClick={() => {
              setCameraEnabled(false);
              if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(t => t.stop());
              navigate('/play');
            }}>
              <ArrowLeft size={14} />
              Back
            </button>
            <div className="ptg-game-title ptg-desktop-only">Path<span>Tracer</span></div>
            <div className="ptg-diff-badge ptg-desktop-only" style={{
              background: `${config.color}18`,
              color: config.color,
              border: `1px solid ${config.color}33`,
            }}>
              {config.emoji} {config.label}
            </div>
          </div>
          <div className="ptg-topbar-right">
            <div className="ptg-timer">
              <Clock size={14} color="#94A3B8" />
              <span className="ptg-timer-value">{formatTime(sessionTime)}</span>
            </div>
            <button
              className={`ptg-sound-btn ptg-desktop-only ${!soundEnabled ? 'muted' : ''}`}
              onClick={toggleSound}
              title={soundEnabled ? 'Mute sounds' : 'Enable sounds'}
            >
              {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
            <button className="ptg-back-btn ptg-desktop-only" onClick={handleLogout}>
              <LogOut size={14} />
            </button>
            <button 
              className="ptg-menu-toggle-btn ptg-mobile-only" 
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              title="Menu"
            >
              {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {/* Mobile menu dropdown overlay */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div 
              className="ptg-mobile-dropdown ptg-mobile-only"
              initial={{ opacity: 0, y: -15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
            >
              <div className="ptg-dropdown-row">
                <div className="ptg-game-title">Path<span>Tracer</span></div>
                <div className="ptg-diff-badge" style={{
                  background: `${config.color}18`,
                  color: config.color,
                  border: `1px solid ${config.color}33`,
                }}>
                  {config.emoji} {config.label}
                </div>
              </div>
              
              {currentPath && (
                <div className="ptg-dropdown-path-info">
                  <span className="ptg-dropdown-path-emoji">{currentPath.icon}</span>
                  <span className="ptg-dropdown-path-name">{currentPath.name}</span>
                  <span className="ptg-dropdown-path-counter">{pathsCompleted + 1} / {TARGET_PATHS}</span>
                </div>
              )}
              
              <div className="ptg-dropdown-controls">
                <button
                  className={`ptg-sound-btn ${!soundEnabled ? 'muted' : ''}`}
                  onClick={toggleSound}
                  style={{ flex: 1, height: 42, gap: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                  <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Son {soundEnabled ? 'Activé' : 'Coupé'}</span>
                </button>
                
                <button 
                  className="ptg-back-btn" 
                  onClick={handleLogout} 
                  style={{ flex: 1, height: 42, gap: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: 0 }}
                >
                  <LogOut size={14} />
                  <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Quitter</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Path info bar (Desktop only) */}
        {currentPath && (
          <motion.div
            className="ptg-path-info ptg-desktop-only"
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
            key={currentPathIdx}
          >
            <div className="ptg-path-emoji">{currentPath.icon}</div>
            <div className="ptg-path-name">{currentPath.name}</div>
            <div className="ptg-path-counter">
              {pathsCompleted + 1} / {TARGET_PATHS}
            </div>
          </motion.div>
        )}

        {/* Game canvas */}
        <div className="ptg-game-canvas-wrap">
          <canvas
            ref={gameCanvasRef}
            className="ptg-game-canvas"
            width={CANVAS_SIZE * 2}
            height={CANVAS_SIZE * 2}
            style={{ width: '100%', height: '100%' }}
          />

          {/* Waiting phase hint */}
          {phase === 'waiting' && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              style={{
                position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.3)',
                borderRadius: 12, padding: '8px 16px', color: '#86EFAC',
                fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap',
              }}
            >
              👆 Place your finger on the green START point
            </motion.div>
          )}
        </div>

        {/* Progress bar */}
        <div className="ptg-progress-bar" style={{ maxWidth: 500, marginTop: 16 }}>
          <motion.div
            className="ptg-progress-fill"
            animate={{ width: `${traceProgress * 100}%` }}
            transition={{ duration: 0.2 }}
          />
        </div>
      </div>

      {/* ── RIGHT PANEL — Score & Guide ─────────────────────────── */}
      <div className="ptg-right">
        {/* Accuracy ring */}
        <div className="ptg-score-card">
          <div className="ptg-score-label">Precision</div>
          <div style={{ position: 'relative', width: 88, height: 88, margin: '8px auto' }}>
            <svg width="88" height="88" viewBox="0 0 88 88">
              <circle cx="44" cy="44" r="38" fill="none" stroke="rgba(139,92,246,0.1)" strokeWidth="5" />
              <circle cx="44" cy="44" r="38" fill="none" stroke="#8B5CF6" strokeWidth="5"
                strokeDasharray={ringCirc} strokeDashoffset={ringOff}
                strokeLinecap="round" transform="rotate(-90 44 44)"
                style={{ transition: 'stroke-dashoffset 0.5s ease' }}
              />
            </svg>
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: '1.4rem', color: '#C4B5FD',
            }}>
              {accuracyPct}%
            </div>
          </div>
        </div>

        {/* Paths completed */}
        <div className="ptg-score-card">
          <div className="ptg-score-label">Paths Done</div>
          <div className="ptg-score-value">
            {pathsCompleted} <span className="ptg-score-unit">/ {TARGET_PATHS}</span>
          </div>
        </div>

        {/* Session time */}
        <div className="ptg-metric">
          <div className="ptg-metric-header">
            <span className="ptg-metric-label">Session Time</span>
            <span className="ptg-metric-value">{formatTime(sessionTime)}</span>
          </div>
        </div>

        {/* On/Off path ratio */}
        <div className="ptg-metric">
          <div className="ptg-metric-header">
            <span className="ptg-metric-label">Time On Path</span>
            <span className="ptg-metric-value" style={{ color: '#22C55E' }}>
              {metrics.timeOnPath + metrics.timeOffPath > 0
                ? Math.round((metrics.timeOnPath / (metrics.timeOnPath + metrics.timeOffPath)) * 100)
                : 0}%
            </span>
          </div>
          <div className="ptg-metric-bar">
            <div className="ptg-metric-bar-fill" style={{
              width: `${metrics.timeOnPath + metrics.timeOffPath > 0
                ? (metrics.timeOnPath / (metrics.timeOnPath + metrics.timeOffPath)) * 100 : 0}%`,
              background: 'linear-gradient(90deg, #22C55E, #86EFAC)',
            }} />
          </div>
        </div>

        {/* Guide */}
        <div style={{
          background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.12)',
          borderRadius: 12, padding: 12, marginTop: 'auto',
        }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#A78BFA', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            How to play
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94A3B8', lineHeight: 1.6 }}>
            <div style={{ marginBottom: 4 }}>1. 👆 Move your index finger to the <strong style={{ color: '#22C55E' }}>green start</strong> point</div>
            <div style={{ marginBottom: 4 }}>2. 🐾 Follow the path with your finger</div>
            <div style={{ marginBottom: 4 }}>3. ✅ Stay <strong style={{ color: '#22C55E' }}>on the path</strong> for best score</div>
            <div>4. 🏁 Reach the <strong style={{ color: '#EF4444' }}>red end</strong> point to complete</div>
          </div>
        </div>
      </div>
    </div>
  );
}
