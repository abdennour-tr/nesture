/**
 * Finger Piano: fixed coloured keys, gentle air taps, and guided Easy stages.
 * Tap detection runs once per camera frame, independently for each hand.
 * Only successful notes advance the melody; no key has a time limit.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {Home, Pause, Play, RotateCcw, Clock, Star, Volume2, VolumeX, CheckCircle, Info, ArrowLeftRight} from 'lucide-react';
import useHandTracking from '../hooks/useHandTracking';
import { soundManager } from '../utils/soundManager';
import useSoundEnabled from '../hooks/useSoundEnabled';
import GameRules from '../components/game/GameRules';
import {otComposite, otRound, FINISH} from '../utils/otScore';
import { PIANO_LEVELS, PIANO_KEYS, buildPianoQueue } from './fingerPianoLevels';
import { makePianoTapDetector } from '../utils/pianoTapDetector';
import GameHUD from '../components/game/GameHUD';
import EndGameControl from '../components/game/EndGameControl';
import PianoHand from '../components/game/PianoHand';
import { useAuthStore, useSessionStore } from '../store';
import api from '../services/api';
import GameResults from '../components/game/GameResults';
import TouchModePose from '../components/game/TouchModePose';
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

const KEY_BY_ID = Object.fromEntries(PIANO_KEYS.map(k => [k.id, k]));
const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);
const LEVELS = PIANO_LEVELS;
const GOOD_AMPL_U = 0.32;
const GOOD_RATE_U = 3.0;
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
   RULES
   ═══════════════════════════════════════════════════════════════════════════ */
const RULES = [
  { icon: '🎹', text: 'Every key keeps the same number, colour and finger.' },
  { icon: '🖐️', text: 'Open your palm. The hand figure glows when the camera sees you.' },
  { icon: '👆', text: 'Gently bend the highlighted finger, then relax it open. No aiming needed.' },
  { icon: '🖱️', text: 'In Touch / Mouse mode, press the highlighted piano key.' },
  { icon: '🌱', text: 'Easy grows from 3 to 5 to 10 keys. Take your time — notes never expire.' },
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
  const [stageIndex, setStageIndex] = useState(0);
  const stage = cfg.stages[stageIndex];
  const activeKeyCount = stage.keys;
  const stageIndexRef = useRef(0);
  const difficultyName = level === 1 ? 'easy' : level === 2 ? 'medium' : 'hard';

  const [mode, setMode] = useState(
    (searchParams.get('mode') || 'camera').toLowerCase() === 'touch' ? 'touch' : 'camera'
  );
  /* Shared app-wide sound state — the icon always matches what you hear. */
  const [soundEnabled, setSoundEnabled] = useSoundEnabled();

  const [gamePhase, setGamePhase] = useState(() =>
    sessionStorage.getItem(RULES_FLAG) ? 'countdown' : 'rules'
  );
  const [isPaused, setIsPaused] = useState(false);
  /* Which physical hand feeds each on-screen side. Keys 1–5 are the LEFT hand
     (screen-left) and 6–10 the RIGHT hand (screen-right); with the default
     mapping each side reads its own tracked hand, so the real left hand plays
     1–5 and the real right hand plays 6–10. The correct value can still depend
     on an unusual camera / mirror setup, so it stays a remembered, one-click
     choice — the "Swap hands" button flips it if the sides ever feel reversed. */
  const [handInvert, setHandInvert] = useState(() => {
    try {
      const stored = localStorage.getItem('fingerpiano_hand_invert');
      return stored === null ? false : stored === '1';
    } catch { return false; }
  });
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
  const [keyFeedback, setKeyFeedback] = useState(null);
  const [results, setResults] = useState(null);
  const [handReady, setHandReady] = useState({ left: false, right: false });

  /* ── DOM refs ── */
  const videoRef   = useRef(null);
  const camCanvasRef = useRef(null);   // hand landmarks drawn by useHandTracking
  const fieldRef   = useRef(null);
  const fxCanvasRef = useRef(null);
  const rightHandRef = useRef(null);
  const leftHandRef = useRef(null);
  const feedbackTimerRef = useRef(null);
  const flashTimersRef = useRef(new Set());

  /* ── Loop state ── */
  const rafRef     = useRef(null);
  const lastTsRef  = useRef(0);
  const elapsedRef = useRef(0);
  const queueRef   = useRef([]);        // prompts still to show
  const targetRef  = useRef(null);      // { keyIdx, fingerKey, midi, shownAt }
  const restUntilRef = useRef(0);       // brief gap between prompts
  const doneRef    = useRef(0);         // successfully completed notes
  const fxRef      = useRef([]);
  const synthRef   = useRef(null);

  /* Each anatomical hand keeps its own calibration and last fresh frame. */
  const handsRef = useRef({});
  const cameraTapsRef = useRef([]);
  const touchTapRef = useRef(null);
  const ambiguousRef = useRef(0);
  const inputCountsRef = useRef({ camera: 0, touch: 0 });

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
  const trackingEnabled = mode === 'camera' && ['countdown', 'playing', 'stage'].includes(gamePhase);

  const { multiHandData, error: cameraError, releaseCamera } = useHandTracking(
    videoRef, camCanvasRef, trackingEnabled, isPaused || gamePhase === 'stage', 2
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

  const keys = useMemo(() => {
    const visible = PIANO_KEYS.slice(0, activeKeyCount);
    const width = VW / visible.length;
    return { white: visible.map(k => ({ ...k, x: k.i * width, w: width, cx: (k.i + 0.5) * width })) };
  }, [activeKeyCount]);
  const buildQueue = useCallback(() => buildPianoQueue(cfg), [cfg]);

  useEffect(() => {
    if (!isPlaying || mode !== 'camera') {
      cameraTapsRef.current = [];
      touchTapRef.current = null;
      handsRef.current = {};
      rightHandRef.current?.clear();
      leftHandRef.current?.clear();
      setHandReady({ left: false, right: false });
    }
  }, [isPlaying, mode]);

  // Process fresh camera frames, not repeated animation frames of old landmarks.
  useEffect(() => {
    if (mode !== 'camera' || !isPlaying) return;
    const now = performance.now();
    for (const hand of ['right', 'left']) {
      /* `hand` is the on-screen side (and the side of the keys, the hand visual
         and the ready state). Which physical hand the shared tracking hook puts
         in each slot depends on the camera / mirror setup, and there are only
         two possibilities — so a single "Swap hands" toggle (persisted) lets the
         child land on the one where the on-screen LEFT hand is their real left
         hand and the RIGHT is their real right. When `handInvert` is on we read
         the opposite slot. The shared hook is left untouched (the other games
         and the reflex engine also rely on it). */
      const dataHand = handInvert ? (hand === 'right' ? 'left' : 'right') : hand;
      const landmarks = multiHandData?.[dataHand];
      const visual = hand === 'right' ? rightHandRef.current : leftHandRef.current;
      let track = handsRef.current[hand];
      if (!landmarks?.[0]) continue;
      const wrist = landmarks[0];
      const changedHand = track?.wrist && Math.hypot(wrist.x - track.wrist.x, wrist.y - track.wrist.y) > 0.24;
      if (!track || now - track.lastSeen > 300 || changedHand) {
        track = { detector: makePianoTapDetector(), since: now, lastSeen: now, detected: false };
        handsRef.current[hand] = track;
        cameraTapsRef.current = [];
      }
      const reading = track.detector.update(landmarks, now);
      track.lastSeen = now; track.wrist = wrist;
      track.detected = now - track.since >= 180 && landmarks.length === 21 &&
        landmarks.every(point => Number.isFinite(point.x) && Number.isFinite(point.y));
      visual?.setFlex(reading.flex);
      visual?.setDetected(track.detected);
      if (reading.tap && track.detected && targetRef.current) {
        const key = PIANO_KEYS.find(k => k.hand === hand && k.fingerKey === reading.tap.finger);
        if (key && key.i < activeKeyCount) {
          cameraTapsRef.current.push({ at: now, id: key.id, tap: reading.tap });
        }
      }
    }
  }, [multiHandData, isPlaying, mode, activeKeyCount, handInvert]);

  const queueTouchKey = useCallback((keyIdx) => {
    if (mode !== 'touch' || !isPlaying || !targetRef.current) return;
    touchTapRef.current = { keyIdx, at: performance.now() };
  }, [mode, isPlaying]);

  useEffect(() => () => {
    clearTimeout(feedbackTimerRef.current);
    flashTimersRef.current.forEach(clearTimeout);
    const context = synthRef.current?.ctx;
    if (context && context.state !== 'closed') context.close().catch(() => {});
  }, []);
  const showFeedback = useCallback((text, kind = 'ok') => {
    clearTimeout(feedbackTimerRef.current);
    setToast({ text, kind });
    feedbackTimerRef.current = setTimeout(() => setToast(null), 1200);
  }, []);

  /* ═════════════════════════════════════════════════════════════════════════
     SCORING A STRIKE
     ═════════════════════════════════════════════════════════════════════════ */
  const flashKey = useCallback((keyIdx, cls) => {
    const feedback = { keyIdx, cls };
    setKeyFeedback(feedback);
    const timer = setTimeout(() => {
      setKeyFeedback(current => current === feedback ? null : current);
      flashTimersRef.current.delete(timer);
    }, 320);
    flashTimersRef.current.add(timer);
  }, []);

  /** Stage changes wait for the learner's Continue action. */
  const nextTarget = useCallback((ts) => {
    const next = queueRef.current[0];
    if (!next) { targetRef.current = null; setLitKey(null); return; }
    if (next.stageIndex !== stageIndexRef.current) {
      stageIndexRef.current = next.stageIndex;
      setStageIndex(next.stageIndex);
      setGamePhase('stage');
      setUiHit(hitRef.current);
      setToast(null);
      return;
    }
    const spec = queueRef.current.shift();
    targetRef.current = { ...spec, shownAt: ts };
    setLitKey(spec);
  }, []);

  /**
   * Resolve the lit key against a tap.
   * Touch identifies only a key; isolation and physical finger metrics stay null.
   * Ambiguous camera movements do not resolve or skip the current note.
   */
  const resolveTap = useCallback((ts, keyId, isolation, tap) => {
    const target = targetRef.current;
    if (!target) return;
    const key = KEY_BY_ID[target.id];
    if (tap?.ambiguous) {
      ambiguousRef.current++;
      showFeedback('Relax your hand, then gently bend one finger.', 'warn');
      return;
    }
    const pf = perFingerRef.current[key.id] ||
      (perFingerRef.current[key.id] = { asked: 0, hit: 0, rt: [], iso: [] });
    pf.asked++;
    if (keyId !== target.id) {
      wrongFingerRef.current++;
      const pressed = KEY_BY_ID[keyId];
      if (pressed) flashKey(pressed.i, 'fpp-key-wrong');
      showFeedback(mode === 'camera' ? 'Try your ' + key.label.toLowerCase() + '.' : 'Try key ' + key.n + '.', 'warn');
      // Keep the same target available until it is played successfully.
      return;
    }
    pf.hit++;
    hitRef.current++;
    doneRef.current++;
    inputCountsRef.current[mode]++;
    const reaction = ts - target.shownAt;
    pf.rt.push(reaction);
    reactionsRef.current.push(reaction);
    if (isolation != null) { isolationsRef.current.push(isolation); pf.iso.push(isolation); }
    if (tap) { amplitudesRef.current.push(tap.amplitude); ratesRef.current.push(tap.rate); }
    const crisp = tap ? clamp01(tap.amplitude / GOOD_AMPL_U) * clamp01(tap.rate / GOOD_RATE_U) : 0.6;
    scoreRef.current += 10 + Math.round(5 * crisp);
    if (soundEnabled) synthRef.current?.play(midiToFreq(key.midi), 0.7 + 0.3 * crisp);
    flashKey(key.i, 'fpp-key-hit');
    const keyWidth = VW / cfg.stages[stageIndexRef.current].keys;
    fxRef.current.push({ x: (key.i + 0.5) * keyWidth, y: FX_Y, t0: ts, color: key.color, weak: false });
    showFeedback('Nice note! · ' + key.n);
    if (lastHitAtRef.current != null) {
      const gap = ts - lastHitAtRef.current;
      intervalsRef.current.push(gap);
      if (gap > PAUSE_MS) pausesRef.current++;
    }
    lastHitAtRef.current = ts;
    setUiScore(Math.round(scoreRef.current));
    setUiHit(hitRef.current);
    targetRef.current = null;
    setLitKey(null);
    cameraTapsRef.current = [];
    restUntilRef.current = ts + cfg.restMs;
  }, [cfg, mode, soundEnabled, flashKey, showFeedback]);

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

    const cameraMetrics = isolationsRef.current.length > 0;
    const isolation = cameraMetrics ? mean(isolationsRef.current) * 100 : null;

    /* Touch mode cannot observe isolation, and an unplayed round cannot observe
       anything: otComposite() renormalises over whatever WAS measured rather
       than filling the gaps with invented values. */
    const composite = cameraMetrics
      ? otComposite([[accuracy, 0.28], [isolation, 0.25], [tapQuality, 0.15],
                     [rhythm, 0.14], [reactionScore, 0.12], [speedScore, 0.06]])
      : otComposite([[accuracy, 0.46], [rhythm, 0.23],
                     [reactionScore, 0.20], [speedScore, 0.11]]);

    const perFinger = PIANO_KEYS
      .filter((f) => perFingerRef.current[f.id]?.asked > 0)
      .map((f) => {
        const p = perFingerRef.current[f.id] || { asked: 0, hit: 0, rt: [], iso: [] };
        return {
          key: f.id, label: f.label, n: f.n, color: f.color,
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
      inputCounts: { ...inputCountsRef.current },
      stagesCompleted: cfg.stages.filter((_, i) => i < stageIndexRef.current).length + (doneRef.current === cfg.notes ? 1 : 0),
      perFinger,
    });
    setGamePhase('results');
    if (soundEnabled) soundManager.playCelebration();
  }, [cfg, soundEnabled]);

  const finishRef = useRef(finishGame);
  useEffect(() => { finishRef.current = finishGame; }, [finishGame]);

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

  /* The logical session clock stops during pauses, stage introductions and
     missing camera frames. Notes never expire and old poses never fire again. */
  useEffect(() => {
    if (!isPlaying) return;
    lastTsRef.current = 0;
    let lastUi = 0;
    const step = now => {
      const dt = lastTsRef.current ? Math.min(80, now - lastTsRef.current) : 0;
      lastTsRef.current = now;
      const ready = {};
      for (const hand of ['right', 'left']) {
        const track = handsRef.current[hand];
        ready[hand] = !!track?.detected && now - track.lastSeen < 300;
        if (!ready[hand]) (hand === 'right' ? rightHandRef.current : leftHandRef.current)?.clear();
      }
      // Single-hand stages (≤5 keys) use keys 1–5 = the LEFT hand; both-hand
      // stages also need the right.
      const cameraReady = ready.left && (activeKeyCount <= 5 || ready.right);
      const waitingBetweenNotes = !targetRef.current && doneRef.current > 0;
      if (mode === 'touch' || cameraReady || waitingBetweenNotes) elapsedRef.current += dt;
      const ts = elapsedRef.current;
      if (!targetRef.current && ts >= restUntilRef.current && queueRef.current.length) {
        const upcoming = queueRef.current[0];
        const changingStage = upcoming.stageIndex !== stageIndexRef.current;
        nextTarget(ts);
        if (changingStage) return;
      }
      if (mode === 'camera' && cameraReady) {
        const pending = cameraTapsRef.current;
        if (pending.length && now - pending[0].at >= 50) {
          cameraTapsRef.current = [];
          const fresh = pending.filter(event => now - event.at < 300);
          if (fresh.length && targetRef.current) {
            const event = fresh[0];
            const tap = { ...event.tap, ambiguous: event.tap.ambiguous || fresh.length > 1 };
            resolveTap(ts, event.id, tap.isolation, tap);
          }
        }
      } else {
        cameraTapsRef.current = [];
      }
      if (mode === 'touch' && touchTapRef.current) {
        const touch = touchTapRef.current;
        touchTapRef.current = null;
        if (targetRef.current && now - touch.at < 300) {
          // Touch identifies a key, never the physical finger used.
          resolveTap(ts, PIANO_KEYS[touch.keyIdx]?.id, null, null);
        }
      }
      drawFx(ts);
      if (now - lastUi > 160) {
        lastUi = now;
        setHandReady(previous => previous.right === ready.right && previous.left === ready.left ? previous : ready);
        setUiElapsed(ts / 1000);
      }
      if (!queueRef.current.length && !targetRef.current && doneRef.current >= cfg.notes && ts >= restUntilRef.current) {
        finishRef.current();
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, activeKeyCount, cfg.notes, mode, nextTarget, resolveTap, drawFx]);

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
    handsRef.current = {};
    cameraTapsRef.current = [];
    inputCountsRef.current = { camera: 0, touch: 0 };
    stageIndexRef.current = 0;
    setStageIndex(0);
    setToast(null);
    setKeyFeedback(null);
    clearTimeout(feedbackTimerRef.current);
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
    /* soundManager is a singleton SHARED with the other games. This game's sound
       button only flipped local state before, so a mute left on in another game
       silenced Finger Piano's effects with no way to turn them back on here.
       Keep the singleton in sync with this game's toggle (and resume the audio
       context when enabling) so the button always works and the game is not
       silent on entry. */
    /* `soundEnabled` now IS the shared flag (useSoundEnabled), so there is
       nothing to copy back — only resume the audio context when it is on. */
    if (soundEnabled) soundManager.init();
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
      accuracy_score: results.accuracy == null ? null : parseFloat((results.accuracy / 100).toFixed(2)),
      accuracy: results.accuracy,
      perfect_grabs: results.hit,
      total_attempts: results.hit + results.wrongFinger,
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
        inputCounts: results.inputCounts,
        stagesCompleted: results.stagesCompleted,
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
      if (!next) lastTsRef.current = 0;
      if (soundEnabled) soundManager.playClick();
      return next;
    });
  }, [gamePhase, soundEnabled]);

  const switchMode = useCallback(() => {
    setMode((m) => (m === 'camera' ? 'touch' : 'camera'));
    handsRef.current = {};
    cameraTapsRef.current = [];
    lastHitAtRef.current = null;
    touchTapRef.current = null;
    if (soundEnabled) soundManager.playClick();
  }, [soundEnabled]);

  /* Flip which physical hand drives each on-screen side, and remember it. The
     current tracks are dropped so both hands re-acquire under the new mapping
     rather than jumping. */
  const toggleHandInvert = useCallback(() => {
    setHandInvert((v) => {
      const next = !v;
      try { localStorage.setItem('fingerpiano_hand_invert', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
    handsRef.current = {};
    cameraTapsRef.current = [];
    rightHandRef.current?.clear();
    leftHandRef.current?.clear();
    setHandReady({ left: false, right: false });
    if (soundEnabled) soundManager.playClick();
  }, [soundEnabled]);

  const restart = useCallback(() => {
    sessionSavedRef.current = false;
    setSessionId(null);
    setResults(null);
    setIsPaused(false);
    setStageIndex(0);
    stageIndexRef.current = 0;
    setShowHelp(false);
    setGamePhase('countdown');
  }, []);

  const goHome = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    navigate('/play');
  }, [navigate]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') goHome();
      if (e.target.closest?.('button, input, textarea, select, [contenteditable="true"]')) return;
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
  const stageStart = cfg.stages.slice(0, stageIndex).reduce((total, item) => total + item.notes, 0);
  const stageHits = Math.max(0, uiHit - stageStart);
  const cameraReady = handReady.left && (activeKeyCount <= 5 || handReady.right);
  const handMessage = cameraError
    ? 'Camera unavailable. Check camera access, or use Touch / Mouse.'
    : cameraReady ? (activeKeyCount > 5 ? 'Both hands detected' : 'Left hand detected')
      : activeKeyCount > 5 ? 'Open both hands in front of the camera' : 'Open your left hand in front of the camera';

  return (
    <div className="fpp-page">
      <header className="fp-toolbar">
        <GameHUD
          title="🎹 Finger Piano"
          level={difficultyName}
          stats={[
            { icon: <Star size={16} />, label: 'Score', value: uiScore },
            { icon: <Clock size={16} />, label: 'Playing time', value: fmtTime(uiElapsed) },
          ]}
          mode={mode}
          onModeChange={switchMode}
          onHelp={openHelp}
          paused={isPaused}
          onTogglePause={gamePhase === 'playing' ? togglePause : undefined}
          onExit={goHome}
          extraActions={<>
            {mode === 'camera' && (
              <button className="gs-action gs-action--icon" onClick={toggleHandInvert}
                aria-label="Swap which hand controls each side"
                title="Swap hands — use if your left/right hands feel reversed on screen">
                <ArrowLeftRight size={18} />
              </button>
            )}
            <button className="gs-action gs-action--icon" onClick={() => setSoundEnabled(value => !value)}
              aria-label={soundEnabled ? 'Mute sound' : 'Enable sound'} title={soundEnabled ? 'Mute sound' : 'Enable sound'}>
              {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <EndGameControl className="gs-action gs-action--icon gs-end-btn" compact
              disabled={gamePhase !== 'playing'}
              onAskingChange={asking => { setEndAsking(asking); setIsPaused(asking); }}
              onConfirm={() => { setIsPaused(false); finishRef.current?.(FINISH.ENDED); }} />
          </>}
        />
      </header>
      <main className="fpp-stage">
        <div className="fp-session-heading">
          <div><span className="fp-eyebrow">{cfg.label} · {activeKeyCount} keys</span><h1>{stage.title}</h1></div>
          {cfg.stages.length > 1 ? (
            <ol className="fp-stage-track" aria-label="Easy progression">
              {cfg.stages.map((item, index) => (
                <li key={item.id} className={index === stageIndex ? 'is-current' : index < stageIndex ? 'is-complete' : ''}
                  aria-current={index === stageIndex ? 'step' : undefined}>
                  <span>{index < stageIndex ? '✓' : item.id}</span>
                  <div>{item.keys} keys<small>{item.keys === 10 ? 'Both hands' : 'Left hand'}</small></div>
                </li>
              ))}
            </ol>
          ) : <span className="fp-self-paced">At your own pace</span>}
        </div>
        <div className={'fpp-piano' + (activeKeyCount > 5 ? ' fp-piano-two-hands' : '')}>
          <div className="fpp-piano-lid" aria-hidden="true" />
          <div className="fpp-keyboard" role="group" aria-label="Piano keys"
            style={{ '--key-count': activeKeyCount }}>
            {keys.white.map(k => {
              const lit = litKey?.keyIdx === k.i;
              return (
                <button key={k.id} type="button"
                  className={'fpp-key fpp-key-white' + (lit ? ' fpp-key-lit' : '') +
                    (k.i === 5 ? ' fp-second-hand' : '') +
                    (keyFeedback?.keyIdx === k.i ? ' ' + keyFeedback.cls : '')}
                  style={{ '--fc': k.color }}
                  disabled={mode !== 'touch' || !isPlaying}
                  aria-label={'Key ' + k.n + ', ' + k.label + ', ' + k.name + (lit ? ', play this key' : '')}
                  aria-current={lit ? 'true' : undefined}
                  onPointerDown={e => {
                    if (e.isPrimary && e.button === 0) { e.preventDefault(); queueTouchKey(k.i); }
                  }}
                  onClick={e => { if (e.detail === 0) queueTouchKey(k.i); }}>
                  <span className="fp-key-hand">{k.hand === 'right' ? 'R' : 'L'}</span>
                  <span className="fp-key-cue" aria-hidden="true">{lit ? 'PLAY' : ''}</span>
                  <span className="fpp-key-num">{k.n}</span>
                  <span className="fp-key-finger">{k.fingerLabel}</span>
                  <span className="fpp-key-name">{k.name}</span>
                  <span className="fp-key-hit-mark" aria-hidden="true">✓</span>
                </button>
              );
            })}
          </div>
          <div className="fpp-piano-foot" aria-hidden="true" />
        </div>

        <div className="fpp-field" ref={fieldRef}>
          <div className="fp-prompt" aria-live="polite" aria-atomic="true">
            {litKey ? <>
              <span className="fp-prompt-number" style={{ background: litKey.color }}>{litKey.n}</span>
              <span>{mode === 'camera' ? <>Gently bend your <strong>{litKey.label.toLowerCase()}</strong></>
                : <>Press <strong>key {litKey.n}</strong></>}</span>
            </> : <span>{gamePhase === 'playing' ? 'Relax your fingers — the next note is coming.' : 'One finger. One colour. One note.'}</span>}
          </div>
          <div className={'fp-hands' + (activeKeyCount > 5 ? ' fp-hands-both' : '')}>
            {/* Left hand (keys 1–5) is always shown and sits on the left; the
                right hand (keys 6–10) joins only in the two-hand stages, on the
                right — so each panel is on the same side as its keys. */}
            <PianoHand ref={leftHandRef} hand="left" keyCount={activeKeyCount} mode={mode}
              detected={handReady.left} wanted={litKey?.id} />
            {activeKeyCount > 5 && <PianoHand ref={rightHandRef} hand="right"
              keyCount={activeKeyCount} mode={mode} detected={handReady.right} wanted={litKey?.id} />}
          </div>
          <canvas className="fpp-fx-canvas" ref={fxCanvasRef} aria-hidden="true" />
          <div className="fp-feedback" role="status" aria-live="polite">
            {toast && <span className={'fp-feedback-message ' + toast.kind}>
              {toast.kind === 'ok' ? <CheckCircle size={16} /> : <Info size={16} />}{toast.text}
            </span>}
          </div>
          {/* Styled camera + hand-landmarks preview, top-left of the field —
              like LetterQuest, but a compact picture-in-picture. The video and
              the landmark canvas are mirrored together (selfie view) so the
              overlaid dots line up with the live image. */}
          {mode === 'camera' ? (
            <div className="fp-cam-widget">
              {cameraError ? (
                <div className="fp-cam-fallback"><span aria-hidden="true">📷</span>Caméra indisponible</div>
              ) : (
                <>
                  <video ref={videoRef} className="fp-cam-video" playsInline muted autoPlay />
                  <canvas ref={camCanvasRef} width={640} height={360} className="fp-cam-canvas" aria-hidden="true" />
                  <div className={'fp-cam-badge' + (cameraReady ? ' is-live' : '')}>
                    <span className="fp-cam-dot" aria-hidden="true" />{cameraReady ? 'LIVE' : 'Recherche…'}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="fpp-cam-hidden" aria-hidden="true"><video ref={videoRef} playsInline muted /></div>
          )}
          <div className={'fp-tracking-status' + (cameraReady ? ' is-ready' : '')} role="status">
            {mode === 'camera' ? <>
              <span className="fp-status-light" aria-hidden="true" />{handMessage}
              {cameraError && <button type="button" onClick={switchMode}>Use Touch / Mouse</button>}
            </> : <><Info size={14} /> Tap the lit key. The hand is your finger guide.</>}
          </div>
        </div>
        <div className="fp-session-progress">
          <span>{cfg.stages.length > 1 ? 'Stage ' + stage.id + ' · ' : ''}{Math.min(stageHits, stage.notes)} / {stage.notes} notes</span>
          <div role="progressbar" aria-label="Melody progress" aria-valuemin={0} aria-valuemax={cfg.notes} aria-valuenow={uiHit}
            className="fp-progress-track"><div style={{ width: progressPct + '%' }} /></div>
          <span>{uiHit} / {cfg.notes}</span>
        </div>
      </main>

      {/* Touch-mode upper-body observation. Nothing starts until the child is
          asked; the webcam is released the moment the round ends. Renders its
          own hidden <video> and consent overlay — see TouchModePose. */}
      <TouchModePose
        gameId="finger-piano"
        active={mode === 'touch' && ['countdown', 'playing', 'stage'].includes(gamePhase)}
        finished={gamePhase === 'results'}
        sessionId={sessionId}
        childId={profile?.learner_id || user?.id || null}
        learnerName={profile?.first_name}
      />

      {/* ═══ OVERLAYS ═══════════════════════════════════════════════════ */}
      <AnimatePresence>
        {gamePhase === 'rules' && (
          <RulesModal key="rules" cfg={cfg} mode={mode} onStart={startFromRules} />
        )}

        {/* Same modal, reopened on demand from the header's "?" button. */}
        {showHelp && gamePhase !== 'rules' && (
          <RulesModal key="help" cfg={cfg} mode={mode} onStart={closeHelp} resume />
        )}

        {gamePhase === 'stage' && (
          <motion.div key="stage" className="fpp-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <section className="fpp-card fp-stage-card" role="dialog" aria-modal="true" aria-labelledby="fp-stage-title">
              <div className="fp-stage-success"><CheckCircle size={28} /></div>
              <span className="fp-eyebrow">Stage {stage.id - 1} complete</span>
              <h2 id="fp-stage-title">{stage.title}</h2>
              <p>{stage.hint}</p>
              <div className="fp-unlock-keys" aria-label={stage.keys + ' keys now available'}>
                {PIANO_KEYS.slice(0, stage.keys).map(k => <span key={k.id} style={{ '--fc': k.color }}>{k.n}</span>)}
              </div>
              <p className="fp-stage-reassurance">The keys you know keep their numbers and colours.</p>
              <button type="button" autoFocus className="fpp-btn fpp-btn-primary" onClick={() => {
                lastTsRef.current = 0;
                lastHitAtRef.current = null;
                touchTapRef.current = null;
                cameraTapsRef.current = [];
                setGamePhase('playing');
              }}>Continue with {stage.keys} keys <Play size={17} /></button>
            </section>
          </motion.div>
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
        {isPaused && !endAsking && !showHelp && gamePhase === 'playing' && (
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
          <motion.div key="res" className="fpp-overlay fpp-overlay-report"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {/* Shared platform report — see components/game/GameResults.jsx.
                The camera-only sub-scores (finger isolation, tap quality) drop
                out of the breakdown on a touch round, exactly as they drop out
                of the composite. */}
            <GameResults
              gameId="finger-piano"
              emoji={results.endedEarly ? '💪' : '🎹'}
              title={results.endedEarly ? 'Session ended' : 'Piece finished!'}
              subtitle={`${cfg.emoji} ${cfg.label} · ${
                results.inputCounts.camera && results.inputCounts.touch ? 'Camera + Touch'
                  : results.inputCounts.camera ? 'Camera' : 'Touch'}`}
              endedEarly={results.endedEarly}
              headline={{ value: results.composite, caption: 'OT Score' }}
              breakdown={(results.cameraMetrics
                ? [
                    { label: 'Note accuracy',   value: results.accuracy,   weight: '28%' },
                    { label: 'Finger isolation',value: results.isolation,  weight: '25%' },
                    { label: 'Tap quality',     value: results.tapQuality, weight: '15%' },
                    { label: 'Rhythm',          value: results.rhythm,     weight: '14%' },
                  ]
                : [
                    { label: 'Note accuracy', value: results.accuracy, weight: '46%' },
                    { label: 'Rhythm',        value: results.rhythm,   weight: '23%' },
                  ])}
              metrics={[
                { icon: '🏆', label: 'Score', value: results.score },
                { icon: '🎯', label: 'Notes hit', value: `${results.hit}/${results.total}` },
                { icon: '⚡', label: 'Reaction', value: results.reactionMs == null ? '—' : `${(results.reactionMs / 1000).toFixed(2)}s` },
                { icon: '🎵', label: 'Notes / min', value: results.npm ?? '—' },
                { icon: '〰️', label: 'Timing spread', value: results.intervalSd == null ? '—' : `${results.intervalSd} ms` },
                { icon: '⏸️', label: 'Pauses', value: results.pauses },
              ]}
              onPlayAgain={restart}
              onExit={goHome}
              exitLabel="Home"
              actionsExtra={(
                <button type="button" className="gr-btn gr-btn-secondary"
                  onClick={() => navigate('/play/finger-piano-difficulty')}>
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

