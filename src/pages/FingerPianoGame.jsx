/**
 * FingerPianoGame.jsx
 * "Finger Piano" — occupational-therapy finger-isolation game.
 *
 * One key on the keyboard lights up in the colour of a finger. The child taps
 * that finger in mid-air — anywhere, nothing to touch and nothing to aim at.
 * The tap fires the key, the note sounds, and the light moves on.
 *
 * Dropping the aiming requirement is deliberate: with no target to reach, the
 * only thing the task measures is WHICH FINGER MOVED, which is exactly the
 * skill the exercise trains. Spatial accuracy is a different skill and it is
 * covered by the other games.
 *
 * HOW AN AIR TAP IS DETECTED
 * There is no surface, so a tap cannot be read from the fingertip's position:
 * lowering the whole hand would fire every finger at once. What identifies a
 * tap is the finger FLEXING — a quick bend and release at its own joints. So
 * each finger's extension ratio (tip-to-MCP over PIP-to-MCP) is tracked; that
 * ratio is internal to the finger and therefore immune to the hand drifting,
 * rotating or translating in frame. A fast enough drop past a threshold is a
 * tap; a slow curl is not.
 *
 * TWO HONESTY CONSTRAINTS
 *
 * 1. Simultaneous flexions are reported as ambiguous, never attributed. If two
 *    fingers bend on the same frame, which one the child meant is not
 *    observable; crowning the strongest would silently record a whole-hand slap
 *    as a clean single-finger tap and quietly corrupt the one metric this game
 *    exists to produce.
 *
 * 2. Touch mode cannot know which finger was used. A touchscreen reports a
 *    contact point, never an identity, so there the finger metrics are reported
 *    as unavailable and dropped from the composite (their weight redistributed)
 *    rather than filled with a plausible invention.
 *
 * Performance contract: one rAF loop over refs; React state is touched only for
 * phase changes, the lit key, and a throttled 5 Hz readout.
 *
 * Route (unchanged): /play/finger-piano-game?level=1|2|3
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home, Pause, Play, RotateCcw, Clock, Star, Hand, MousePointer2,
  Volume2, VolumeX, Target, Activity, Zap, TrendingUp, CheckCircle,
  Gauge, Fingerprint, Timer, Info, AlertTriangle, HelpCircle,
} from 'lucide-react';
import useHandTracking from '../hooks/useHandTracking';
import { soundManager } from '../utils/soundManager';
import GameRules from '../components/game/GameRules';
import { otComposite, otRound, otPct, FINISH } from '../utils/otScore';
import { PIANO_LEVELS, PIANO_FINGERS } from './fingerPianoLevels';
import EndGameControl from '../components/game/EndGameControl';
import PianoHand from '../components/game/PianoHand';
import { useAuthStore, useSessionStore } from '../store';
import api from '../services/api';
import '../styles/FingerPianoGame.css';
/* NOTE: GameShell.css is NOT imported here on purpose. It is already pulled in
   by GameRules / EndGameControl above, and an ES module is evaluated once at
   its FIRST import — so a later import would be a no-op and could not change
   the CSS order. The shared game frame wins by SPECIFICITY instead: see
   section 11 of GameShell.css. */

/* ═══════════════════════════════════════════════════════════════════════════
   GEOMETRY — virtual space scaled to the field
   ═══════════════════════════════════════════════════════════════════════════ */
const VW = 1000;
const VH = 560;
/* Where a strike's ripple is born. The keys used to live inside the field, so
   the ripple started at the keys' own y. The keyboard is now above the field,
   in its cabinet, so the ripple starts at the field's top edge — directly under
   the key that was struck — and the beam falls away from it. */
const FX_Y = 8;

/* ── Fingers ────────────────────────────────────────────────────────────── */
/* MediaPipe landmark indices per finger — detection detail, game-only. The
   number/label/colour come from fingerPianoLevels.js so the level card shows
   the SAME dot the child will see here. */
const LANDMARKS = {
  thumb:  { tip: 4,  pip: 3,  mcp: 2  },
  index:  { tip: 8,  pip: 6,  mcp: 5  },
  middle: { tip: 12, pip: 10, mcp: 9  },
  ring:   { tip: 16, pip: 14, mcp: 13 },
  little: { tip: 20, pip: 18, mcp: 17 },
};
const FINGERS = PIANO_FINGERS.map((f) => ({ ...f, ...LANDMARKS[f.key] }));
const FINGER_BY_KEY = Object.fromEntries(FINGERS.map((f) => [f.key, f]));

/* ── Keyboard: one and a half octaves from C4 ───────────────────────────── */
const WHITE_NOTES = [
  { name: 'C4', midi: 60 }, { name: 'D4', midi: 62 }, { name: 'E4', midi: 64 },
  { name: 'F4', midi: 65 }, { name: 'G4', midi: 67 }, { name: 'A4', midi: 69 },
  { name: 'B4', midi: 71 }, { name: 'C5', midi: 72 }, { name: 'D5', midi: 74 },
  { name: 'E5', midi: 76 },
];
/* Black keys sit between white keys; index = the white key they follow. */
const BLACK_AFTER = [0, 1, 3, 4, 5, 7, 8];
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

/* ── Difficulty. The difficulty page advertises 3 fingers on level 1 and all
      five on 2-3, so the pools must match what the child was shown. ─────── */
/* The level tuning lives in fingerPianoLevels.js so the level-select cards read
   the SAME numbers the round will run. They were maintained separately before,
   and the cards had drifted into promising features that do not exist. */
const LEVELS = PIANO_LEVELS;

/* ── Detection constants (validated against synthetic hands) ────────────── */
const EMA_ALPHA   = 0.40;
/* Board units below which a movement is hand tremor, not intent. */
const STILL_EPS   = 2.5;
/* ── Air-tap thresholds ────────────────────────────────────────────────────
   These used to be ABSOLUTE readings of tip→MCP over PIP→MCP, with one pair of
   levels (arm 1.90, fire 1.65) for all five fingers. That silently made the
   THUMB impossible to play. A straight thumb only reaches ≈1.81 on that ratio —
   its two bones are nearly the same length, where a long finger's three
   phalanges reach ≈2.04 — so the thumb sat BELOW the arming level at rest and
   could never be armed, and therefore could never fire. Worse, the motion a
   child actually makes for a thumb tap is swinging it across the palm, which
   that ratio does not see at all: 40° of adduction leaves it at 1.807, exactly
   where it started.

   So thresholds are now a SHARE of each finger's own straight-hand reading (see
   `metricOf` for the thumb's own measure and `calibrate` for the reference).
   The fractions below are the old levels divided by a long finger's straight
   value, so the four long fingers behave exactly as they did before, and the
   thumb finally works on its own scale. */
const ARM_FRAC    = 0.93;   // ≥93% of its own straight reading = armed  (1.90/2.04)
const FIRE_FRAC   = 0.81;   // dropping below 81% while armed = a tap    (1.65/2.04)
const MIN_RATE_U  = 1.2;    // min flexion speed (straight-units/s) — rejects a slow curl
const REARM_MS    = 90;     // a finger cannot re-tap sooner than this
const GOOD_AMPL_U = 0.42;   // flexion depth of a decisive tap
const GOOD_RATE_U = 4.4;    // flexion speed of a decisive tap
/* Calibration guard rails: a straight-hand reference outside these bands came
   from a misdetected frame, not from a hand. */
const CAL_BAND    = { thumb: [0.40, 1.50], long: [1.55, 2.80] };
const CAL_RISE    = 1.0;    // a straighter reading is believed at once
const CAL_FALL    = 0.02;   // …a smaller one only seeps in, ~2%/frame
const PAUSE_MS    = 900;    // gap above which the child counts as hesitating
const COUNTDOWN_SECONDS = 3;
const RULES_FLAG  = 'fingerpiano_rules_seen';
const REF_NPM     = 45;     // notes/minute treated as a brisk, controlled pace

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const stdev = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - m) ** 2)));
};
const fmtTime = (s) => {
  const m = Math.floor(Math.max(0, s) / 60);
  const r = Math.floor(Math.max(0, s) % 60);
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
};

/* ═══════════════════════════════════════════════════════════════════════════
   PIANO SYNTHESIS
   A sine beep does not sound like a piano. What makes a piano recognisable is
   inharmonicity — stiff strings put the nth partial slightly sharp of n×f0 —
   together with higher partials dying away before the fundamental, and a short
   hammer transient at onset. All three are modelled here. No audio files, so
   nothing to ship or fetch.
   ═══════════════════════════════════════════════════════════════════════════ */
const INHARMONICITY = 0.0004;
const N_PARTIALS = 8;

class PianoSynth {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.reverb = null;
    this.enabled = true;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;

    // A short generated impulse gives the notes a room instead of a dead studio.
    try {
      const len = Math.floor(this.ctx.sampleRate * 1.2);
      const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
        }
      }
      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = buf;
      const wet = this.ctx.createGain();
      wet.gain.value = 0.18;
      this.master.connect(this.reverb);
      this.reverb.connect(wet);
      wet.connect(this.ctx.destination);
    } catch { /* convolver unavailable — dry signal still plays */ }

    this.master.connect(this.ctx.destination);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  /** One note. Voices free themselves when their envelope ends. */
  play(freq, velocity = 0.8) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    this.resume();
    const ctx = this.ctx;
    const t0 = ctx.currentTime;

    const voice = ctx.createGain();
    voice.gain.value = velocity * 0.34;
    voice.connect(this.master);

    let longest = 0;
    for (let i = 0; i < N_PARTIALS; i++) {
      const n = i + 1;
      // Stiff-string inharmonicity: partials stretch sharp as n grows.
      const f = freq * n * Math.sqrt(1 + INHARMONICITY * n * n);
      if (f > ctx.sampleRate / 2) break;
      const amp = 1 / Math.pow(n, 1.4);
      // Higher partials decay faster — this is what stops it sounding like an organ.
      const decay = 2.6 / Math.pow(n, 0.55);
      longest = Math.max(longest, decay);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(amp, t0 + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      osc.connect(g);
      g.connect(voice);
      osc.start(t0);
      osc.stop(t0 + decay + 0.05);
    }

    // Hammer transient: a very short band-passed noise burst at onset.
    try {
      const nlen = Math.floor(ctx.sampleRate * 0.015);
      const nbuf = ctx.createBuffer(1, nlen, ctx.sampleRate);
      const nd = nbuf.getChannelData(0);
      for (let i = 0; i < nlen; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nlen);
      const src = ctx.createBufferSource();
      src.buffer = nbuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(freq * 4, 5200);
      bp.Q.value = 1.1;
      const ng = ctx.createGain();
      ng.gain.value = velocity * 0.12;
      src.connect(bp); bp.connect(ng); ng.connect(voice);
      src.start(t0);
    } catch { /* noise burst is decorative */ }

    setTimeout(() => { try { voice.disconnect(); } catch { /* already gone */ } },
      (longest + 0.2) * 1000);
  }

  /** A soft thud for a wrong-finger hit — audible, but clearly not a reward. */
  playDull(freq) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    this.resume();
    const ctx = this.ctx, t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq * 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.12, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    osc.connect(lp); lp.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + 0.36);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   FINGER DETECTION
   ═══════════════════════════════════════════════════════════════════════════ */
const dist2d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** tip→MCP over PIP→MCP, for the four long fingers. Internal to the finger, so
 *  it is unaffected by how far the hand is from the camera or how it is turned. */
function extensionOf(lm, f) {
  const base = dist2d(lm[f.pip], lm[f.mcp]) || 1e-6;
  return dist2d(lm[f.tip], lm[f.mcp]) / base;
}

/** The thumb needs its own measure: THUMB OPENNESS — the distance from the
 *  thumb tip to the index knuckle, over the width of the palm.
 *
 *  The ratio used for the long fingers reads bending at the finger's own
 *  joints. A thumb tap is mostly not that: the child swings the thumb inwards
 *  across the palm, and the thumb's own joints barely move. Openness sees both
 *  motions, because bending the thumb AND swinging it in both bring the tip
 *  closer to the index knuckle. Dividing by the palm width (index knuckle to
 *  little knuckle) keeps it independent of hand size and camera distance, just
 *  like the ratio it replaces.
 *
 *  Measured on the model hand: open ≈0.70, 20° of swing ≈0.50, 40° ≈0.29. */
function thumbOpennessOf(lm) {
  const palm = dist2d(lm[5], lm[17]) || 1e-6;
  return dist2d(lm[4], lm[5]) / palm;
}

/** The one reading this game watches, per finger. */
function metricOf(lm, f) {
  return f.key === 'thumb' ? thumbOpennessOf(lm) : extensionOf(lm, f);
}

/**
 * Per-finger flexion state machine. See the file header for why this reads
 * flexion rather than fingertip height.
 *
 * Everything below works in STRAIGHT UNITS: 1 = this finger, on this child, as
 * straight as it has been seen. `calibrate` maintains that reference and hands
 * back the normalised reading; the thresholds are then the same fractions for
 * every finger, which is what makes the thumb playable (see ARM_FRAC).
 */
function makeTapDetector() {
  const blank = () => ({ u: 1, armed: true, lastFire: -1e9, peakRate: 0, top: 0, ref: null });
  const st = {};
  for (const f of FINGERS) st[f.key] = blank();

  return {
    reset() { for (const f of FINGERS) st[f.key] = blank(); },

    /**
     * One camera frame of RAW readings in; normalised readings out.
     *
     * The reference follows a straighter reading immediately and a smaller one
     * only very slowly, so it settles on the child's real straight hand and is
     * not dragged down by the taps themselves. Readings outside the plausible
     * band for that measure come from a misdetected frame and are ignored, so
     * one bad frame cannot recalibrate the finger out of the game.
     */
    calibrate(raw) {
      const u = {};
      for (const f of FINGERS) {
        const e = raw[f.key];
        if (e == null) continue;
        const [lo, hi] = CAL_BAND[f.key === 'thumb' ? 'thumb' : 'long'];
        const s = st[f.key];
        if (e >= lo && e <= hi) {
          if (s.ref == null) s.ref = e;
          else if (e > s.ref) s.ref += (e - s.ref) * CAL_RISE;
          else if (s.armed && e > s.ref * ARM_FRAC) s.ref += (e - s.ref) * CAL_FALL;
        }
        if (s.ref) u[f.key] = e / s.ref;
      }
      return u;
    },

    /** One frame in — normalised readings; a tap event out, or null. */
    update(ext, ts, dt) {
      const fired = [];
      for (const f of FINGERS) {
        const s = st[f.key];
        const e = ext[f.key];
        if (e == null) continue;
        const rate = (s.u - e) / Math.max(dt, 1e-6);
        if (rate > s.peakRate) s.peakRate = rate;
        if (s.armed && e > s.top) s.top = e;
        if (s.armed && e < FIRE_FRAC && rate >= MIN_RATE_U && ts - s.lastFire > REARM_MS) {
          fired.push({ finger: f.key, amplitude: s.top - e, rate: s.peakRate });
          s.armed = false;
          s.lastFire = ts;
        }
        if (!s.armed && e > ARM_FRAC) { s.armed = true; s.peakRate = 0; s.top = e; }
        s.u = e;
      }
      if (!fired.length) return null;

      if (fired.length > 1) {
        return {
          ambiguous: true,
          fingers: fired.map((x) => x.finger),
          isolation: 0,
          amplitude: Math.max(...fired.map((x) => x.amplitude)),
          rate: Math.max(...fired.map((x) => x.rate)),
        };
      }
      const t = fired[0];
      const others = FINGERS.filter((f) => f.key !== t.finger);
      /* "Still" is now also per finger. On the old absolute scale the thumb
         never cleared the bar, so it counted as moving on EVERY tap and quietly
         docked the isolation score of every other finger. */
      const still = others.filter((f) => (ext[f.key] ?? 1) > ARM_FRAC).length;
      t.isolation = others.length ? still / others.length : 1;
      t.ambiguous = false;
      return t;
    },

    /** Live state per finger, for the on-screen hand read-out. */
    peek() { return st; },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   RULES
   ═══════════════════════════════════════════════════════════════════════════ */
const RULES = [
  { icon: '🎹', text: 'The piano is at the top. Every key keeps its own number, always the same one.' },
  { icon: '💡', text: 'One key lights up at a time, in the colour of a finger.' },
  { icon: '🖐️', text: 'The hand below shows WHICH finger: it is the one glowing.' },
  { icon: '👆', text: 'Tap that finger in the air — nothing to touch, no need to aim.' },
  { icon: '✋', text: 'Move only that finger; keep the others still and straight.' },
  { icon: '🖱️', text: 'On Touch / Mouse, just click the keyboard instead.' },
  { icon: '⏸️', text: 'You can pause at any time.' },
];

/* `resume` = opened from the in-game "How to play" button rather than shown
   automatically before the first round, so the primary button returns to the
   game instead of starting one. */
/* Thin wrapper over the shared rules card — see GameRules.jsx. */
function RulesModal({ cfg, mode, onStart, resume = false }) {
  return (
    <GameRules
      emoji="🎹"
      title="Finger Piano"
      subtitle={`${cfg.emoji} ${cfg.label} · ${mode === 'camera' ? 'Camera mode' : 'Touch mode'} · ${cfg.notes} notes`}
      rules={RULES}
      onStart={onStart}
      resume={resume}
      startLabel={resume ? 'Back to the game' : "Let's play! 🎹"}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */
export default function FingerPianoGame() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, profile } = useAuthStore();
  const { startSession: storeStartSession, endSession: storeEndSession } = useSessionStore();

  const levelId = parseInt(searchParams.get('level') || '1', 10);
  const level = LEVELS[levelId] ? levelId : 1;
  const cfg = LEVELS[level];
  const difficultyName = level === 1 ? 'easy' : level === 2 ? 'medium' : 'hard';

  const [mode, setMode] = useState(
    (searchParams.get('mode') || 'camera').toLowerCase() === 'touch' ? 'touch' : 'camera'
  );
  const [soundEnabled, setSoundEnabled] = useState(true);

  const [gamePhase, setGamePhase] = useState(() =>
    sessionStorage.getItem(RULES_FLAG) ? 'countdown' : 'rules'
  );
  const [isPaused, setIsPaused] = useState(false);
  /* True while the end-game confirmation is on screen. The round is paused
     then, but the PAUSE CARD must stay hidden so only one card shows. */
  const [endAsking, setEndAsking] = useState(false);
  const [showHelp, setShowHelp] = useState(false);   // "How to play", re-openable mid-game
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);

  const [uiScore, setUiScore] = useState(0);
  const [uiHit, setUiHit] = useState(0);
  const [uiElapsed, setUiElapsed] = useState(0);
  const [litKey, setLitKey] = useState(null);   // { keyIdx, fingerKey, midi }
  const [toast, setToast] = useState(null);
  const [results, setResults] = useState(null);

  /* ── DOM refs ── */
  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);
  const fieldRef   = useRef(null);
  const fxCanvasRef = useRef(null);
  const handCanvasRef = useRef(null);
  const keyRefs    = useRef([]);
  const handCardRef = useRef(null);   // the wireframe hand, driven from the loop

  /* ── Loop state ── */
  const rafRef     = useRef(null);
  const lastTsRef  = useRef(0);
  const elapsedRef = useRef(0);
  const queueRef   = useRef([]);        // prompts still to show
  const targetRef  = useRef(null);      // { keyIdx, fingerKey, midi, shownAt }
  const restUntilRef = useRef(0);       // brief gap between prompts
  const doneRef    = useRef(0);         // prompts resolved (hit, wrong or timeout)
  const fxRef      = useRef([]);
  const synthRef   = useRef(null);

  /* ── Hand state ── */
  const tipsRef       = useRef(null);   // smoothed tip positions, for the read-out
  const extRef        = useRef(null);   // smoothed extension per finger
  const tapperRef     = useRef(null);   // flexion state machine
  const touchTapRef   = useRef(null);   // pending touch tap
  const ambiguousRef  = useRef(0);      // taps rejected as undecidable

  /* ── Metrics ── */
  const scoreRef     = useRef(0);
  const hitRef       = useRef(0);
  const missRef      = useRef(0);
  const wrongFingerRef = useRef(0);
  const reactionsRef = useRef([]);
  const isolationsRef = useRef([]);
  const intervalsRef = useRef([]);
  const amplitudesRef = useRef([]);
  const ratesRef     = useRef([]);
  const pausesRef    = useRef(0);
  const lastHitAtRef = useRef(null);
  const perFingerRef = useRef({});

  const [sessionId, setSessionId] = useState(null);
  const sessionSavedRef = useRef(false);

  const isPlaying = gamePhase === 'playing' && !isPaused;
  const trackingEnabled = mode === 'camera' && (gamePhase === 'countdown' || gamePhase === 'playing');

  const { landmarks, isTracking, isSimulationMode, releaseCamera } = useHandTracking(
    videoRef, canvasRef, trackingEnabled
  );

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

  /* ── Keyboard geometry ── */
  const keys = useMemo(() => {
    const whites = WHITE_NOTES.slice(0, cfg.whiteKeys);
    const w = VW / whites.length;
    const white = whites.map((k, i) => ({
      ...k, i, type: 'white', x: i * w, w, cx: i * w + w / 2,
    }));
    const black = BLACK_AFTER
      .filter((i) => i < whites.length - 1)
      .map((i) => ({
        name: `${whites[i].name}#`, midi: whites[i].midi + 1, i, type: 'black',
        w: w * 0.58, x: (i + 1) * w - w * 0.29, cx: (i + 1) * w,
      }));
    return { white, black, all: [...white, ...black] };
  }, [cfg.whiteKeys]);

  /* ── Build the prompt queue for this run ── */
  const buildQueue = useCallback(() => {
    const q = [];
    for (let i = 0; i < cfg.notes; i++) {
      const fk = cfg.fingers[Math.floor(Math.random() * cfg.fingers.length)];
      const k = keys.white[Math.floor(Math.random() * keys.white.length)];
      q.push({ fingerKey: fk, keyIdx: k.i, midi: k.midi });
    }
    return q;
  }, [cfg.notes, cfg.fingers, keys.white]);

  /* ═════════════════════════════════════════════════════════════════════════
     INPUT
     ═════════════════════════════════════════════════════════════════════════ */
  useEffect(() => {
    if (mode !== 'camera' || !isPlaying) return;
    if (!landmarks || landmarks.length < 21) return;

    const prevTips = tipsRef.current;
    const prevExt = extRef.current;
    const tips = {};
    const ext = {};
    const raw = {};
    for (const f of FINGERS) {
      const p = landmarks[f.tip];
      if (!p) continue;
      const nx = (1 - p.x) * VW;
      const ny = p.y * VH;
      /* Micro-deadband so a fingertip resting on a key stops twitching:
         movement below STILL_EPS board units is treated as tremor and does not
         move the point, ramping smoothly to full response just above it. */
      if (prevTips && prevTips[f.key]) {
        const pv = prevTips[f.key];
        const d = Math.hypot(nx - pv.x, ny - pv.y);
        const hold = d <= STILL_EPS ? 0 : Math.min(1, (d - STILL_EPS) / STILL_EPS);
        const a = EMA_ALPHA * hold;
        tips[f.key] = { x: pv.x + (nx - pv.x) * a, y: pv.y + (ny - pv.y) * a };
      } else {
        tips[f.key] = { x: nx, y: ny };
      }
      raw[f.key] = metricOf(landmarks, f);
    }
    /* Raw readings are turned into "share of this finger's own straight hand"
       here, once per camera frame, so every threshold downstream — the tap
       detector, the isolation check and the flex rings on the hand — speaks the
       same normalised language. */
    if (!tapperRef.current) tapperRef.current = makeTapDetector();
    const u = tapperRef.current.calibrate(raw);
    for (const f of FINGERS) {
      const e = u[f.key];
      if (e == null) continue;
      ext[f.key] = prevExt && prevExt[f.key] != null
        ? prevExt[f.key] + (e - prevExt[f.key]) * EMA_ALPHA
        : e;
    }
    tipsRef.current = tips;
    extRef.current = ext;
  }, [landmarks, mode, isPlaying]);

  /* In touch mode the child taps anywhere on the field. The contact point is
     all a touchscreen reports, so the finger stays unknown by construction. */
  const handlePointerDown = useCallback((e) => {
    if (mode !== 'touch' || !isPlaying) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    touchTapRef.current = { at: performance.now() };
  }, [mode, isPlaying]);

  const handlePointerUp = useCallback((e) => {
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }, []);

  /* ═════════════════════════════════════════════════════════════════════════
     SCORING A STRIKE
     ═════════════════════════════════════════════════════════════════════════ */
  const flashKey = useCallback((keyIdx, cls) => {
    const el = keyRefs.current[keyIdx];
    if (!el) return;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 220);
  }, []);

  /** Light the next key, or finish if the queue is empty. */
  const nextTarget = useCallback((ts) => {
    const spec = queueRef.current.shift();
    if (!spec) { targetRef.current = null; setLitKey(null); return; }
    targetRef.current = { ...spec, shownAt: ts };
    setLitKey({ keyIdx: spec.keyIdx, fingerKey: spec.fingerKey, midi: spec.midi });
  }, []);

  /**
   * Resolve the lit key against a tap.
   * `fingerKey` is null in touch mode (identity unobservable) and `ambiguous`
   * is true when several fingers flexed together.
   */
  const resolveTap = useCallback((ts, fingerKey, isolation, tap) => {
    const t = targetRef.current;
    if (!t) return;
    const wanted = FINGER_BY_KEY[t.fingerKey];
    const k = keys.white[t.keyIdx];

    if (tap && tap.ambiguous) {
      /* Several fingers at once: not attributable, so it scores nothing and
         pollutes no per-finger statistic. The child is told what to fix. */
      ambiguousRef.current += 1;
      if (soundEnabled) synthRef.current?.playDull(midiToFreq(t.midi));
      flashKey(t.keyIdx, 'fpp-key-wrong');
      setToast({ text: 'One finger only!', kind: 'warn' });
      setTimeout(() => setToast(null), 900);
      return;                       // the key stays lit; try again
    }

    const correct = fingerKey == null ? null : fingerKey === t.fingerKey;

    if (correct === false) {
      /* Wrong finger: it still sounds — silence would punish a child who is
         trying — but earns nothing and is logged against the finger asked for. */
      wrongFingerRef.current += 1;
      doneRef.current += 1;
      const pf = perFingerRef.current[t.fingerKey] ||
        (perFingerRef.current[t.fingerKey] = { asked: 0, hit: 0, rt: [], iso: [] });
      pf.asked += 1;
      if (soundEnabled) synthRef.current?.playDull(midiToFreq(t.midi));
      flashKey(t.keyIdx, 'fpp-key-wrong');
      fxRef.current.push({ x: k.cx, y: FX_Y, t0: ts, color: '#FB923C', weak: true });
      setToast({ text: `Use finger ${wanted.n}`, kind: 'warn' });
    } else {
      hitRef.current += 1;
      doneRef.current += 1;
      const pf = perFingerRef.current[t.fingerKey] ||
        (perFingerRef.current[t.fingerKey] = { asked: 0, hit: 0, rt: [], iso: [] });
      pf.asked += 1;
      pf.hit += 1;
      const rt = ts - t.shownAt;
      pf.rt.push(rt);
      reactionsRef.current.push(rt);
      if (isolation != null) { isolationsRef.current.push(isolation); pf.iso.push(isolation); }
      if (tap) { amplitudesRef.current.push(tap.amplitude); ratesRef.current.push(tap.rate); }
      /* A crisp, well-isolated tap is worth more than a hesitant one. */
      const crisp = tap ? clamp01(tap.amplitude / GOOD_AMPL_U) * clamp01(tap.rate / GOOD_RATE_U) : 0.6;
      scoreRef.current += 10 + Math.round(5 * crisp);
      if (soundEnabled) synthRef.current?.play(midiToFreq(t.midi), 0.7 + 0.3 * crisp);
      flashKey(t.keyIdx, 'fpp-key-hit');
      fxRef.current.push({ x: k.cx, y: FX_Y, t0: ts, color: wanted.color, weak: false });
      setToast({ text: crisp > 0.75 ? 'Perfect!' : 'Great!', kind: 'ok' });
    }

    if (lastHitAtRef.current != null) {
      const gap = ts - lastHitAtRef.current;
      intervalsRef.current.push(gap);
      if (gap > PAUSE_MS) pausesRef.current += 1;
    }
    lastHitAtRef.current = ts;

    setTimeout(() => setToast(null), 900);
    targetRef.current = null;
    setLitKey(null);
    restUntilRef.current = ts + cfg.restMs;
  }, [keys.white, soundEnabled, flashKey, cfg.restMs]);

  /* ═════════════════════════════════════════════════════════════════════════
     RESULTS
     ═════════════════════════════════════════════════════════════════════════ */
  /* @param {string} reason  FINISH.COMPLETE when the piece was played through,
     FINISH.ENDED when the learner pressed "End game". */
  const finishGame = useCallback((reason = FINISH.COMPLETE) => {
    cancelAnimationFrame(rafRef.current);

    /* EVERY SUB-SCORE IS `null` WHEN IT HAS NO DATA — see src/utils/otScore.js.
       `reactionScore` was the trap here: with no reaction samples `mean()` is
       0 ms, and 0 ms is FASTER than the 600 ms "quick" reference, so an
       untouched round scored a perfect 100 for reaction time. */
    const attempted = hitRef.current + wrongFingerRef.current + missRef.current;
    const accuracy = attempted ? (hitRef.current / attempted) * 100 : null;

    const iv = intervalsRef.current;
    const ivMean = mean(iv);
    const ivSd = stdev(iv);
    // Rhythm consistency = 1 - coefficient of variation of the inter-key gaps.
    const rhythm = ivMean > 0 ? clamp01(1 - ivSd / ivMean) * 100 : null;

    const rtMean = reactionsRef.current.length ? mean(reactionsRef.current) : null;
    // 2.5 s to reach a key is slow for a child; 0.6 s is quick.
    const reactionScore = rtMean == null
      ? null
      : clamp01((2500 - rtMean) / (2500 - 600)) * 100;

    const npm = elapsedRef.current > 0
      ? (hitRef.current / (elapsedRef.current / 60000)) : 0;
    const speedScore = hitRef.current > 0 ? clamp01(npm / REF_NPM) * 100 : null;

    /* With nothing to travel towards, path smoothness no longer means anything.
       What can be measured instead is how decisive each tap was: how far the
       finger actually flexed and how fast. Both are read straight off the
       landmarks, not inferred. */
    const tapQuality = amplitudesRef.current.length
      ? clamp01(
          clamp01(mean(amplitudesRef.current) / GOOD_AMPL_U) *
          clamp01(mean(ratesRef.current) / GOOD_RATE_U)
        ) * 100
      : null;

    const cameraMetrics = mode === 'camera' && isolationsRef.current.length > 0;
    const isolation = cameraMetrics ? mean(isolationsRef.current) * 100 : null;

    /* Touch mode cannot observe isolation, and an unplayed round cannot observe
       anything: otComposite() renormalises over whatever WAS measured rather
       than filling the gaps with invented values. */
    const composite = cameraMetrics
      ? otComposite([[accuracy, 0.28], [isolation, 0.25], [tapQuality, 0.15],
                     [rhythm, 0.14], [reactionScore, 0.12], [speedScore, 0.06]])
      : otComposite([[accuracy, 0.46], [rhythm, 0.23],
                     [reactionScore, 0.20], [speedScore, 0.11]]);

    const perFinger = FINGERS
      .filter((f) => cfg.fingers.includes(f.key))
      .map((f) => {
        const p = perFingerRef.current[f.key] || { asked: 0, hit: 0, rt: [], iso: [] };
        return {
          key: f.key, label: f.label, n: f.n, color: f.color,
          asked: p.asked, hit: p.hit,
          accuracy: p.asked ? Math.round((p.hit / p.asked) * 100) : null,
          rtMs: p.rt.length ? Math.round(mean(p.rt)) : null,
          isolation: (cameraMetrics && p.iso.length) ? Math.round(mean(p.iso) * 100) : null,
        };
      });

    setResults({
      endedEarly: reason === FINISH.ENDED,
      score: Math.round(scoreRef.current),
      hit: hitRef.current,
      wrongFinger: wrongFingerRef.current,
      missed: missRef.current,
      total: cfg.notes,
      accuracy: otRound(accuracy),
      isolation: otRound(isolation),
      reactionMs: otRound(rtMean),
      intervalMs: iv.length ? Math.round(ivMean) : null,
      intervalSd: iv.length ? Math.round(ivSd) : null,
      rhythm: otRound(rhythm),
      tapQuality: otRound(tapQuality),
      ambiguous: ambiguousRef.current,
      npm: Math.round(npm),
      pauses: pausesRef.current,
      totalSec: elapsedRef.current / 1000,
      composite,
      cameraMetrics,
      perFinger,
    });
    setGamePhase('results');
    if (soundEnabled) soundManager.playCelebration();
  }, [cfg.notes, cfg.fingers, mode, soundEnabled]);

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

      /* ── Light the next key once the short rest has elapsed ───────────── */
      if (!targetRef.current && ts >= restUntilRef.current) {
        if (queueRef.current.length) nextTarget(ts);
      }

      /* ── Timeout: the child did not answer this key ───────────────────── */
      const t = targetRef.current;
      if (t && ts - t.shownAt > cfg.timeoutMs) {
        missRef.current += 1;
        doneRef.current += 1;
        const pf = perFingerRef.current[t.fingerKey] ||
          (perFingerRef.current[t.fingerKey] = { asked: 0, hit: 0, rt: [], iso: [] });
        pf.asked += 1;
        flashKey(t.keyIdx, 'fpp-key-wrong');
        targetRef.current = null;
        setLitKey(null);
        restUntilRef.current = ts + cfg.restMs;
      }

      /* ── Read a tap ───────────────────────────────────────────────────── */
      if (mode === 'camera') {
        const ext = extRef.current;
        if (ext && tapperRef.current) {
          const tap = tapperRef.current.update(ext, ts, dt);
          if (tap && targetRef.current) {
            resolveTap(ts, tap.ambiguous ? null : tap.finger, tap.isolation, tap);
          }
        }
      } else if (touchTapRef.current) {
        touchTapRef.current = null;
        // finger identity is unobservable on a touchscreen — pass null
        if (targetRef.current) resolveTap(ts, null, null, null);
      }

      drawFx(ts);
      if (mode === 'camera') drawHand(ts);

      if (ts - lastUi > 200) {
        lastUi = ts;
        setUiScore(Math.round(scoreRef.current));
        setUiHit(hitRef.current);
        setUiElapsed(elapsedRef.current / 1000);
      }

      if (!queueRef.current.length && !targetRef.current && doneRef.current >= cfg.notes) {
        cancelAnimationFrame(rafRef.current);
        finishRef.current();
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [gamePhase, isPaused, cfg, mode, nextTarget, resolveTap, flashKey]);

  /* ═════════════════════════════════════════════════════════════════════════
     FX CANVAS — impact rings and particles
     ═════════════════════════════════════════════════════════════════════════ */
  const drawFx = useCallback((ts) => {
    const cv = fxCanvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const rect = cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const kx = rect.width / VW, ky = rect.height / VH;
    const fx = fxRef.current;
    for (let i = fx.length - 1; i >= 0; i--) {
      const e = fx[i];
      const u = (ts - e.t0) / 520;
      if (u >= 1) { fx.splice(i, 1); continue; }
      const cx = e.x * kx, cy = e.y * ky;

      ctx.beginPath();
      ctx.arc(cx, cy, 16 + u * 70, 0, Math.PI * 2);
      ctx.lineWidth = 4 * (1 - u);
      ctx.strokeStyle = e.color;
      ctx.globalAlpha = (1 - u) * (e.weak ? 0.4 : 0.85);
      ctx.stroke();

      if (!e.weak) {
        /* The beam now falls from the keyboard into the field, following the
           direction the sound comes from. */
        const grd = ctx.createLinearGradient(cx, cy, cx, cy + 150);
        grd.addColorStop(0, e.color);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = (1 - u) * 0.5;
        ctx.fillStyle = grd;
        ctx.fillRect(cx - 22, cy, 44, 150 * u);
      }

      const n = e.weak ? 5 : 10;
      for (let p = 0; p < n; p++) {
        const a = -Math.PI / 2 + (p / (n - 1) - 0.5) * Math.PI * 1.1;
        const d = u * (e.weak ? 46 : 92);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, Math.max(0.5, 4 * (1 - u)), 0, Math.PI * 2);
        ctx.fillStyle = e.color;
        ctx.globalAlpha = 1 - u;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }, []);

  /* ═════════════════════════════════════════════════════════════════════════
     HAND CANVAS — the child sees their own isolation
     ═════════════════════════════════════════════════════════════════════════ */
  const drawHand = useCallback(() => {
    const cv = handCanvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const rect = cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const tips = tipsRef.current;
    const ext = extRef.current;
    if (!tips || !ext) { handCardRef.current?.clear(); return; }
    const kx = rect.width / VW, ky = rect.height / VH;
    const wanted = targetRef.current?.fingerKey;

    /* Feed the same flexion to the hand card, so the drawn hand bends with the
       child's. It writes a CSS variable on the DOM node directly — no React
       state, so this costs nothing per frame. */
    const cardFlex = {};
    for (const f of FINGERS) {
      const e = ext[f.key];
      if (e != null) cardFlex[f.key] = clamp01((ARM_FRAC - e) / (ARM_FRAC - FIRE_FRAC));
    }
    handCardRef.current?.setFlex(cardFlex);

    for (const f of FINGERS) {
      const t = tips[f.key];
      if (!t) continue;
      const e = ext[f.key] ?? 1;
      const x = t.x * kx, y = t.y * ky;
      /* The ring fills as the finger bends, so the child can see how close the
         tap is to registering — and that the others are not moving. */
      const flex = clamp01((ARM_FRAC - e) / (ARM_FRAC - FIRE_FRAC));
      const isWanted = f.key === wanted;

      ctx.beginPath();
      ctx.arc(x, y, 13, 0, Math.PI * 2);
      ctx.fillStyle = f.color;
      ctx.globalAlpha = 0.14 + 0.4 * flex;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = isWanted ? 3.5 : 2;
      ctx.strokeStyle = isWanted ? f.color : 'rgba(255,255,255,0.5)';
      ctx.stroke();

      if (flex > 0.02) {
        ctx.beginPath();
        ctx.arc(x, y, 19, -Math.PI / 2, -Math.PI / 2 + flex * Math.PI * 2);
        ctx.lineWidth = 4;
        ctx.strokeStyle = f.color;
        ctx.stroke();
      }

      ctx.font = isWanted ? '900 13px Inter, sans-serif' : '700 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = isWanted ? f.color : 'rgba(255,255,255,0.7)';
      ctx.fillText(String(f.n), x, y - 26);
    }
  }, []);

  /* ═════════════════════════════════════════════════════════════════════════
     COUNTDOWN + RESET
     ═════════════════════════════════════════════════════════════════════════ */
  const resetRun = useCallback(() => {
    lastTsRef.current = 0;
    elapsedRef.current = 0;
    scoreRef.current = 0;
    hitRef.current = 0;
    missRef.current = 0;
    wrongFingerRef.current = 0;
    ambiguousRef.current = 0;
    doneRef.current = 0;
    reactionsRef.current = [];
    isolationsRef.current = [];
    intervalsRef.current = [];
    amplitudesRef.current = [];
    ratesRef.current = [];
    pausesRef.current = 0;
    lastHitAtRef.current = null;
    perFingerRef.current = {};
    fxRef.current = [];
    targetRef.current = null;
    restUntilRef.current = 0;
    touchTapRef.current = null;
    tapperRef.current = makeTapDetector();
    queueRef.current = buildQueue();
    setLitKey(null);
  }, [buildQueue]);

  useEffect(() => {
    if (gamePhase !== 'countdown') return;
    setCountdown(COUNTDOWN_SECONDS);
    let n = COUNTDOWN_SECONDS;
    if (!synthRef.current) synthRef.current = new PianoSynth();
    synthRef.current.enabled = soundEnabled;
    if (soundEnabled) { soundManager.init(); synthRef.current.init(); soundManager.playCountdown(); }
    const id = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(id);
        if (soundEnabled) soundManager.playCountdownGo();
        resetRun();
        setUiScore(0); setUiHit(0); setUiElapsed(0);
        setGamePhase('playing');
      } else {
        setCountdown(n);
        if (soundEnabled) soundManager.playCountdown();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [gamePhase, soundEnabled, resetRun]);

  useEffect(() => {
    if (synthRef.current) synthRef.current.enabled = soundEnabled;
  }, [soundEnabled]);

  /* ═════════════════════════════════════════════════════════════════════════
     SESSION API
     ═════════════════════════════════════════════════════════════════════════ */
  useEffect(() => {
    if (gamePhase !== 'playing' || sessionId) return;
    const learnerId = profile?.learner_id || user?.id || '00000000-0000-0000-0000-000000000010';
    api.post('/sessions/start', {
      learner_id: learnerId,
      difficulty: difficultyName,
      game_name: 'Finger Piano',
    }).then((res) => {
      const sid = res.data?.session_id;
      if (sid) { setSessionId(sid); storeStartSession(sid, learnerId, difficultyName); }
    }).catch((err) => console.warn('[FingerPianoGame] Could not start session:', err));
  }, [gamePhase, sessionId, difficultyName, profile, user, storeStartSession]);

  useEffect(() => {
    if (gamePhase !== 'results' || !results || !sessionId || sessionSavedRef.current) return;
    sessionSavedRef.current = true;
    const durationSeconds = Math.max(1, Math.round(results.totalSec));
    api.post('/sessions/end', {
      session_id: sessionId,
      duration_seconds: durationSeconds,
      accuracy_score: parseFloat((results.accuracy / 100).toFixed(2)),
      accuracy: results.accuracy,
      perfect_grabs: results.hit,
      total_attempts: results.total,
      game_name: 'Finger Piano',
      notes: JSON.stringify({
        level,
        mode,
        score: results.score,
        notesHit: results.hit,
        wrongFinger: results.wrongFinger,
        missed: results.missed,
        accuracy: results.accuracy,
        // null in touch mode: a touchscreen cannot identify the finger used
        fingerIsolation: results.isolation,
        reactionTimeMs: results.reactionMs,
        interKeyIntervalMs: results.intervalMs,
        interKeyIntervalSd: results.intervalSd,
        rhythmConsistency: results.rhythm,
        tapQuality: results.tapQuality,
        ambiguousTaps: results.ambiguous,
        notesPerMinute: results.npm,
        hesitations: results.pauses,
        performanceScore: results.composite,
        isolationMeasured: results.cameraMetrics,
        perFinger: results.perFinger,
      }),
    }).then(() => {
      storeEndSession({
        duration: durationSeconds,
        accuracy: results.accuracy,
        perfectGrabs: results.hit,
      });
    }).catch((err) => console.error('[FingerPianoGame] Failed to save session:', err));
  }, [gamePhase, results, sessionId, level, mode, storeEndSession]);

  /* ═════════════════════════════════════════════════════════════════════════
     CONTROLS
     ═════════════════════════════════════════════════════════════════════════ */
  const startFromRules = useCallback(() => {
    sessionStorage.setItem(RULES_FLAG, '1');
    if (!synthRef.current) synthRef.current = new PianoSynth();
    if (soundEnabled) { soundManager.init(); synthRef.current.init(); soundManager.playClick(); }
    setGamePhase('countdown');
  }, [soundEnabled]);

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
      if (!next) { lastTsRef.current = 0; tapperRef.current?.reset(); }
      if (soundEnabled) soundManager.playClick();
      return next;
    });
  }, [gamePhase, soundEnabled]);

  const switchMode = useCallback(() => {
    setMode((m) => (m === 'camera' ? 'touch' : 'camera'));
    tipsRef.current = null;
    extRef.current = null;
    tapperRef.current?.reset();
    touchTapRef.current = null;
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
  const progressPct = clamp01(uiHit / cfg.notes) * 100;
  const stars = [0.4, 0.7, 0.95].map((t) => uiHit / cfg.notes >= t);

  return (
    <div className="fpp-page">
      <header className="fpp-header">
        <div className="fpp-header-left">
          <button className="fpp-icon-btn fpp-home-btn" onClick={goHome} title="Home" aria-label="Home">
            <Home size={20} />
          </button>
          <span className={`fpp-level-chip fpp-level-${level}`}>{cfg.emoji} {cfg.label}</span>
        </div>

        <div className="fpp-header-center">
          <div className="fpp-stat fpp-stat-score">
            <Star size={18} className="fpp-stat-ico" />
            <span className="fpp-stat-val">{uiScore}</span>
          </div>
          <div className="fpp-banner">Play the keys with the <strong>matching finger!</strong></div>
          <div className="fpp-stat">
            <Clock size={18} className="fpp-stat-ico" />
            <span className="fpp-stat-val">{fmtTime(uiElapsed)}</span>
          </div>
        </div>

        <div className="fpp-header-right">
          {/* End the round early and go straight to the report — the same
              control LetterQuest has. It runs the game's normal finish
              routine, so the report is built exactly as it is at the end of a
              full round, from whatever has been done so far. */}
          <EndGameControl
            className="fpp-icon-btn gs-end-btn"
            compact
            disabled={gamePhase !== 'playing'}
            onAskingChange={(asking) => { setEndAsking(asking); setIsPaused(asking); }}
            onConfirm={() => { setIsPaused(false); finishRef.current?.('ended'); }}
          />
          <button className="fpp-icon-btn" onClick={openHelp}
            title="How to play" aria-label="How to play">
            <HelpCircle size={20} />
          </button>
          <button className="fpp-icon-btn" onClick={switchMode}
            title={mode === 'camera' ? 'Switch to touch' : 'Switch to camera'}>
            {mode === 'camera' ? <Hand size={20} /> : <MousePointer2 size={20} />}
          </button>
          <button className="fpp-icon-btn"
            onClick={() => setSoundEnabled((s) => { soundManager.toggle?.(); return !s; })}
            title="Sound">
            {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
          <button className="fpp-icon-btn fpp-pause-btn" onClick={togglePause}
            disabled={gamePhase !== 'playing'} title="Pause">
            {isPaused ? <Play size={20} /> : <Pause size={20} />}
          </button>
        </div>
      </header>

      <main className="fpp-stage">
        {/* ── The piano itself, at the top of the page, in its cabinet ───────
            Each white key carries its OWN number, printed once and never
            changed — the way a learning piano is stickered. It used to be the
            finger's number, which changed with every note, so the same key
            said "2" then "5" then "1" and the number named nothing the child
            could learn. Which finger to use is now shown on the hand below. */}
        <div className="fpp-piano">
          <div className="fpp-piano-lid" aria-hidden="true" />
          <div
            className="fpp-keyboard"
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ touchAction: 'none' }}
          >
            {keys.white.map((k) => {
              const lit = litKey && litKey.keyIdx === k.i;
              const col = lit ? FINGER_BY_KEY[litKey.fingerKey].color : null;
              return (
                <div
                  key={k.name}
                  className={`fpp-key fpp-key-white ${lit ? 'fpp-key-lit' : ''}`}
                  ref={(el) => { keyRefs.current[k.i] = el; }}
                  style={{
                    left: `${(k.x / VW) * 100}%`,
                    width: `${(k.w / VW) * 100}%`,
                    ...(col ? { '--fc': col } : {}),
                  }}
                >
                  <span className="fpp-key-num">{k.i + 1}</span>
                  <span className="fpp-key-name">{k.name}</span>
                </div>
              );
            })}
            {keys.black.map((k) => (
              <div
                key={k.name}
                className="fpp-key fpp-key-black"
                style={{ left: `${(k.x / VW) * 100}%`, width: `${(k.w / VW) * 100}%` }}
              />
            ))}
          </div>
          <div className="fpp-piano-foot" aria-hidden="true" />
        </div>

        <div
          className="fpp-field"
          ref={fieldRef}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ touchAction: 'none' }}
        >
          {/* The ask, then the hand it points at. Both are IN FLOW, stacked and
              centred by .fpp-field, so they cannot land on top of each other at
              any window size — which is exactly what happened while the banner
              was absolutely positioned over the middle of the field. */}
          <AnimatePresence>
            {litKey && (
              <motion.div key={`${litKey.keyIdx}-${litKey.fingerKey}`} className="fpp-ask"
                style={{ '--fc': FINGER_BY_KEY[litKey.fingerKey].color }}
                initial={{ opacity: 0, y: 14, scale: 0.86 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 300, damping: 22 }}>
                <span className="fpp-ask-dot">{FINGER_BY_KEY[litKey.fingerKey].n}</span>
                <span className="fpp-ask-txt">
                  Tap your <strong>{FINGER_BY_KEY[litKey.fingerKey].label.toLowerCase()}</strong> in the air
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* the hand: the finger being asked for lights up on it */}
          <PianoHand
            ref={handCardRef}
            active={cfg.fingers}
            wanted={litKey ? litKey.fingerKey : null}
            label={litKey ? FINGER_BY_KEY[litKey.fingerKey].label.toLowerCase() : ''}
          />

          <canvas className="fpp-fx-canvas" ref={fxCanvasRef} />
          {mode === 'camera' && <canvas className="fpp-hand-canvas" ref={handCanvasRef} />}

          {/* The "Use these fingers" legend used to sit here. The hand card
              says the same thing better: the fingers this level uses are the
              ones drawn bright, and the one being asked for is the one lit. */}

          <AnimatePresence>
            {toast && (
              <motion.div className={`fpp-toast ${toast.kind}`}
                initial={{ opacity: 0, y: 12, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 320, damping: 22 }}>
                {toast.kind === 'ok' ? <Star size={18} /> : <AlertTriangle size={18} />}
                <span>{toast.text}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="fpp-cam-hidden">
            <video ref={videoRef} playsInline muted />
            <canvas ref={canvasRef} />
          </div>

          {mode === 'camera' && gamePhase === 'playing' && (
            <div className={`fpp-cam-status ${isTracking ? 'ok' : 'wait'}`}>
              {isSimulationMode ? 'Simulation mode'
                : isTracking ? 'Hand detected' : 'Show your hand ✋'}
            </div>
          )}

          {mode === 'touch' && gamePhase === 'playing' && (
            <div className="fpp-touch-note">
              <Info size={14} /> Finger isolation needs camera mode
            </div>
          )}

          <div className="fpp-levelcard">
            <div className="fpp-levelcard-title">Level {level}</div>
            <div className="fpp-levelcard-stars">
              {stars.map((on, i) => (
                <span key={i} className={on ? 'earned' : ''}>★</span>
              ))}
            </div>
            <div className="fpp-levelcard-bar">
              <div style={{ width: `${progressPct}%` }} />
            </div>
            <div className="fpp-levelcard-count">{uiHit}/{cfg.notes}</div>
          </div>
        </div>
      </main>

      {/* ═══ OVERLAYS ═══════════════════════════════════════════════════ */}
      <AnimatePresence>
        {gamePhase === 'rules' && (
          <RulesModal key="rules" cfg={cfg} mode={mode} onStart={startFromRules} />
        )}

        {/* Same modal, reopened on demand from the header's "?" button. */}
        {showHelp && gamePhase !== 'rules' && (
          <RulesModal key="help" cfg={cfg} mode={mode} onStart={closeHelp} resume />
        )}

        {gamePhase === 'countdown' && (
          <motion.div key="cd" className="fpp-overlay fpp-overlay-soft"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div key={countdown} className="fpp-countdown"
              initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 18 }}>
              {countdown}
            </motion.div>
            <p className="fpp-countdown-hint">Get your fingers ready…</p>
          </motion.div>
        )}

        {/* `!endAsking`: the end-game dialog pauses the round too, and without
            this the pause card rendered underneath it — two cards at once. */}
        {isPaused && !endAsking && gamePhase === 'playing' && (
          <motion.div key="pause" className="fpp-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="fpp-card fpp-pause-card"
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}>
              <div className="fpp-pause-ico"><Pause size={38} /></div>
              <h2>Paused</h2>
              <p>The music is waiting 🎹</p>
              <div className="fpp-actions">
                <button className="fpp-btn fpp-btn-primary" onClick={togglePause}>
                  <Play size={18} /> Resume
                </button>
                <button className="fpp-btn fpp-btn-ghost" onClick={restart}>
                  <RotateCcw size={18} /> Restart
                </button>
                <button className="fpp-btn fpp-btn-ghost" onClick={goHome}>
                  <Home size={18} /> Home
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {gamePhase === 'results' && results && (
          <motion.div key="res" className="fpp-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <motion.div className="fpp-card fpp-results-card"
              initial={{ scale: 0.86, y: 40, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 220, damping: 24 }}>
              <div className="fpp-confetti" aria-hidden="true">
                {Array.from({ length: 14 }).map((_, i) => (
                  <span key={i} style={{ '--i': i }} />
                ))}
              </div>

              <h2 className="fpp-results-title">
                <CheckCircle size={26} />{' '}
                {results.endedEarly ? 'Session ended' : 'Piece finished!'}
              </h2>
              <p className="fpp-results-sub">
                {cfg.emoji} {cfg.label} · {mode === 'camera' ? 'Camera' : 'Touch'}
              </p>

              {results.composite != null ? (
                <div className="fpp-perf-ring" style={{ '--pct': results.composite }}>
                  <div className="fpp-perf-inner">
                    <span className="fpp-perf-val">{results.composite}</span>
                    <span className="fpp-perf-lbl">OT Score</span>
                  </div>
                </div>
              ) : (
                <div className="tt-ot-none">
                  No OT score for this session — the round ended before a key
                  was played, so there is nothing to measure.
                </div>
              )}

              <div className="fpp-metrics">
                <Metric icon={<Star size={16} />} label="Score" value={results.score} />
                <Metric icon={<Target size={16} />} label="Accuracy" value={otPct(results.accuracy)} />
                <Metric icon={<Fingerprint size={16} />} label="Finger Isolation"
                  value={results.isolation == null ? 'n/a' : `${results.isolation}%`}
                  muted={results.isolation == null}
                  tip={results.isolation == null
                    ? 'A touchscreen reports a contact point, not which finger made it. This is left unmeasured rather than estimated. Play in camera mode to get it.'
                    : 'Share of the other fingers kept lifted at the moment of the press.'} />
                <Metric icon={<Zap size={16} />} label="Reaction Time"
                  value={results.reactionMs == null ? '—' : `${(results.reactionMs / 1000).toFixed(2)}s`} />
                <Metric icon={<Timer size={16} />} label="Inter-Key Interval"
                  value={results.intervalMs == null ? '—'
                    : `${(results.intervalMs / 1000).toFixed(2)}s ±${(results.intervalSd / 1000).toFixed(2)}`} />
                <Metric icon={<Activity size={16} />} label="Rhythm" value={otPct(results.rhythm)}
                  tip="One minus the coefficient of variation of the gaps between presses — how even the tempo was." />
                <Metric icon={<TrendingUp size={16} />} label="Tap Quality" value={otPct(results.tapQuality)}
                  tip="How decisive each tap was: how far the finger flexed and how fast. A crisp bend scores high, a vague wiggle low." />
                <Metric icon={<Gauge size={16} />} label="Speed" value={`${results.npm} /min`} />
                <Metric icon={<Pause size={16} />} label="Hesitations" value={results.pauses} />
                <Metric icon={<AlertTriangle size={16} />} label="Multi-finger" value={results.ambiguous}
                  tip="Taps where several fingers flexed together. Which one was meant is not observable, so these score nothing and are excluded from the per-finger figures." />
                <Metric icon={<CheckCircle size={16} />} label="Notes"
                  value={`${results.hit}/${results.total}`} />
              </div>

              {/* The per-finger table is the part a therapist actually reads:
                  a global score hides which finger is the problem. */}
              <div className="fpp-perfinger">
                <div className="fpp-perfinger-title">Per finger</div>
                <table>
                  <thead>
                    <tr>
                      <th>Finger</th><th>Notes</th><th>Accuracy</th>
                      <th>Reaction</th><th>Isolation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.perFinger.map((p) => (
                      <tr key={p.key}>
                        <td>
                          <span className="fpp-finger-dot" style={{ '--fc': p.color }}>{p.n}</span>
                          {p.label}
                        </td>
                        <td>{p.hit}/{p.asked}</td>
                        <td>{p.accuracy == null ? '—' : `${p.accuracy}%`}</td>
                        <td>{p.rtMs == null ? '—' : `${(p.rtMs / 1000).toFixed(2)}s`}</td>
                        <td className={p.isolation == null ? 'muted' : ''}>
                          {p.isolation == null ? 'n/a' : `${p.isolation}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!results.cameraMetrics && (
                <div className="fpp-note-box">
                  <AlertTriangle size={18} />
                  <span>
                    Played in touch mode: which finger was used cannot be observed,
                    so isolation is not reported and the score was computed without it.
                  </span>
                </div>
              )}

              <div className="fpp-actions">
                <button className="fpp-btn fpp-btn-primary" onClick={restart}>
                  <RotateCcw size={18} /> Play again
                </button>
                <button className="fpp-btn fpp-btn-ghost"
                  onClick={() => navigate('/play/finger-piano-difficulty')}>
                  Levels
                </button>
                <button className="fpp-btn fpp-btn-ghost" onClick={goHome}>
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

/* ── Metric cell ────────────────────────────────────────────────────────── */
function Metric({ icon, label, value, tip, muted }) {
  return (
    <div className={`fpp-metric ${muted ? 'muted' : ''}`}>
      <div className="fpp-metric-ico">{icon}</div>
      <div className="fpp-metric-body">
        <span className="fpp-metric-label">
          {label}
          {tip && (
            <span className="fpp-tip" tabIndex={0} role="note" aria-label={tip}>
              <Info size={11} />
              <span className="fpp-tip-bubble">{tip}</span>
            </span>
          )}
        </span>
        <span className="fpp-metric-value">{value}</span>
      </div>
    </div>
  );
}
