/**
 * BubbleGame.jsx
 * "Pop the Bubble" — occupational-therapy targeted-pointing game.
 *
 * Bubbles rise from the seabed; the child pops them by pointing at their centre
 * with the index fingertip (MediaPipe) or a finger/mouse (touch). Aiming closer
 * to the centre scores more, so the exercise rewards precision rather than
 * sweeping the hand across the screen.
 *
 * Why Fitts's law: reaching for a target of width W at distance D is the exact
 * task Fitts's law models, so instead of inventing a score we compute the real
 * index of difficulty ID = log2(2D/W) and the child's throughput ID/MT in
 * bits/second. That is a comparable, clinically meaningful measure of motor
 * control rather than an arbitrary number, and it lets a therapist track the
 * same child across sessions and levels on one scale.
 *
 * Performance contract: a fixed pool of DOM nodes is created once and reused —
 * bubbles are shown/hidden and moved with direct style writes inside a single
 * rAF loop. React state is touched only for phase changes and a throttled 5 Hz
 * readout, so there is no per-frame re-render even with 9 bubbles + particles.
 *
 * Pointer rendering follows TraceTypeGame/LadybugGame: index tip is landmark 8,
 * x mirrored, EMA-smoothed, drawn with a glow + fading trail.
 *
 * Route: /play/bubble-game?level=easy|medium|hard&mode=camera|touch
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home, Pause, Play, RotateCcw, Clock, Star, Hand, MousePointer2,
  Volume2, VolumeX, Target, Activity, Zap, TrendingUp, CheckCircle,
  Crosshair, GitBranch, AlertTriangle, XCircle,
} from 'lucide-react';
import useHandTracking from '../hooks/useHandTracking';
import { soundManager } from '../utils/soundManager';
import { useAuthStore, useSessionStore } from '../store';
import api from '../services/api';
import '../styles/BubbleGame.css';

/* ═══════════════════════════════════════════════════════════════════════════
   GEOMETRY — fixed virtual space, scaled to the rendered field, so difficulty
   tuning behaves identically on every screen size.
   ═══════════════════════════════════════════════════════════════════════════ */
const VW = 1000;
const VH = 560;
const SPAWN_Y   = VH + 90;   // below the seabed, bubbles drift up into view
const ESCAPE_Y  = -90;       // above the surface, bubble is lost
const SAND_TOP  = 452;       // bubbles spawn across the sandy floor

/* ── Difficulty tuning ──────────────────────────────────────────────────── */
const LEVELS = {
  easy: {
    key: 'easy', label: 'Easy', emoji: '🌱', color: '#38A169',
    rMin: 62, rMax: 85, riseSpeed: 45, spawnMs: 1400, maxBubbles: 5,
    dwellMs: 150, durationSec: 60,
  },
  medium: {
    key: 'medium', label: 'Medium', emoji: '⚡', color: '#DD6B20',
    rMin: 45, rMax: 65, riseSpeed: 70, spawnMs: 1000, maxBubbles: 7,
    dwellMs: 100, durationSec: 60,
  },
  hard: {
    key: 'hard', label: 'Hard', emoji: '🔥', color: '#E53E3E',
    rMin: 32, rMax: 48, riseSpeed: 100, spawnMs: 700, maxBubbles: 9,
    dwellMs: 70, durationSec: 60,
  },
};

/* ── Constants ──────────────────────────────────────────────────────────── */
const EMA_ALPHA        = 0.35;
const TRAIL_LENGTH     = 8;
const BASE_POINTS      = 10;
const MIN_PRECISION    = 0.30;  // an edge hit still scores 30%
/* Both modes pop after a dwell, not on the instant the pointer crosses the rim.
   Popping on entry would make every hit an edge hit — precision would read 30%
   for everyone and "aim for the centre" would score nothing. Holding briefly
   lets the finger settle, and we score the CLOSEST approach seen during the
   hold, so driving to the middle is what actually earns points. Touch mode uses
   a dwell short enough to still feel instant. */
const TOUCH_DWELL_MS   = 60;
const SWAY_AMP         = 26;    // horizontal float amplitude (px)
const SWAY_SPEED       = 0.0016;
const MOVE_START_SPEED = 60;    // px/s that counts as "the reach has begun"
const CORRECTION_ANGLE = Math.PI / 2;  // >90° heading change = a correction
const PARTICLES        = 8;
const POP_MS           = 400;
const REF_THROUGHPUT   = 3.5;   // bits/s — typical adult pointing performance
const SWEEP_EFFICIENCY = 35;    // below this %, movement reads as sweeping
const COUNTDOWN_SECONDS = 3;
const RULES_FLAG       = 'bubble_rules_seen';

const BUBBLE_TINTS = [
  { name: 'blue',   c1: '#BFEAFF', c2: '#5FB8F0', c3: '#2E86C8' },
  { name: 'pink',   c1: '#FFD6EF', c2: '#F58FD0', c3: '#D4569F' },
  { name: 'violet', c1: '#E0D6FF', c2: '#A98FF0', c3: '#7A5FD0' },
  { name: 'yellow', c1: '#FFF3C4', c2: '#FBD960', c3: '#DDAF20' },
  { name: 'teal',   c1: '#C9F7EE', c2: '#66D9C2', c3: '#2FA98F' },
  { name: 'green',  c1: '#D6F5C9', c2: '#8FD96B', c3: '#54A832' },
];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const fmtTime = (s) => {
  const m = Math.floor(Math.max(0, s) / 60);
  const r = Math.floor(Math.max(0, s) % 60);
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
};

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */
export default function BubbleGame() {
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

  const [gamePhase, setGamePhase] = useState(() =>
    sessionStorage.getItem(RULES_FLAG) ? 'countdown' : 'rules'
  );
  const [isPaused, setIsPaused] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);

  /* ── Throttled UI readouts ── */
  const [uiScore, setUiScore] = useState(0);
  const [uiPopped, setUiPopped] = useState(0);
  const [uiRemaining, setUiRemaining] = useState(cfg.durationSec);
  const [results, setResults] = useState(null);

  /* ── DOM refs ── */
  const videoRef        = useRef(null);
  const trackCanvasRef  = useRef(null);
  const fieldRef        = useRef(null);
  const poolRef         = useRef(null);   // container holding the bubble nodes
  const pointerCanvasRef = useRef(null);
  const fxCanvasRef     = useRef(null);   // pop particles + shockwaves

  /* ── Per-frame state ── */
  const rafRef      = useRef(null);
  const lastTsRef   = useRef(0);
  const elapsedRef  = useRef(0);
  const pointerRef  = useRef(null);
  const trailRef    = useRef([]);
  const touchActiveRef = useRef(false);
  const nodesRef    = useRef([]);   // [{ root, circle, ring, ringLen }]
  const bubblesRef  = useRef([]);   // active bubble models, index-aligned to nodes
  const freeRef     = useRef([]);   // free node indices
  const spawnAccRef = useRef(0);
  const fxRef       = useRef([]);   // active pop effects
  const seqRef      = useRef(0);

  /* ── Dwell state ── */
  const dwellIdxRef     = useRef(-1);
  const dwellStartRef   = useRef(0);
  const dwellMinDistRef = useRef(Infinity);   // closest approach to the centre

  /* ── Metric accumulators ── */
  const scoreRef       = useRef(0);
  const poppedRef      = useRef(0);
  const spawnedRef     = useRef(0);
  const missedRef      = useRef(0);
  const precisionsRef  = useRef([]);   // 0..1 per pop
  const reactionsRef   = useRef([]);   // ms
  const mtsRef         = useRef([]);   // ms
  const idsRef         = useRef([]);   // bits
  const tpsRef         = useRef([]);   // bits/s
  const straightRef    = useRef(0);    // Σ direct distance to each popped target
  const travelledRef   = useRef(0);    // Σ actual finger path length
  const correctionsRef = useRef(0);
  const jerkRef        = useRef([]);

  /* ── Reach tracking (one "reach" = pointer travel between two pops) ── */
  const reachStartPosRef  = useRef(null);
  const reachStartTsRef   = useRef(0);
  const reachMovedAtRef   = useRef(null);
  const reachPathRef      = useRef(0);
  const lastPtrRef        = useRef(null);
  const headingRef        = useRef(null);

  /* ── Session ── */
  const [sessionId, setSessionId] = useState(null);
  const sessionSavedRef = useRef(false);

  const isPlaying = gamePhase === 'playing' && !isPaused;
  const trackingEnabled = mode === 'camera' && (gamePhase === 'countdown' || gamePhase === 'playing');

  const { landmarks, isTracking, isSimulationMode } = useHandTracking(
    videoRef, trackCanvasRef, trackingEnabled, isPaused, 1
  );

  /* ═════════════════════════════════════════════════════════════════════════
     BUBBLE POOL — created once; nodes are reused for the whole session.
     ═════════════════════════════════════════════════════════════════════════ */
  const poolSpec = useMemo(
    () => Array.from({ length: cfg.maxBubbles }, (_, i) => i),
    [cfg.maxBubbles]
  );

  useEffect(() => {
    // Collect the node handles once the pool has rendered.
    const root = poolRef.current;
    if (!root) return;
    const nodes = [];
    for (let i = 0; i < cfg.maxBubbles; i++) {
      const el = root.querySelector(`[data-bub="${i}"]`);
      if (!el) continue;
      const ring = el.querySelector('.bg-dwell-arc');
      nodes.push({
        root: el,
        ring,
        ringLen: ring ? ring.getTotalLength?.() || 0 : 0,
      });
      el.style.display = 'none';
    }
    nodesRef.current = nodes;
    bubblesRef.current = new Array(cfg.maxBubbles).fill(null);
    freeRef.current = poolSpec.slice();
  }, [cfg.maxBubbles, poolSpec]);

  /* ═════════════════════════════════════════════════════════════════════════
     Coordinate + pointer helpers
     ═════════════════════════════════════════════════════════════════════════ */
  const clientToVirtual = useCallback((clientX, clientY) => {
    const el = fieldRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * VW,
      y: ((clientY - r.top) / r.height) * VH,
    };
  }, []);

  const pushPointer = useCallback((pt) => {
    if (!pt) return;
    const prev = pointerRef.current;
    pointerRef.current = prev
      ? { x: prev.x + (pt.x - prev.x) * EMA_ALPHA, y: prev.y + (pt.y - prev.y) * EMA_ALPHA }
      : { x: pt.x, y: pt.y };
  }, []);

  useEffect(() => {
    if (mode !== 'camera' || !isPlaying) return;
    if (!landmarks || landmarks.length < 9) return;
    const tip = landmarks[8];
    if (!tip) return;
    pushPointer({ x: (1 - tip.x) * VW, y: tip.y * VH });
  }, [landmarks, mode, isPlaying, pushPointer]);

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

  const handlePointerUp = useCallback((e) => {
    touchActiveRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }, []);

  /* ═════════════════════════════════════════════════════════════════════════
     SPAWN / DESPAWN
     ═════════════════════════════════════════════════════════════════════════ */
  const spawnBubble = useCallback((ts) => {
    const free = freeRef.current;
    if (!free.length) return;
    const idx = free.pop();
    const node = nodesRef.current[idx];
    if (!node) return;

    const r = cfg.rMin + Math.random() * (cfg.rMax - cfg.rMin);
    const x = r + 30 + Math.random() * (VW - 2 * r - 60);
    const tint = Math.floor(Math.random() * BUBBLE_TINTS.length);

    bubblesRef.current[idx] = {
      id: ++seqRef.current,
      x, baseX: x, y: SPAWN_Y, r,
      tint,
      phase: Math.random() * Math.PI * 2,
      bornAt: ts,
      visibleAt: null,   // set once it enters the field (for reaction time)
    };
    spawnedRef.current += 1;

    const el = node.root;
    el.style.display = '';
    el.dataset.tint = String(tint);
    el.style.width = `${(2 * r / VW) * 100}%`;
    el.style.height = `${(2 * r / VH) * 100}%`;
    if (node.ring) {
      node.ring.style.strokeDasharray = `${node.ringLen}`;
      node.ring.style.strokeDashoffset = `${node.ringLen}`;
    }
    el.classList.remove('bg-bubble-targeted');
  }, [cfg.rMin, cfg.rMax]);

  const despawn = useCallback((idx) => {
    const node = nodesRef.current[idx];
    if (node) {
      node.root.style.display = 'none';
      node.root.classList.remove('bg-bubble-targeted');
    }
    bubblesRef.current[idx] = null;
    if (!freeRef.current.includes(idx)) freeRef.current.push(idx);
    if (dwellIdxRef.current === idx) {
      dwellIdxRef.current = -1;
      dwellStartRef.current = 0;
      dwellMinDistRef.current = Infinity;
    }
  }, []);

  /* ═════════════════════════════════════════════════════════════════════════
     POP — records the Fitts sample for this reach, then despawns.
     ═════════════════════════════════════════════════════════════════════════ */
  const popBubble = useCallback((idx, ts, ptr) => {
    const b = bubblesRef.current[idx];
    if (!b) return;

    // Score the closest the finger got to the centre during the hold.
    const dNow = Math.hypot(ptr.x - b.x, ptr.y - b.y);
    const d = Math.min(dNow, dwellMinDistRef.current);
    const precision = Math.max(MIN_PRECISION, 1 - d / b.r);
    const gained = Math.round(BASE_POINTS * precision * 10) / 10;

    scoreRef.current += gained;
    poppedRef.current += 1;
    precisionsRef.current.push(precision);

    /* ── Fitts sample ────────────────────────────────────────────────────
       D is the straight-line distance from where this reach began to the
       target; W is the bubble diameter; MT is measured from the moment the
       finger actually started moving (not from the previous pop), so a child
       who pauses to think is not scored as slow. */
    const start = reachStartPosRef.current;
    if (start && reachMovedAtRef.current != null) {
      const D = Math.hypot(b.x - start.x, b.y - start.y);
      const W = 2 * b.r;
      const MT = ts - reachMovedAtRef.current;
      if (D > 25 && MT > 60) {
        const ID = Math.log2((2 * D) / W);
        if (ID > 0.15) {
          idsRef.current.push(ID);
          mtsRef.current.push(MT);
          tpsRef.current.push(ID / (MT / 1000));
          straightRef.current += D;
          travelledRef.current += Math.max(D, reachPathRef.current);
        }
      }
      reactionsRef.current.push(reachMovedAtRef.current - reachStartTsRef.current);
    }

    /* Start the next reach from here. */
    reachStartPosRef.current = { x: ptr.x, y: ptr.y };
    reachStartTsRef.current = ts;
    reachMovedAtRef.current = null;
    reachPathRef.current = 0;

    /* Pop effect */
    fxRef.current.push({
      x: b.x, y: b.y, r: b.r, tint: b.tint, t0: ts,
      gained, seed: Math.random() * Math.PI * 2,
    });

    despawn(idx);
    if (soundEnabled) {
      soundManager.playClick();
      if (poppedRef.current % 5 === 0) soundManager.playProgress();
    }
  }, [despawn, soundEnabled]);

  /* ═════════════════════════════════════════════════════════════════════════
     RESULTS
     ═════════════════════════════════════════════════════════════════════════ */
  const finishGame = useCallback(() => {
    cancelAnimationFrame(rafRef.current);

    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

    const accuracy = mean(precisionsRef.current) * 100;
    const throughput = mean(tpsRef.current);
    const tpScore = clamp01(throughput / REF_THROUGHPUT) * 100;
    const pathEff = travelledRef.current > 0
      ? clamp01(straightRef.current / travelledRef.current) * 100
      : 0;
    const meanJerk = mean(jerkRef.current);
    const smoothness = clamp01(1 - meanJerk / 2600) * 100;
    const attempted = Math.max(1, poppedRef.current + missedRef.current);
    const hitRate = (poppedRef.current / attempted) * 100;

    const composite = Math.round(
      accuracy * 0.30 + tpScore * 0.25 + pathEff * 0.20 + smoothness * 0.15 + hitRate * 0.10
    );

    setResults({
      score: Math.round(scoreRef.current),
      popped: poppedRef.current,
      spawned: spawnedRef.current,
      missed: missedRef.current,
      accuracy: Math.round(accuracy),
      reactionMs: reactionsRef.current.length ? Math.round(mean(reactionsRef.current)) : null,
      movementMs: mtsRef.current.length ? Math.round(mean(mtsRef.current)) : null,
      throughput: Math.round(throughput * 100) / 100,
      meanID: Math.round(mean(idsRef.current) * 100) / 100,
      pathEfficiency: Math.round(pathEff),
      corrections: correctionsRef.current,
      smoothness: Math.round(smoothness),
      hitRate: Math.round(hitRate),
      composite,
      sweeping: pathEff > 0 && pathEff < SWEEP_EFFICIENCY,
    });
    setGamePhase('results');
    if (soundEnabled) soundManager.playCelebration();
  }, [soundEnabled]);

  const finishRef = useRef(finishGame);
  useEffect(() => { finishRef.current = finishGame; }, [finishGame]);

  /* ═════════════════════════════════════════════════════════════════════════
     GAME LOOP
     ═════════════════════════════════════════════════════════════════════════ */
  useEffect(() => {
    if (gamePhase !== 'playing' || isPaused) return;
    let lastUi = 0;

    const step = (ts) => {
      rafRef.current = requestAnimationFrame(step);
      if (!lastTsRef.current) { lastTsRef.current = ts; return; }
      const dtMs = Math.min(64, ts - lastTsRef.current);
      lastTsRef.current = ts;
      const dt = dtMs / 1000;
      elapsedRef.current += dtMs;

      const ptr = pointerRef.current;

      /* ── Pointer kinematics: path length, reach onset, corrections, jerk ── */
      if (ptr) {
        if (lastPtrRef.current) {
          const dx = ptr.x - lastPtrRef.current.x;
          const dy = ptr.y - lastPtrRef.current.y;
          const dist = Math.hypot(dx, dy);
          const inst = dist / Math.max(0.001, dt);
          reachPathRef.current += dist;

          if (reachMovedAtRef.current == null && inst > MOVE_START_SPEED) {
            reachMovedAtRef.current = ts;
          }
          if (dist > 0.8) {
            const heading = Math.atan2(dy, dx);
            if (headingRef.current != null) {
              let diff = Math.abs(heading - headingRef.current);
              if (diff > Math.PI) diff = 2 * Math.PI - diff;
              if (diff > CORRECTION_ANGLE) correctionsRef.current += 1;
              jerkRef.current.push((diff / Math.max(0.001, dt)) * Math.min(inst, 900) / 90);
              if (jerkRef.current.length > 900) jerkRef.current.shift();
            }
            headingRef.current = heading;
          }
        } else {
          reachStartPosRef.current = { x: ptr.x, y: ptr.y };
          reachStartTsRef.current = ts;
        }
        lastPtrRef.current = { x: ptr.x, y: ptr.y };
      }

      /* ── Spawn ─────────────────────────────────────────────────────────── */
      spawnAccRef.current += dtMs;
      if (spawnAccRef.current >= cfg.spawnMs) {
        spawnAccRef.current -= cfg.spawnMs;
        spawnBubble(ts);
      }

      /* ── Advance bubbles, find the one under the pointer ────────────────── */
      const bubbles = bubblesRef.current;
      const nodes = nodesRef.current;
      let hoverIdx = -1;
      let hoverDist = Infinity;

      for (let i = 0; i < bubbles.length; i++) {
        const b = bubbles[i];
        if (!b) continue;

        b.y -= cfg.riseSpeed * dt;
        b.x = b.baseX + SWAY_AMP * Math.sin(b.phase + ts * SWAY_SPEED);

        if (b.visibleAt == null && b.y + b.r < VH) b.visibleAt = ts;

        if (b.y + b.r < ESCAPE_Y + b.r) {
          missedRef.current += 1;
          despawn(i);
          continue;
        }

        const node = nodes[i];
        if (node) {
          node.root.style.left = `${((b.x - b.r) / VW) * 100}%`;
          node.root.style.top = `${((b.y - b.r) / VH) * 100}%`;
        }

        if (ptr) {
          const d = Math.hypot(ptr.x - b.x, ptr.y - b.y);
          if (d <= b.r && d < hoverDist) { hoverDist = d; hoverIdx = i; }
        }
      }

      /* ── Dwell: the finger must rest on the target briefly before it pops.
            In camera mode this also stops a hand crossing the screen from
            popping everything it passes; in touch mode it is short enough to
            feel instant. Either way it gives us a window in which to record
            how close to the centre the child actually got. ────────────────── */
      const dwellMs = mode === 'camera' ? cfg.dwellMs : TOUCH_DWELL_MS;
      if (hoverIdx !== dwellIdxRef.current) {
        const prev = nodes[dwellIdxRef.current];
        if (prev) {
          prev.root.classList.remove('bg-bubble-targeted');
          if (prev.ring) prev.ring.style.strokeDashoffset = `${prev.ringLen}`;
        }
        dwellIdxRef.current = hoverIdx;
        dwellStartRef.current = ts;
        dwellMinDistRef.current = hoverIdx >= 0 ? hoverDist : Infinity;
        const cur = nodes[hoverIdx];
        if (cur) cur.root.classList.add('bg-bubble-targeted');
      } else if (hoverIdx >= 0 && ptr) {
        if (hoverDist < dwellMinDistRef.current) dwellMinDistRef.current = hoverDist;
        const held = ts - dwellStartRef.current;
        const node = nodes[hoverIdx];
        if (node?.ring && mode === 'camera') {
          const p = clamp01(held / dwellMs);
          node.ring.style.strokeDashoffset = `${node.ringLen * (1 - p)}`;
        }
        if (held >= dwellMs) popBubble(hoverIdx, ts, ptr);
      }

      /* ── Paint overlays ────────────────────────────────────────────────── */
      drawPointer(ptr, hoverIdx >= 0, ts);
      drawFx(ts);

      /* ── Throttled React sync ──────────────────────────────────────────── */
      if (ts - lastUi > 200) {
        lastUi = ts;
        setUiScore(Math.round(scoreRef.current));
        setUiPopped(poppedRef.current);
        setUiRemaining(cfg.durationSec - elapsedRef.current / 1000);
      }

      if (elapsedRef.current / 1000 >= cfg.durationSec) {
        cancelAnimationFrame(rafRef.current);
        finishRef.current();
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [gamePhase, isPaused, cfg, mode, spawnBubble, despawn, popBubble]);

  /* ═════════════════════════════════════════════════════════════════════════
     POINTER CANVAS
     ═════════════════════════════════════════════════════════════════════════ */
  const drawPointer = useCallback((ptr, onTarget, ts) => {
    const cv = pointerCanvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

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

    const trail = trailRef.current;
    trail.push({ x: sx, y: sy });
    if (trail.length > TRAIL_LENGTH) trail.shift();

    const base = onTarget ? '34, 211, 238' : '255, 255, 255';

    for (let i = 0; i < trail.length - 1; i++) {
      const p = trail[i];
      const f = (i + 1) / trail.length;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4 + 8 * f, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${base}, ${0.04 + 0.15 * f})`;
      ctx.fill();
    }

    const pulse = 1 + 0.12 * Math.sin(ts / 220);
    ctx.beginPath();
    ctx.arc(sx, sy, 28 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${base}, 0.12)`;
    ctx.fill();

    ctx.shadowBlur = 22;
    ctx.shadowColor = `rgba(${base}, 0.9)`;
    ctx.beginPath();
    ctx.arc(sx, sy, 17, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${base}, 0.2)`;
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = `rgba(${base}, 0.95)`;
    ctx.stroke();

    // Crosshair ticks make the aiming point unambiguous for a child.
    ctx.beginPath();
    ctx.moveTo(sx - 26, sy); ctx.lineTo(sx - 21, sy);
    ctx.moveTo(sx + 21, sy); ctx.lineTo(sx + 26, sy);
    ctx.moveTo(sx, sy - 26); ctx.lineTo(sx, sy - 21);
    ctx.moveTo(sx, sy + 21); ctx.lineTo(sx, sy + 26);
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
  }, []);

  /* ═════════════════════════════════════════════════════════════════════════
     POP EFFECTS CANVAS — particles, shockwave, floating score
     ═════════════════════════════════════════════════════════════════════════ */
  const drawFx = useCallback((ts) => {
    const cv = fxCanvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const rect = cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const kx = rect.width / VW;
    const ky = rect.height / VH;
    const fx = fxRef.current;

    for (let i = fx.length - 1; i >= 0; i--) {
      const e = fx[i];
      const u = (ts - e.t0) / POP_MS;
      if (u >= 1) { fx.splice(i, 1); continue; }

      const tint = BUBBLE_TINTS[e.tint];
      const cx = e.x * kx;
      const cy = e.y * ky;
      const rr = e.r * kx;

      // Shockwave
      ctx.beginPath();
      ctx.arc(cx, cy, rr * (0.7 + u * 1.5), 0, Math.PI * 2);
      ctx.lineWidth = 3 * (1 - u);
      ctx.strokeStyle = tint.c2 + Math.round((1 - u) * 200).toString(16).padStart(2, '0');
      ctx.stroke();

      // Particles
      for (let p = 0; p < PARTICLES; p++) {
        const a = e.seed + (p / PARTICLES) * Math.PI * 2;
        const dist = rr * (0.5 + u * 1.7);
        const px = cx + Math.cos(a) * dist;
        const py = cy + Math.sin(a) * dist;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(0.5, rr * 0.16 * (1 - u)), 0, Math.PI * 2);
        ctx.fillStyle = tint.c1;
        ctx.globalAlpha = 1 - u;
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Floating score
      ctx.font = `800 ${Math.max(13, rr * 0.42)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.globalAlpha = 1 - u;
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowBlur = 8;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.fillText(`+${e.gained}`, cx, cy - rr * 0.2 - u * 42);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }, []);

  /* ═════════════════════════════════════════════════════════════════════════
     COUNTDOWN + RESET
     ═════════════════════════════════════════════════════════════════════════ */
  const resetRun = useCallback(() => {
    lastTsRef.current = 0;
    elapsedRef.current = 0;
    scoreRef.current = 0;
    poppedRef.current = 0;
    spawnedRef.current = 0;
    missedRef.current = 0;
    precisionsRef.current = [];
    reactionsRef.current = [];
    mtsRef.current = [];
    idsRef.current = [];
    tpsRef.current = [];
    straightRef.current = 0;
    travelledRef.current = 0;
    correctionsRef.current = 0;
    jerkRef.current = [];
    reachStartPosRef.current = null;
    reachMovedAtRef.current = null;
    reachPathRef.current = 0;
    lastPtrRef.current = null;
    headingRef.current = null;
    trailRef.current = [];
    fxRef.current = [];
    spawnAccRef.current = 0;
    dwellIdxRef.current = -1;
    dwellMinDistRef.current = Infinity;
    for (let i = 0; i < bubblesRef.current.length; i++) despawn(i);
    freeRef.current = poolSpec.slice();
  }, [despawn, poolSpec]);

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
        resetRun();
        setUiScore(0); setUiPopped(0); setUiRemaining(cfg.durationSec);
        setGamePhase('playing');
      } else {
        setCountdown(n);
        if (soundEnabled) soundManager.playCountdown();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [gamePhase, soundEnabled, resetRun, cfg.durationSec]);

  /* ═════════════════════════════════════════════════════════════════════════
     SESSION API
     ═════════════════════════════════════════════════════════════════════════ */
  useEffect(() => {
    if (gamePhase !== 'playing' || sessionId) return;
    const learnerId = profile?.learner_id || user?.id || '00000000-0000-0000-0000-000000000010';
    api.post('/sessions/start', {
      learner_id: learnerId,
      difficulty: level,
      game_name: 'Pop the Bubble',
    }).then((res) => {
      const sid = res.data?.session_id;
      if (sid) { setSessionId(sid); storeStartSession(sid, learnerId, level); }
    }).catch((err) => console.warn('[BubbleGame] Could not start session:', err));
  }, [gamePhase, sessionId, level, profile, user, storeStartSession]);

  useEffect(() => {
    if (gamePhase !== 'results' || !results || !sessionId || sessionSavedRef.current) return;
    sessionSavedRef.current = true;
    api.post('/sessions/end', {
      session_id: sessionId,
      duration_seconds: cfg.durationSec,
      accuracy_score: parseFloat((results.accuracy / 100).toFixed(2)),
      accuracy: results.accuracy,
      perfect_grabs: results.popped,
      total_attempts: results.spawned,
      game_name: 'Pop the Bubble',
      notes: JSON.stringify({
        game: 'pop-the-bubble',
        level,
        mode,
        score: results.score,
        bubblesPopped: results.popped,
        bubblesSpawned: results.spawned,
        bubblesMissed: results.missed,
        touchAccuracy: results.accuracy,
        reactionTimeMs: results.reactionMs,
        movementTimeMs: results.movementMs,
        fittsThroughputBitsPerSec: results.throughput,
        fittsMeanIndexOfDifficulty: results.meanID,
        pathEfficiency: results.pathEfficiency,
        corrections: results.corrections,
        smoothness: results.smoothness,
        hitRate: results.hitRate,
        performanceScore: results.composite,
        sweepingPatternFlag: results.sweeping,
      }),
    }).then(() => {
      storeEndSession({
        duration: cfg.durationSec,
        accuracy: results.accuracy,
        perfectGrabs: results.popped,
      });
    }).catch((err) => console.error('[BubbleGame] Failed to save session:', err));
  }, [gamePhase, results, sessionId, level, mode, cfg.durationSec, storeEndSession]);

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
      if (!next) { lastTsRef.current = 0; lastPtrRef.current = null; }
      if (soundEnabled) soundManager.playClick();
      return next;
    });
  }, [gamePhase, soundEnabled]);

  const switchMode = useCallback(() => {
    setMode((m) => (m === 'camera' ? 'touch' : 'camera'));
    pointerRef.current = null;
    trailRef.current = [];
    lastPtrRef.current = null;
    dwellIdxRef.current = -1;
    dwellMinDistRef.current = Infinity;
    if (soundEnabled) soundManager.playClick();
  }, [soundEnabled]);

  const restart = useCallback(() => {
    sessionSavedRef.current = false;
    setSessionId(null);
    setResults(null);
    setIsPaused(false);
    setGamePhase('countdown');
  }, []);

  const goHome = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    navigate('/play');
  }, [navigate]);

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
  const timePct = clamp01(uiRemaining / cfg.durationSec) * 100;
  const timeState = uiRemaining <= 5 ? 'critical' : uiRemaining <= 15 ? 'warn' : '';

  return (
    <div className="bg-page">
      <header className="bg-header">
        <div className="bg-header-left">
          <button className="bg-icon-btn bg-home-btn" onClick={goHome} title="Home" aria-label="Home">
            <Home size={20} />
          </button>
          <span className={`bg-level-chip bg-level-${level}`}>{cfg.emoji} {cfg.label}</span>
        </div>

        <div className="bg-header-center">
          <div className="bg-stat bg-stat-score">
            <Star size={18} className="bg-stat-ico" />
            <span className="bg-stat-val">{uiScore}</span>
          </div>
          <div className="bg-stat">
            <Crosshair size={18} className="bg-stat-ico" />
            <span className="bg-stat-val">{uiPopped}</span>
          </div>
          <div className={`bg-stat bg-stat-time ${timeState}`}>
            <Clock size={18} className="bg-stat-ico" />
            <span className="bg-stat-val">{fmtTime(uiRemaining)}</span>
          </div>
        </div>

        <div className="bg-header-right">
          <button className="bg-icon-btn" onClick={switchMode}
            title={mode === 'camera' ? 'Switch to touch' : 'Switch to camera'}>
            {mode === 'camera' ? <Hand size={20} /> : <MousePointer2 size={20} />}
          </button>
          <button className="bg-icon-btn"
            onClick={() => setSoundEnabled((s) => { soundManager.toggle?.(); return !s; })}
            title="Sound">
            {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
          <button className="bg-icon-btn bg-pause-btn" onClick={togglePause}
            disabled={gamePhase !== 'playing'} title="Pause">
            {isPaused ? <Play size={20} /> : <Pause size={20} />}
          </button>
        </div>
      </header>

      <main className="bg-stage">
        <div
          className="bg-field"
          ref={fieldRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ touchAction: 'none' }}
        >
          {/* Bubble pool — rendered once, moved by the loop */}
          <div className="bg-pool" ref={poolRef} aria-hidden="true">
            {poolSpec.map((i) => (
              <div className="bg-bubble" data-bub={i} key={i}>
                <svg viewBox="0 0 100 100" width="100%" height="100%">
                  <defs>
                    <radialGradient id={`bgSkin${i}`} cx="34%" cy="30%" r="72%">
                      <stop offset="0%"  stopColor="var(--b1)" stopOpacity="0.95" />
                      <stop offset="55%" stopColor="var(--b2)" stopOpacity="0.55" />
                      <stop offset="100%" stopColor="var(--b3)" stopOpacity="0.75" />
                    </radialGradient>
                  </defs>
                  <circle cx="50" cy="50" r="46" fill={`url(#bgSkin${i})`} />
                  <circle cx="50" cy="50" r="46" fill="none"
                    stroke="var(--b1)" strokeWidth="2.4" opacity="0.9" />
                  <circle cx="50" cy="50" r="41" fill="none"
                    stroke="#FFFFFF" strokeWidth="1.1" opacity="0.35" />
                  {/* specular highlights */}
                  <ellipse cx="35" cy="30" rx="13" ry="9"
                    fill="#FFFFFF" opacity="0.75" transform="rotate(-32 35 30)" />
                  <circle cx="63" cy="27" r="4.2" fill="#FFFFFF" opacity="0.5" />
                  <path d="M22 60 A 30 30 0 0 0 42 79" fill="none"
                    stroke="#FFFFFF" strokeWidth="3" opacity="0.35" strokeLinecap="round" />
                  {/* dwell progress ring */}
                  <circle className="bg-dwell-arc" cx="50" cy="50" r="46"
                    fill="none" stroke="#22D3EE" strokeWidth="5"
                    strokeLinecap="round" transform="rotate(-90 50 50)" />
                </svg>
              </div>
            ))}
          </div>

          <canvas className="bg-fx-canvas" ref={fxCanvasRef} />
          <canvas className="bg-pointer-canvas" ref={pointerCanvasRef} />

          <div className="bg-cam-hidden">
            <video ref={videoRef} playsInline muted />
            <canvas ref={trackCanvasRef} />
          </div>

          {mode === 'camera' && gamePhase === 'playing' && (
            <div className={`bg-cam-status ${isTracking ? 'ok' : 'wait'}`}>
              {isSimulationMode ? 'Simulation mode'
                : isTracking ? 'Hand detected' : 'Show your hand ✋'}
            </div>
          )}
        </div>

        {/* Time bar */}
        <div className="bg-timebar">
          <div className={`bg-timebar-fill ${timeState}`} style={{ width: `${timePct}%` }} />
        </div>
      </main>

      {/* ═══ OVERLAYS ═══════════════════════════════════════════════════ */}
      <AnimatePresence>
        {gamePhase === 'rules' && (
          <RulesModal key="rules" level={level} mode={mode} cfg={cfg} onStart={startFromRules} />
        )}

        {gamePhase === 'countdown' && (
          <motion.div key="cd" className="bg-overlay bg-overlay-soft"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div key={countdown} className="bg-countdown"
              initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 18 }}>
              {countdown}
            </motion.div>
            <p className="bg-countdown-hint">Get your finger ready…</p>
          </motion.div>
        )}

        {isPaused && gamePhase === 'playing' && (
          <motion.div key="pause" className="bg-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="bg-card bg-pause-card"
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}>
              <div className="bg-pause-ico"><Pause size={38} /></div>
              <h2>Paused</h2>
              <p>The bubbles are waiting 🫧</p>
              <div className="bg-actions">
                <button className="bg-btn bg-btn-primary" onClick={togglePause}>
                  <Play size={18} /> Resume
                </button>
                <button className="bg-btn bg-btn-ghost" onClick={restart}>
                  <RotateCcw size={18} /> Restart
                </button>
                <button className="bg-btn bg-btn-ghost" onClick={goHome}>
                  <Home size={18} /> Home
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {gamePhase === 'results' && results && (
          <motion.div key="res" className="bg-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <motion.div className="bg-card bg-results-card"
              initial={{ scale: 0.86, y: 40, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 220, damping: 24 }}>
              <div className="bg-confetti" aria-hidden="true">
                {Array.from({ length: 14 }).map((_, i) => (
                  <span key={i} style={{ '--i': i }} />
                ))}
              </div>

              <h2 className="bg-results-title"><CheckCircle size={26} /> Time&apos;s up!</h2>
              <p className="bg-results-sub">
                {cfg.emoji} {cfg.label} · {mode === 'camera' ? 'Camera' : 'Touch'}
              </p>

              <div className="bg-perf-ring" style={{ '--pct': results.composite }}>
                <div className="bg-perf-inner">
                  <span className="bg-perf-val">{results.composite}</span>
                  <span className="bg-perf-lbl">OT Score</span>
                </div>
              </div>

              <div className="bg-metrics">
                <Metric icon={<Star size={16} />}      label="Score"           value={results.score} />
                <Metric icon={<Crosshair size={16} />} label="Bubbles Popped"
                  value={`${results.popped} / ${results.spawned}`} />
                <Metric icon={<Target size={16} />}    label="Touch Accuracy"  value={`${results.accuracy}%`} />
                <Metric icon={<Zap size={16} />}       label="Reaction Time"
                  value={results.reactionMs == null ? '—' : `${(results.reactionMs / 1000).toFixed(2)}s`} />
                <Metric icon={<Clock size={16} />}     label="Movement Time"
                  value={results.movementMs == null ? '—' : `${(results.movementMs / 1000).toFixed(2)}s`} />
                <Metric icon={<TrendingUp size={16} />} label="Throughput"
                  value={`${results.throughput} bit/s`} />
                <Metric icon={<GitBranch size={16} />} label="Path Efficiency" value={`${results.pathEfficiency}%`} />
                <Metric icon={<RotateCcw size={16} />} label="Corrections"     value={results.corrections} />
                <Metric icon={<Activity size={16} />}  label="Smoothness"      value={`${results.smoothness}%`} />
                <Metric icon={<XCircle size={16} />}   label="Missed"          value={results.missed} />
              </div>

              {results.sweeping && (
                <div className="bg-note">
                  <AlertTriangle size={18} />
                  <span>
                    Path efficiency is low ({results.pathEfficiency}%) — the movement looks
                    like sweeping rather than aiming at individual bubbles.
                  </span>
                </div>
              )}

              <div className="bg-actions">
                <button className="bg-btn bg-btn-primary" onClick={restart}>
                  <RotateCcw size={18} /> Play again
                </button>
                <button className="bg-btn bg-btn-ghost"
                  onClick={() => navigate('/play/bubble-difficulty')}>
                  Levels
                </button>
                <button className="bg-btn bg-btn-ghost" onClick={goHome}>
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

/* ═══════════════════════════════════════════════════════════════════════════
   RULES MODAL
   ═══════════════════════════════════════════════════════════════════════════ */
const RULES = [
  { icon: '🫧', text: 'Bubbles float up from the bottom of the sea.' },
  { icon: '☝️', text: 'Point at the centre of a bubble with your index finger to pop it.' },
  { icon: '🎯', text: 'The closer to the centre you aim, the more points you earn.' },
  { icon: '🐠', text: 'Bubbles that reach the surface escape — be quick!' },
  { icon: '⏱️', text: 'Pop as many bubbles as you can before time runs out.' },
  { icon: '⏸️', text: 'You can pause at any time.' },
];

function RulesModal({ level, mode, cfg, onStart }) {
  return (
    <motion.div className="bg-overlay"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="bg-card bg-rules-card"
        initial={{ scale: 0.88, y: 30, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 22 }}>
        <div className="bg-rules-head">
          <div className="bg-rules-badge">
            <svg viewBox="0 0 100 100" width="48" height="48">
              <defs>
                <radialGradient id="bgRuleSkin" cx="34%" cy="30%" r="72%">
                  <stop offset="0%" stopColor="#BFEAFF" stopOpacity=".95" />
                  <stop offset="55%" stopColor="#5FB8F0" stopOpacity=".6" />
                  <stop offset="100%" stopColor="#2E86C8" stopOpacity=".8" />
                </radialGradient>
              </defs>
              <circle cx="50" cy="50" r="44" fill="url(#bgRuleSkin)" />
              <circle cx="50" cy="50" r="44" fill="none" stroke="#BFEAFF" strokeWidth="2.5" />
              <ellipse cx="35" cy="31" rx="12" ry="8" fill="#fff" opacity=".75"
                transform="rotate(-32 35 31)" />
              <circle cx="63" cy="28" r="4" fill="#fff" opacity=".5" />
            </svg>
          </div>
          <div>
            <h2 className="bg-rules-title">Pop the Bubble</h2>
            <p className="bg-rules-sub">
              {cfg.emoji} {cfg.label} &nbsp;·&nbsp; {mode === 'camera' ? 'Camera mode' : 'Touch mode'}
              &nbsp;·&nbsp; {cfg.durationSec}s
            </p>
          </div>
        </div>

        <ul className="bg-rules-list">
          {RULES.map((r, i) => (
            <motion.li key={i}
              initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.12 + i * 0.07 }}>
              <span className="bg-rule-icon">{r.icon}</span>
              <span>{r.text}</span>
            </motion.li>
          ))}
        </ul>

        {mode === 'camera' && (
          <p className="bg-rules-tip">
            💡 In camera mode, hold your finger on a bubble for a moment — the ring
            fills up, then it pops.
          </p>
        )}

        <button className="bg-btn bg-btn-primary bg-rules-start" onClick={onStart}>
          <Play size={20} /> Let&apos;s go! 🫧
        </button>
      </motion.div>
    </motion.div>
  );
}

function Metric({ icon, label, value }) {
  return (
    <div className="bg-metric">
      <div className="bg-metric-ico">{icon}</div>
      <div className="bg-metric-body">
        <span className="bg-metric-label">{label}</span>
        <span className="bg-metric-value">{value}</span>
      </div>
    </div>
  );
}
