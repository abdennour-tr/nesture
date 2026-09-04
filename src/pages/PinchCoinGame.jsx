/**
 * PinchCoinGame.jsx
 * "Pinch the Coin" — occupational-therapy pincer-grasp game.
 *
 * Three-step cycle, made explicit in the HUD:
 *   1. PINCH   — close thumb (landmark 4) and index (landmark 8) on the coin
 *   2. MOVE    — carry it, keeping the pinch closed, to the piggy bank
 *   3. RELEASE — open the fingers over the slot to drop it in
 *
 * A NOTE ON "PINCH STRENGTH".
 * The spec asks for pinch strength, but a camera measures no force whatsoever —
 * MediaPipe returns positions, not pressure. Reporting a "strength" derived
 * from landmarks would be a fabricated number, and in a clinical tool that is
 * worse than reporting nothing. What the camera can honestly measure is how
 * steadily the grip is *held*: the share of carry frames where the aperture
 * stays below the pinch threshold, and how little that aperture wobbles. That
 * is what this game computes and it is labelled "Pinch Stability" everywhere in
 * the UI, with a tooltip saying it is consistency of grip, not force.
 *
 * Performance contract: the loop runs on refs + rAF and writes transforms
 * directly. React state is touched only for phase/step changes and a throttled
 * 5 Hz readout, so there is no per-frame re-render.
 *
 * Route (unchanged): /play/pinch-coin-game?level=1|2|3&mode=camera|touch
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home, Pause, Play, RotateCcw, Clock, Hand, MousePointer2,
  Volume2, VolumeX, Target, Activity, Zap, TrendingUp, CheckCircle,
  Gauge, Move, Crosshair, Info,
} from 'lucide-react';
import useHandTracking from '../hooks/useHandTracking';
import { soundManager } from '../utils/soundManager';
import { useAuthStore, useSessionStore } from '../store';
import api from '../services/api';
import '../styles/PinchCoinGame.css';

/* ═══════════════════════════════════════════════════════════════════════════
   GEOMETRY — fixed virtual space scaled to the field, so tuning is identical
   on every screen size.
   ═══════════════════════════════════════════════════════════════════════════ */
const VW = 1000;
const VH = 560;
const TABLE_Y   = 430;   // top of the wooden surface in the backdrop
const SLOT_X    = 700;   // the coin slot — the real release target
const SLOT_Y    = 260;

/* ── Difficulty (level ids stay numeric: the difficulty page sends 1|2|3) ── */
const LEVELS = {
  1: {
    id: 1, label: 'Easy', emoji: '🌱', color: '#38A169',
    pinchOn: 0.095, coinR: 46, coinsToCollect: 5,
    slotRadius: 165, starThresholds: [1, 3, 5],
  },
  2: {
    id: 2, label: 'Medium', emoji: '⚡', color: '#DD6B20',
    pinchOn: 0.072, coinR: 37, coinsToCollect: 10,
    slotRadius: 130, starThresholds: [3, 6, 10],
  },
  3: {
    id: 3, label: 'Hard', emoji: '🔥', color: '#E53E3E',
    pinchOn: 0.055, coinR: 29, coinsToCollect: 15,
    slotRadius: 100, starThresholds: [5, 10, 15],
  },
};

/* ── Tracking / scoring constants ───────────────────────────────────────── */
const EMA_ALPHA        = 0.45;   // landmark smoothing
const PINCH_MARGIN     = 0.03;   // hysteresis: open threshold = pinchOn + this
/* A single noisy frame above the threshold must never drop the coin — the hand
   model jitters, and a child who is holding steadily would be punished for the
   tracker's noise. Three consecutive open frames are required. */
const RELEASE_FRAMES   = 3;
const GRAB_PAD         = 26;     // px of slack around the coin when grabbing
const COIN_LERP        = 0.55;   // how tightly the coin follows the pinch point
const GRAVITY          = 2100;   // px/s² for a dropped coin
const BOUNCE           = 0.42;
const PAUSE_SPEED      = 30;     // px/s under which the carry counts as paused
const PAUSE_MIN_MS     = 350;
const REF_DRAG_SPEED   = 420;    // px/s — a brisk, controlled transport
/* On a successful drop the coin is drawn INTO the slot rather than vanishing:
   it arcs to the slot, shrinks and spins as it goes in. The next coin only
   appears once the animation is done, so the child sees cause and effect. */
const SWALLOW_MS       = 520;
const CELEBRATE_MS     = 900;
const COUNTDOWN_SECONDS = 3;
const RULES_FLAG       = 'pinchcoin_rules_seen';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const fmtTime = (s) => {
  const m = Math.floor(Math.max(0, s) / 60);
  const r = Math.floor(Math.max(0, s) % 60);
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
};

const STEPS = [
  { n: 1, key: 'pinch',   label: 'Pinch' },
  { n: 2, key: 'move',    label: 'Move' },
  { n: 3, key: 'release', label: 'Release' },
];
const STEP_HINT = {
  pinch:   'Pinch (thumb + index) to pick up the coin',
  move:    'Move it to the piggy bank…',
  release: 'Open your fingers to drop it in!',
};

/* ═══════════════════════════════════════════════════════════════════════════
   COIN — CSS/SVG, thick 3D rim, engraved star, specular sweep
   ═══════════════════════════════════════════════════════════════════════════ */
const Coin = React.forwardRef(function Coin(_props, ref) {
  return (
    <div className="pcg-coin" ref={ref} aria-hidden="true">
      <div className="pcg-coin-glow" />
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <defs>
          <radialGradient id="pcgFace" cx="36%" cy="30%" r="72%">
            <stop offset="0%"   stopColor="#FFF3B0" />
            <stop offset="45%"  stopColor="#FCD34D" />
            <stop offset="100%" stopColor="#D9920B" />
          </radialGradient>
          <linearGradient id="pcgRim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#F5B60E" />
            <stop offset="100%" stopColor="#A66A05" />
          </linearGradient>
        </defs>
        {/* thick edge */}
        <ellipse cx="50" cy="56" rx="45" ry="44" fill="url(#pcgRim)" />
        {/* face */}
        <circle cx="50" cy="50" r="45" fill="url(#pcgFace)" />
        <circle cx="50" cy="50" r="45" fill="none" stroke="#B8790A" strokeWidth="2.5" />
        <circle cx="50" cy="50" r="36" fill="none" stroke="#C98A08" strokeWidth="2.2" opacity=".75" />
        {/* engraved star */}
        <path
          className="pcg-coin-star"
          d="M50 26 L57.6 42.4 L75.5 44.6 L62.4 56.9 L65.9 74.6 L50 65.8 L34.1 74.6 L37.6 56.9 L24.5 44.6 L42.4 42.4 Z"
          fill="#FDE68A" stroke="#B8790A" strokeWidth="2" strokeLinejoin="round"
        />
        {/* specular sweep */}
        <ellipse className="pcg-coin-shine" cx="36" cy="32" rx="15" ry="9"
          fill="#FFFFFF" opacity=".55" transform="rotate(-34 36 32)" />
      </svg>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   PIGGY BANK — the slot is the true target for Release Accuracy
   ═══════════════════════════════════════════════════════════════════════════ */
function PiggyBank() {
  return (
    <div className="pcg-piggy" aria-hidden="true">
      {/* viewBox anchors are load-bearing: the slot sits at y=-88 and the feet
          at y=+88, which is what the CSS placement maths uses to line the slot
          up with SLOT_X/SLOT_Y. Move either and the drop target drifts off the
          hole the coin is scored against. */}
      <svg viewBox="-150 -170 300 280" width="100%" height="100%">
        <defs>
          {/* Ceramic body: light from upper-left, deep falloff bottom-right. */}
          <radialGradient id="pcgBody" cx="34%" cy="22%" r="82%">
            <stop offset="0%"   stopColor="#FFE3EE" />
            <stop offset="26%"  stopColor="#FBBBD8" />
            <stop offset="58%"  stopColor="#F293BE" />
            <stop offset="84%"  stopColor="#DF6D9E" />
            <stop offset="100%" stopColor="#BE4E7E" />
          </radialGradient>
          {/* Contact occlusion pooled under the belly. */}
          <radialGradient id="pcgAO" cx="50%" cy="88%" r="58%">
            <stop offset="0%"   stopColor="#A33B6B" stopOpacity="0" />
            <stop offset="60%"  stopColor="#A8386A" stopOpacity="0" />
            <stop offset="100%" stopColor="#8E2A56" stopOpacity=".3" />
          </radialGradient>
          <linearGradient id="pcgLeg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#EE86B2" />
            <stop offset="60%"  stopColor="#D9628F" />
            <stop offset="100%" stopColor="#B84571" />
          </linearGradient>
          <linearGradient id="pcgLegBack" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#CE5D8B" />
            <stop offset="100%" stopColor="#A63C68" />
          </linearGradient>
          <radialGradient id="pcgSnout" cx="36%" cy="26%" r="76%">
            <stop offset="0%"   stopColor="#FFE0EC" />
            <stop offset="55%"  stopColor="#F9AECE" />
            <stop offset="100%" stopColor="#E07AA6" />
          </radialGradient>
          <linearGradient id="pcgEarOut" x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0%"   stopColor="#F9B3D2" />
            <stop offset="100%" stopColor="#CF5A88" />
          </linearGradient>
          <linearGradient id="pcgEarIn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#FBC9DE" />
            <stop offset="100%" stopColor="#E792B6" />
          </linearGradient>
          {/* Slot: dark cavity with a light lip so it reads as a real opening. */}
          <linearGradient id="pcgSlotCav" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#3E1228" />
            <stop offset="55%"  stopColor="#6B2646" />
            <stop offset="100%" stopColor="#8F3D62" />
          </linearGradient>
          {/* Soft cast shadow — a gradient, not a flat disc. */}
          <radialGradient id="pcgCast" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#4A2A0C" stopOpacity=".34" />
            <stop offset="62%"  stopColor="#4A2A0C" stopOpacity=".16" />
            <stop offset="100%" stopColor="#4A2A0C" stopOpacity="0" />
          </radialGradient>
        </defs>

        <ellipse className="pcg-pig-shadow" cx="4" cy="90" rx="118" ry="19" fill="url(#pcgCast)" />
        <circle className="pcg-slot-halo" cx="0" cy="-88" r="56" />

        <g className="pcg-pig-body">
          {/* Legs are drawn BEFORE the body so the belly overlaps their tops and
             they read as limbs, not blocks stuck on the front. The body is kept
             short enough for a real length of leg to show below it. */}
          <path d="M-58 10 h30 a17 17 0 0 1 17 17 v45 a13 13 0 0 1 -13 13 h-38 a13 13 0 0 1 -13 -13 v-45 a17 17 0 0 1 17 -17 z"
            fill="url(#pcgLegBack)" />
          <path d="M34 10 h28 a17 17 0 0 1 17 17 v45 a13 13 0 0 1 -13 13 h-36 a13 13 0 0 1 -13 -13 v-45 a17 17 0 0 1 17 -17 z"
            fill="url(#pcgLegBack)" />
          <path d="M-92 6 h34 a18 18 0 0 1 18 18 v48 a14 14 0 0 1 -14 14 h-42 a14 14 0 0 1 -14 -14 v-48 a18 18 0 0 1 18 -18 z"
            fill="url(#pcgLeg)" />
          <path d="M56 6 h32 a18 18 0 0 1 18 18 v48 a14 14 0 0 1 -14 14 h-40 a14 14 0 0 1 -14 -14 v-48 a18 18 0 0 1 18 -18 z"
            fill="url(#pcgLeg)" />
          {/* hooves */}
          <path d="M-106 72 h62 v6 a12 12 0 0 1 -12 12 h-38 a12 12 0 0 1 -12 -12 z" fill="#A63C68" opacity=".6" />
          <path d="M42 72 h64 v6 a12 12 0 0 1 -12 12 h-40 a12 12 0 0 1 -12 -12 z" fill="#A63C68" opacity=".6" />

          {/* ── ears ── */}
          <path d="M-70 -72 C -86 -106 -60 -128 -38 -112 C -25 -102 -28 -80 -40 -68 Z"
            fill="url(#pcgEarOut)" />
          <path d="M-64 -78 C -74 -100 -56 -114 -44 -103 C -37 -96 -40 -82 -47 -74 Z"
            fill="url(#pcgEarIn)" />
          <path d="M58 -74 C 76 -108 50 -130 30 -113 C 18 -103 22 -81 34 -69 Z"
            fill="url(#pcgEarOut)" />
          <path d="M53 -80 C 64 -102 46 -116 35 -104 C 28 -97 31 -83 38 -75 Z"
            fill="url(#pcgEarIn)" />

          {/* ── tail, behind the flank ── */}
          {/* Starts inside the flank so it looks attached, and the curl clears
             the silhouette far enough to actually read as a tail. */}
          <path d="M96 -24 C 124 -30, 142 -44, 138 -60 C 135 -73, 118 -75, 113 -63
                   C 108 -50, 122 -41, 134 -46"
            fill="none" stroke="#C9527F" strokeWidth="13" strokeLinecap="round" />
          <path d="M96 -24 C 124 -30, 142 -44, 138 -60 C 135 -73, 118 -75, 113 -63
                   C 108 -50, 122 -41, 134 -46"
            fill="none" stroke="#EE86B2" strokeWidth="8" strokeLinecap="round" />
          <path d="M100 -26 C 122 -32, 136 -44, 134 -57"
            fill="none" stroke="#FBC0DA" strokeWidth="3.2" strokeLinecap="round" opacity=".7" />

          {/* ── body ── */}
          <path d="M-114 -18
                   C -114 -68, -76 -100, -8 -100
                   C 62 -100, 114 -66, 114 -16
                   C 114 28, 66 56, 0 56
                   C -66 56, -114 26, -114 -18 Z"
            fill="url(#pcgBody)" />
          <path d="M-114 -18
                   C -114 -68, -76 -100, -8 -100
                   C 62 -100, 114 -66, 114 -16
                   C 114 28, 66 56, 0 56
                   C -66 56, -114 26, -114 -18 Z"
            fill="url(#pcgAO)" />

          {/* ── rim light along the lit edge (restrained) ── */}
          <path d="M-104 -42 C -98 -76, -60 -96, -8 -96"
            fill="none" stroke="#FFFFFF" strokeWidth="5" opacity=".3" strokeLinecap="round" />
          {/* ── ceramic specular: small and kept clear of the face ── */}
          <ellipse cx="-16" cy="-66" rx="30" ry="13" fill="#FFFFFF" opacity=".26"
            transform="rotate(-16 -16 -66)" />
          <ellipse cx="-30" cy="-72" rx="12" ry="5.5" fill="#FFFFFF" opacity=".45"
            transform="rotate(-18 -30 -72)" />
          {/* ── bounce light on the shaded flank ── */}
          <path d="M98 8 C 108 -8, 110 -26, 105 -40"
            fill="none" stroke="#FFC2DC" strokeWidth="5" opacity=".28" strokeLinecap="round" />

          {/* ── snout, raised off the face ── */}
          <ellipse cx="-90" cy="-2" rx="35" ry="30" fill="#C1547F" opacity=".3" />
          <ellipse cx="-92" cy="-6" rx="35" ry="30" fill="url(#pcgSnout)" />
          <ellipse cx="-92" cy="-6" rx="35" ry="30" fill="none" stroke="#D9709F" strokeWidth="2" opacity=".45" />
          <ellipse cx="-100" cy="-10" rx="6" ry="9" fill="#A83E6B" />
          <ellipse cx="-83"  cy="-10" rx="6" ry="9" fill="#A83E6B" />
          <ellipse cx="-101" cy="-15" rx="2.2" ry="3" fill="#FFFFFF" opacity=".4" />
          <ellipse cx="-103" cy="-22" rx="11" ry="5" fill="#FFFFFF" opacity=".4"
            transform="rotate(-18 -103 -22)" />

          {/* ── eye ── */}
          <ellipse cx="-50" cy="-50" rx="13" ry="14.5" fill="#FFFFFF" />
          <ellipse cx="-50" cy="-50" rx="13" ry="14.5" fill="none" stroke="#D9709F" strokeWidth="1.6" opacity=".45" />
          <circle cx="-48" cy="-48" r="7.6" fill="#40243A" />
          <circle cx="-45.2" cy="-51" r="2.9" fill="#FFFFFF" />
          <circle cx="-51" cy="-43" r="1.5" fill="#FFFFFF" opacity=".7" />
          <path className="pcg-pig-lid" d="M-63 -50 A 13 14.5 0 0 1 -37 -50 Z" fill="#EE87B4" />
          <path d="M-64 -67 q13 -9 26 -2" stroke="#C1547F" strokeWidth="3.6"
            fill="none" strokeLinecap="round" opacity=".6" />

          {/* ── smile + blush ── */}
          <path d="M-66 12 q16 13 33 4" stroke="#B84571" strokeWidth="3.6"
            fill="none" strokeLinecap="round" opacity=".55" />
          <ellipse cx="-64" cy="-18" rx="14" ry="8" fill="#EF5D95" opacity=".3" />

          {/* ── coin slot: cavity, lip, and a bright rim while it beckons ── */}
          <g className="pcg-slot-group">
            <ellipse cx="0" cy="-80" rx="42" ry="11" fill="#C1547F" opacity=".28" />
            <rect x="-38" y="-97" width="76" height="18" rx="9" fill="url(#pcgSlotCav)" />
            <rect x="-38" y="-97" width="76" height="6"  rx="3" fill="#330E20" />
            <rect x="-34" y="-82" width="68" height="3"  rx="1.5" fill="#FFB9D6" opacity=".4" />
            <rect className="pcg-slot" x="-38" y="-97" width="76" height="18" rx="9"
              fill="none" stroke="#FFD3E5" strokeWidth="3" />
          </g>
        </g>

        {/* spark burst on a successful drop */}
        <g className="pcg-pig-sparks">
          {Array.from({ length: 8 }).map((_, i) => (
            <g key={i} transform={`rotate(${i * 45} 0 -88)`}>
              <path d="M0 -106 l0 -22" stroke="#FCD34D" strokeWidth="7" strokeLinecap="round" />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   RULES MODAL
   ═══════════════════════════════════════════════════════════════════════════ */
const RULES = [
  { icon: '🤏', text: 'Pinch the coin with your thumb and index finger.' },
  { icon: '✋', text: 'Keep pinching while you move it.' },
  { icon: '🐷', text: 'Bring it to the piggy bank slot.' },
  { icon: '👌', text: 'Open your fingers to drop it in.' },
  { icon: '⭐', text: 'Fill all the stars to finish.' },
  { icon: '⏸️', text: 'You can pause at any time.' },
];

function RulesModal({ cfg, mode, onStart }) {
  return (
    <motion.div className="pcg-overlay"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="pcg-card pcg-rules-card"
        initial={{ scale: 0.88, y: 30, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 22 }}>
        <div className="pcg-rules-head">
          <div className="pcg-rules-badge">
            <svg viewBox="0 0 100 100" width="46" height="46">
              <circle cx="50" cy="50" r="44" fill="#FCD34D" stroke="#B8790A" strokeWidth="3" />
              <path d="M50 26 L57.6 42.4 L75.5 44.6 L62.4 56.9 L65.9 74.6 L50 65.8 L34.1 74.6 L37.6 56.9 L24.5 44.6 L42.4 42.4 Z"
                fill="#FDE68A" stroke="#B8790A" strokeWidth="2.4" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <h2 className="pcg-rules-title">Pinch the Coin</h2>
            <p className="pcg-rules-sub">
              {cfg.emoji} {cfg.label} &nbsp;·&nbsp; {mode === 'camera' ? 'Camera mode' : 'Touch mode'}
              &nbsp;·&nbsp; {cfg.coinsToCollect} coins
            </p>
          </div>
        </div>

        <ul className="pcg-rules-list">
          {RULES.map((r, i) => (
            <motion.li key={i}
              initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.12 + i * 0.07 }}>
              <span className="pcg-rule-icon">{r.icon}</span>
              <span>{r.text}</span>
            </motion.li>
          ))}
        </ul>

        {mode === 'touch' && (
          <p className="pcg-rules-tip">
            💡 In touch mode, press and hold on the coin to pick it up, then lift
            your finger over the slot to drop it.
          </p>
        )}

        <button className="pcg-btn pcg-btn-primary pcg-rules-start" onClick={onStart}>
          <Play size={20} /> Let&apos;s go! 🪙
        </button>
      </motion.div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */
export default function PinchCoinGame() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, profile } = useAuthStore();
  const { startSession: storeStartSession, endSession: storeEndSession } = useSessionStore();

  /* The difficulty page sends numeric level ids — keep that contract. */
  const levelId = parseInt(searchParams.get('level') || '1', 10);
  const level = LEVELS[levelId] ? levelId : 1;
  const cfg = LEVELS[level];
  const difficultyName = level === 1 ? 'easy' : level === 2 ? 'medium' : 'hard';

  const [mode, setMode] = useState(
    (searchParams.get('mode') || 'touch').toLowerCase() === 'camera' ? 'camera' : 'touch'
  );
  const [soundEnabled, setSoundEnabled] = useState(true);

  const [gamePhase, setGamePhase] = useState(() =>
    sessionStorage.getItem(RULES_FLAG) ? 'countdown' : 'rules'
  );
  const [isPaused, setIsPaused] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);

  /* ── Throttled / discrete UI state ── */
  const [uiStep, setUiStep] = useState('pinch');
  const [uiCollected, setUiCollected] = useState(0);
  const [uiElapsed, setUiElapsed] = useState(0);
  const [uiAperture, setUiAperture] = useState(1);
  const [results, setResults] = useState(null);

  /* ── DOM refs ── */
  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);   // consumed by useHandTracking
  const fieldRef   = useRef(null);
  const coinRef    = useRef(null);
  const vizCanvasRef = useRef(null);

  /* ── Loop state ── */
  const rafRef      = useRef(null);
  const lastTsRef   = useRef(0);
  const elapsedRef  = useRef(0);
  const pinchPosRef = useRef(null);   // smoothed midpoint of thumb+index
  const thumbRef    = useRef(null);
  const indexRef    = useRef(null);
  const apertureRef = useRef(1);      // normalised thumb-index distance
  const pinchedRef  = useRef(false);
  const openFramesRef = useRef(0);
  const touchActiveRef = useRef(false);

  /* ── Coin state ── */
  const coinRef2    = useRef({ x: 300, y: TABLE_Y - 40, vx: 0, vy: 0, held: false, falling: false });
  const coinAngleRef = useRef(0);
  const stepRef     = useRef('pinch');
  const swallowRef  = useRef(null);   // { t0, from:{x,y} } while the coin is going in
  const celebrateUntilRef = useRef(0);

  /* ── Metrics ── */
  const collectedRef   = useRef(0);
  const attemptsRef    = useRef(0);
  const dropOutsideRef = useRef(0);
  const coinShownAtRef = useRef(0);
  const onsetsRef      = useRef([]);   // pinch onset times (ms)
  const aperturesRef   = useRef([]);   // aperture at the moment of closing
  const holdFramesRef  = useRef(0);
  const closedFramesRef = useRef(0);
  const holdAperturesRef = useRef([]); // aperture samples while carrying
  const carryPathRef   = useRef(0);
  const carryStartRef  = useRef(null);
  const releaseAccRef  = useRef([]);   // 0..1 per successful drop
  const trajectoryScoreRef = useRef([]);  // direct/actual per banked coin
  const speedsRef      = useRef([]);
  const jerkRef        = useRef([]);
  const pauseCountRef  = useRef(0);
  const pauseMsRef     = useRef(0);
  const slowSinceRef   = useRef(null);
  const lastCoinRef    = useRef(null);
  const headingRef     = useRef(null);

  const [sessionId, setSessionId] = useState(null);
  const sessionSavedRef = useRef(false);

  const isPlaying = gamePhase === 'playing' && !isPaused;
  const trackingEnabled = mode === 'camera' && (gamePhase === 'countdown' || gamePhase === 'playing');

  /* Keep the existing 3-argument call signature of the hook. */
  const { landmarks, isTracking, isSimulationMode } = useHandTracking(
    videoRef, canvasRef, trackingEnabled
  );

  const pinchOff = cfg.pinchOn + PINCH_MARGIN;

  /* ═════════════════════════════════════════════════════════════════════════
     INPUT
     ═════════════════════════════════════════════════════════════════════════ */
  const clientToVirtual = useCallback((cx, cy) => {
    const el = fieldRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: ((cx - r.left) / r.width) * VW, y: ((cy - r.top) / r.height) * VH };
  }, []);

  /* Camera: thumb (4) + index (8), mirrored, EMA-smoothed. */
  useEffect(() => {
    if (mode !== 'camera' || !isPlaying) return;
    if (!landmarks || landmarks.length < 9) return;
    const th = landmarks[4];
    const ix = landmarks[8];
    if (!th || !ix) return;

    const smooth = (prev, nx, ny) => (prev
      ? { x: prev.x + (nx - prev.x) * EMA_ALPHA, y: prev.y + (ny - prev.y) * EMA_ALPHA }
      : { x: nx, y: ny });

    thumbRef.current = smooth(thumbRef.current, (1 - th.x) * VW, th.y * VH);
    indexRef.current = smooth(indexRef.current, (1 - ix.x) * VW, ix.y * VH);

    // Aperture in MediaPipe's normalised space, independent of the field size.
    apertureRef.current = Math.hypot(th.x - ix.x, th.y - ix.y);
    pinchPosRef.current = {
      x: (thumbRef.current.x + indexRef.current.x) / 2,
      y: (thumbRef.current.y + indexRef.current.y) / 2,
    };
  }, [landmarks, mode, isPlaying]);

  /* Touch: press = pinch closed, release = open. */
  const handlePointerDown = useCallback((e) => {
    if (mode !== 'touch' || !isPlaying) return;
    touchActiveRef.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    const p = clientToVirtual(e.clientX, e.clientY);
    if (p) {
      pinchPosRef.current = p;
      thumbRef.current = { x: p.x - 22, y: p.y + 16 };
      indexRef.current = { x: p.x + 22, y: p.y - 16 };
      apertureRef.current = 0.02;   // well under any threshold
    }
  }, [mode, isPlaying, clientToVirtual]);

  const handlePointerMove = useCallback((e) => {
    if (mode !== 'touch' || !isPlaying) return;
    const p = clientToVirtual(e.clientX, e.clientY);
    if (!p) return;
    pinchPosRef.current = p;
    const open = touchActiveRef.current ? 22 : 46;
    thumbRef.current = { x: p.x - open, y: p.y + open * 0.7 };
    indexRef.current = { x: p.x + open, y: p.y - open * 0.7 };
    if (!touchActiveRef.current) apertureRef.current = 0.30;
  }, [mode, isPlaying, clientToVirtual]);

  const handlePointerUp = useCallback((e) => {
    touchActiveRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    if (mode === 'touch') apertureRef.current = 0.30;
  }, [mode]);

  /* ═════════════════════════════════════════════════════════════════════════
     COIN PLACEMENT
     ═════════════════════════════════════════════════════════════════════════ */
  const placeCoin = useCallback((ts) => {
    // Spawn on the left half of the table so every run needs a real transport.
    const x = 140 + Math.random() * 260;
    const y = TABLE_Y - 40 - Math.random() * 120;
    coinRef2.current = { x, y, vx: 0, vy: 0, held: false, falling: false, swallowScale: null };
    coinAngleRef.current = 0;
    coinShownAtRef.current = ts;
    carryStartRef.current = null;
    carryPathRef.current = 0;
    lastCoinRef.current = null;
    headingRef.current = null;
    stepRef.current = 'pinch';
    setUiStep('pinch');
  }, []);

  const paintCoin = useCallback(() => {
    const el = coinRef.current;
    if (!el) return;
    const c = coinRef2.current;
    el.style.left = `${(c.x / VW) * 100}%`;
    el.style.top = `${(c.y / VH) * 100}%`;
    // translate(-50%,-50%) does the centring; see the CSS note on why negative
    // percentage margins cannot be used here.
    const s = c.swallowScale != null ? c.swallowScale : (c.held ? 1.12 : 1);
    el.style.transform =
      `translate(-50%, -50%) rotate(${coinAngleRef.current.toFixed(1)}deg) scale(${s})`;
    el.style.opacity = c.swallowScale != null ? String(clamp01(c.swallowScale * 2.2)) : '1';
  }, []);

  /* ═════════════════════════════════════════════════════════════════════════
     RESULTS
     ═════════════════════════════════════════════════════════════════════════ */
  const finishGame = useCallback(() => {
    cancelAnimationFrame(rafRef.current);

    const releaseAccuracy = mean(releaseAccRef.current) * 100;

    /* Pinch Stability — see the file header. Two honest components:
       how much of the carry kept the grip closed, and how little the aperture
       wobbled while it was closed. No force is claimed. */
    const closedShare = holdFramesRef.current > 0
      ? closedFramesRef.current / holdFramesRef.current
      : 0;
    const ap = holdAperturesRef.current;
    let wobble = 0;
    if (ap.length > 1) {
      const m = mean(ap);
      wobble = Math.sqrt(mean(ap.map((v) => (v - m) ** 2)));
    }
    // With only closed-grip samples, a standard deviation of 0.012 normalised
    // units is already a visibly shaky hold.
    const steadiness = clamp01(1 - wobble / 0.012);
    const stability = clamp01(closedShare * 0.6 + steadiness * 0.4) * 100;

    // Trajectory efficiency: direct distance / distance actually travelled,
    // averaged over the coins that were successfully banked.
    const trajectoryEff = mean(trajectoryScoreRef.current) * 100;
    const smoothness = clamp01(1 - mean(jerkRef.current) / 2600) * 100;

    const dragSpeed = mean(speedsRef.current);
    const speedScore = clamp01(dragSpeed / REF_DRAG_SPEED) * 100;

    const attempts = Math.max(1, attemptsRef.current);
    const successRate = (collectedRef.current / attempts) * 100;

    const composite = Math.round(
      releaseAccuracy * 0.25 + stability * 0.25 + trajectoryEff * 0.20 +
      successRate * 0.20 + speedScore * 0.10
    );

    const stars = cfg.starThresholds.reduce(
      (acc, t) => acc + (collectedRef.current >= t ? 1 : 0), 0
    );

    setResults({
      collected: collectedRef.current,
      target: cfg.coinsToCollect,
      attempts: attemptsRef.current,
      dropOutside: dropOutsideRef.current,
      onsetMs: onsetsRef.current.length ? Math.round(mean(onsetsRef.current)) : null,
      aperture: aperturesRef.current.length
        ? Math.round(mean(aperturesRef.current) * 1000) / 1000 : null,
      stability: Math.round(stability),
      trajectory: Math.round(trajectoryEff),
      smoothness: Math.round(smoothness),
      dragSpeed: Math.round(dragSpeed),
      pauses: pauseCountRef.current,
      pauseMs: Math.round(pauseMsRef.current),
      releaseAccuracy: Math.round(releaseAccuracy),
      successRate: Math.round(successRate),
      totalSec: elapsedRef.current / 1000,
      stars,
      composite,
    });
    setGamePhase('results');
    if (soundEnabled) soundManager.playCelebration();
  }, [cfg.coinsToCollect, cfg.starThresholds, soundEnabled]);

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

      const p = pinchPosRef.current;
      const ap = apertureRef.current;
      const coin = coinRef2.current;

      /* ── Pinch state machine with hysteresis + release debounce ────────── */
      const wasPinched = pinchedRef.current;
      if (!wasPinched) {
        if (ap < cfg.pinchOn) { pinchedRef.current = true; openFramesRef.current = 0; }
      } else if (ap > pinchOff) {
        openFramesRef.current += 1;
        if (openFramesRef.current >= RELEASE_FRAMES) {
          pinchedRef.current = false;
          openFramesRef.current = 0;
        }
      } else {
        openFramesRef.current = 0;
      }
      const pinched = pinchedRef.current;

      /* ── Step 1: grab ──────────────────────────────────────────────────── */
      if (!coin.held && !coin.falling && !swallowRef.current && pinched && p) {
        const d = Math.hypot(p.x - coin.x, p.y - coin.y);
        if (d <= cfg.coinR + GRAB_PAD) {
          coin.held = true;
          attemptsRef.current += 1;
          onsetsRef.current.push(ts - coinShownAtRef.current);
          aperturesRef.current.push(ap);
          carryStartRef.current = { x: coin.x, y: coin.y };
          carryPathRef.current = 0;
          lastCoinRef.current = null;
          stepRef.current = 'move';
          setUiStep('move');
          if (soundEnabled) soundManager.playClick();
        }
      }

      /* ── Step 2: carry ─────────────────────────────────────────────────── */
      if (coin.held) {
        holdFramesRef.current += 1;
        /* Sample the aperture only while the grip is actually closed. Including
           the deliberate opening at the slot would swamp the standard deviation
           and make a rock-steady grip look as shaky as a failing one. */
        if (ap < pinchOff) {
          closedFramesRef.current += 1;
          holdAperturesRef.current.push(ap);
          if (holdAperturesRef.current.length > 3000) holdAperturesRef.current.shift();
        }

        if (p) {
          const nx = coin.x + (p.x - coin.x) * COIN_LERP;
          const ny = coin.y + (p.y - coin.y) * COIN_LERP;
          const mdx = nx - coin.x;
          const mdy = ny - coin.y;
          coinAngleRef.current += (Math.max(-12, Math.min(12, mdx * 0.6)) - coinAngleRef.current) * 0.2;
          coin.x = nx; coin.y = ny;
        }

        if (lastCoinRef.current) {
          const dx = coin.x - lastCoinRef.current.x;
          const dy = coin.y - lastCoinRef.current.y;
          const dist = Math.hypot(dx, dy);
          const inst = dist / Math.max(0.001, dt);
          carryPathRef.current += dist;
          speedsRef.current.push(inst);
          if (speedsRef.current.length > 3000) speedsRef.current.shift();

          if (dist > 0.7) {
            const h = Math.atan2(dy, dx);
            if (headingRef.current != null) {
              let diff = Math.abs(h - headingRef.current);
              if (diff > Math.PI) diff = 2 * Math.PI - diff;
              jerkRef.current.push((diff / Math.max(0.001, dt)) * Math.min(inst, 900) / 90);
              if (jerkRef.current.length > 900) jerkRef.current.shift();
            }
            headingRef.current = h;
          }

          if (inst < PAUSE_SPEED) {
            if (slowSinceRef.current == null) slowSinceRef.current = ts;
            else if (slowSinceRef.current === -1) pauseMsRef.current += dtMs;
            else if (ts - slowSinceRef.current >= PAUSE_MIN_MS) {
              pauseCountRef.current += 1;
              pauseMsRef.current += ts - slowSinceRef.current;
              slowSinceRef.current = -1;
            }
          } else slowSinceRef.current = null;
        }
        lastCoinRef.current = { x: coin.x, y: coin.y };

        /* Entering the drop zone flips the HUD to step 3. */
        const dSlot = Math.hypot(coin.x - SLOT_X, coin.y - SLOT_Y);
        const nextStep = dSlot <= cfg.slotRadius ? 'release' : 'move';
        if (nextStep !== stepRef.current) { stepRef.current = nextStep; setUiStep(nextStep); }

        /* ── Step 3: release ─────────────────────────────────────────────── */
        if (!pinched) {
          coin.held = false;
          const acc = clamp01(1 - dSlot / cfg.slotRadius);

          if (dSlot <= cfg.slotRadius) {
            // Dropped in.
            releaseAccRef.current.push(acc);
            const direct = carryStartRef.current
              ? Math.hypot(SLOT_X - carryStartRef.current.x, SLOT_Y - carryStartRef.current.y)
              : 0;
            if (direct > 20 && carryPathRef.current > 0) {
              trajectoryScoreRef.current.push(clamp01(direct / carryPathRef.current));
            }
            collectedRef.current += 1;
            slowSinceRef.current = null;
            if (soundEnabled) soundManager.playProgress();

            /* Play the coin INTO the slot, and let the bank react, before the
               next coin appears. */
            swallowRef.current = { t0: ts, from: { x: coin.x, y: coin.y } };
            celebrateUntilRef.current = ts + CELEBRATE_MS;
            if (fieldRef.current) fieldRef.current.classList.add('pcg-celebrate');
            setUiCollected(collectedRef.current);
            stepRef.current = 'pinch';
            setUiStep('pinch');
          } else {
            // Dropped outside — the coin falls back onto the table.
            dropOutsideRef.current += 1;
            coin.falling = true;
            coin.vx = 0;
            coin.vy = 0;
            stepRef.current = 'pinch';
            setUiStep('pinch');
          }
        }
      }

      /* ── Coin being swallowed by the slot ──────────────────────────────── */
      if (swallowRef.current) {
        const u = clamp01((ts - swallowRef.current.t0) / SWALLOW_MS);
        const e = 1 - Math.pow(1 - u, 3);
        const from = swallowRef.current.from;
        // Arc slightly above the slot before dropping in, so it reads as a toss.
        const lift = Math.sin(u * Math.PI) * 34;
        coin.x = from.x + (SLOT_X - from.x) * e;
        coin.y = from.y + (SLOT_Y - from.y) * e - lift;
        coin.swallowScale = 1.12 * (1 - e * 0.95);
        coinAngleRef.current = e * 420;
        if (u >= 1) {
          swallowRef.current = null;
          coin.swallowScale = null;
          coinAngleRef.current = 0;
          if (collectedRef.current >= cfg.coinsToCollect) {
            cancelAnimationFrame(rafRef.current);
            finishRef.current();
            return;
          }
          placeCoin(ts);
        }
      }

      if (celebrateUntilRef.current && ts >= celebrateUntilRef.current) {
        celebrateUntilRef.current = 0;
        if (fieldRef.current) fieldRef.current.classList.remove('pcg-celebrate');
      }

      /* ── Falling coin: gravity + bounce back onto the table ────────────── */
      if (coin.falling) {
        coin.vy += GRAVITY * dt;
        coin.y += coin.vy * dt;
        coin.x += coin.vx * dt;
        coinAngleRef.current += 240 * dt;
        const floor = TABLE_Y - 20;
        if (coin.y >= floor) {
          coin.y = floor;
          coin.vy = -coin.vy * BOUNCE;
          coin.vx *= 0.6;
          if (Math.abs(coin.vy) < 60) {
            coin.vy = 0; coin.falling = false; coinAngleRef.current = 0;
            coinShownAtRef.current = ts;   // onset clock restarts for this attempt
          }
        }
        coin.x = Math.max(cfg.coinR + 10, Math.min(VW - cfg.coinR - 10, coin.x));
      }

      paintCoin();
      drawViz(ts, pinched);

      if (ts - lastUi > 200) {
        lastUi = ts;
        setUiCollected(collectedRef.current);
        setUiElapsed(elapsedRef.current / 1000);
        setUiAperture(ap);
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [gamePhase, isPaused, cfg, pinchOff, soundEnabled, placeCoin, paintCoin]);

  /* ═════════════════════════════════════════════════════════════════════════
     PINCH VISUALISATION — thumb, index, the line between them, and the
     threshold made visible. This is the direct read-out of what the game
     measures: the child sees their own gesture, the therapist sees the cutoff.
     ═════════════════════════════════════════════════════════════════════════ */
  const drawViz = useCallback((ts, pinched) => {
    const cv = vizCanvasRef.current;
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

    const th = thumbRef.current;
    const ix = indexRef.current;
    if (!th || !ix) return;

    const kx = rect.width / VW;
    const ky = rect.height / VH;
    const tx = th.x * kx, ty = th.y * ky;
    const nx = ix.x * kx, ny = ix.y * ky;

    /* Closeness 0..1: 1 when fully pinched, 0 at twice the threshold. */
    const close = clamp01(1 - (apertureRef.current - cfg.pinchOn) / cfg.pinchOn);
    const r = Math.round(160 - 126 * close);
    const g = Math.round(160 + 1 * close);
    const b = Math.round(160 - 55 * close);
    const col = `${r}, ${Math.min(255, g + 40 * close)}, ${b}`;

    // Connecting line — thickens and brightens as the fingers close.
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(nx, ny);
    ctx.lineWidth = 2 + 5 * close;
    ctx.strokeStyle = `rgba(${col}, ${0.45 + 0.5 * close})`;
    ctx.shadowBlur = pinched ? 16 : 0;
    ctx.shadowColor = `rgba(${col}, 0.9)`;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Grab radius around the pinch midpoint while reaching.
    const coin = coinRef2.current;
    if (!coin.held) {
      const mx = (tx + nx) / 2, my = (ty + ny) / 2;
      const pulse = 1 + 0.08 * Math.sin(ts / 240);
      ctx.beginPath();
      ctx.arc(mx, my, (cfg.coinR + GRAB_PAD) * kx * pulse, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 8]);
      ctx.strokeStyle = `rgba(${col}, ${0.25 + 0.45 * close})`;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Fingertips
    for (const [px, py, lbl] of [[tx, ty, 'T'], [nx, ny, 'I']]) {
      ctx.beginPath();
      ctx.arc(px, py, 13, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${col}, 0.22)`;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(${col}, 0.95)`;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.font = '700 10px Inter, sans-serif';
      ctx.fillStyle = `rgba(${col}, 0.95)`;
      ctx.textAlign = 'center';
      ctx.fillText(lbl, px, py - 19);
    }
  }, [cfg.pinchOn, cfg.coinR]);

  /* ═════════════════════════════════════════════════════════════════════════
     COUNTDOWN + RESET
     ═════════════════════════════════════════════════════════════════════════ */
  const resetRun = useCallback((ts) => {
    lastTsRef.current = 0;
    elapsedRef.current = 0;
    collectedRef.current = 0;
    attemptsRef.current = 0;
    dropOutsideRef.current = 0;
    onsetsRef.current = [];
    aperturesRef.current = [];
    holdFramesRef.current = 0;
    closedFramesRef.current = 0;
    holdAperturesRef.current = [];
    carryPathRef.current = 0;
    releaseAccRef.current = [];
    trajectoryScoreRef.current = [];
    speedsRef.current = [];
    jerkRef.current = [];
    pauseCountRef.current = 0;
    pauseMsRef.current = 0;
    slowSinceRef.current = null;
    lastCoinRef.current = null;
    headingRef.current = null;
    pinchedRef.current = false;
    openFramesRef.current = 0;
    swallowRef.current = null;
    celebrateUntilRef.current = 0;
    if (fieldRef.current) fieldRef.current.classList.remove('pcg-celebrate');
    placeCoin(ts);
    paintCoin();
  }, [placeCoin, paintCoin]);

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
        resetRun(performance.now());
        setUiCollected(0); setUiElapsed(0); setUiStep('pinch');
        setGamePhase('playing');
      } else {
        setCountdown(n);
        if (soundEnabled) soundManager.playCountdown();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [gamePhase, soundEnabled, resetRun]);

  useEffect(() => { paintCoin(); }, [paintCoin]);

  /* ═════════════════════════════════════════════════════════════════════════
     SESSION API — payload shape preserved, new metrics added inside notes
     ═════════════════════════════════════════════════════════════════════════ */
  useEffect(() => {
    if (gamePhase !== 'playing' || sessionId) return;
    const learnerId = profile?.learner_id || user?.id || '00000000-0000-0000-0000-000000000010';
    api.post('/sessions/start', {
      learner_id: learnerId,
      difficulty: difficultyName,
      game_name: 'Pinch the Coin',
    }).then((res) => {
      const sid = res.data?.session_id;
      if (sid) { setSessionId(sid); storeStartSession(sid, learnerId, difficultyName); }
    }).catch((err) => console.warn('[PinchCoinGame] Could not start session:', err));
  }, [gamePhase, sessionId, difficultyName, profile, user, storeStartSession]);

  useEffect(() => {
    if (gamePhase !== 'results' || !results || !sessionId || sessionSavedRef.current) return;
    sessionSavedRef.current = true;
    const durationSeconds = Math.max(1, Math.round(results.totalSec));
    const accuracyScore = results.successRate / 100;
    api.post('/sessions/end', {
      session_id: sessionId,
      duration_seconds: durationSeconds,
      accuracy_score: parseFloat(accuracyScore.toFixed(2)),
      accuracy: results.successRate,
      perfect_grabs: results.collected,
      total_attempts: results.attempts,
      game_name: 'Pinch the Coin',
      notes: JSON.stringify({
        mode,
        level,
        pinchOnsetMs: results.onsetMs,
        pinchAperture: results.aperture,
        // Consistency of grip measured from landmark distance — NOT a force.
        pinchStability: results.stability,
        dragTrajectoryEfficiency: results.trajectory,
        trajectorySmoothness: results.smoothness,
        dragSpeedPxPerSec: results.dragSpeed,
        pauses: results.pauses,
        pauseDurationMs: results.pauseMs,
        releaseAccuracy: results.releaseAccuracy,
        coinsCollected: results.collected,
        attempts: results.attempts,
        droppedOutside: results.dropOutside,
        successRate: results.successRate,
        starsEarned: results.stars,
        performanceScore: results.composite,
      }),
    }).then(() => {
      storeEndSession({
        duration: durationSeconds,
        accuracy: results.successRate,
        perfectGrabs: results.collected,
      });
    }).catch((err) => console.error('[PinchCoinGame] Failed to save session:', err));
  }, [gamePhase, results, sessionId, mode, level, storeEndSession]);

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
      if (!next) { lastTsRef.current = 0; lastCoinRef.current = null; }
      if (soundEnabled) soundManager.playClick();
      return next;
    });
  }, [gamePhase, soundEnabled]);

  const switchMode = useCallback(() => {
    setMode((m) => (m === 'camera' ? 'touch' : 'camera'));
    pinchPosRef.current = null;
    thumbRef.current = null;
    indexRef.current = null;
    apertureRef.current = 1;
    pinchedRef.current = false;
    openFramesRef.current = 0;
    if (coinRef2.current.held) { coinRef2.current.held = false; coinRef2.current.falling = true; }
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
  const stars = useMemo(
    () => cfg.starThresholds.map((t) => uiCollected >= t),
    [cfg.starThresholds, uiCollected]
  );
  const progressPct = clamp01(uiCollected / cfg.coinsToCollect) * 100;
  const nearSlot = uiStep === 'release';

  return (
    <div className="pcg-page">
      <header className="pcg-header">
        <div className="pcg-header-left">
          <button className="pcg-icon-btn pcg-home-btn" onClick={goHome} title="Home" aria-label="Home">
            <Home size={20} />
          </button>
          <span className={`pcg-level-chip pcg-level-${level}`}>{cfg.emoji} {cfg.label}</span>
        </div>

        <div className="pcg-header-center">
          <div className="pcg-banner">
            <strong>Pinch the coin</strong> and drop it in the piggy bank!
          </div>
        </div>

        <div className="pcg-header-right">
          <div className="pcg-stat">
            <Clock size={18} className="pcg-stat-ico" />
            <span className="pcg-stat-val">{fmtTime(uiElapsed)}</span>
          </div>
          <button className="pcg-icon-btn" onClick={switchMode}
            title={mode === 'camera' ? 'Switch to touch' : 'Switch to camera'}>
            {mode === 'camera' ? <Hand size={20} /> : <MousePointer2 size={20} />}
          </button>
          <button className="pcg-icon-btn"
            onClick={() => setSoundEnabled((s) => { soundManager.toggle?.(); return !s; })}
            title="Sound">
            {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
          <button className="pcg-icon-btn pcg-pause-btn" onClick={togglePause}
            disabled={gamePhase !== 'playing'} title="Pause">
            {isPaused ? <Play size={20} /> : <Pause size={20} />}
          </button>
        </div>
      </header>

      <main className="pcg-stage">
        <div
          className={`pcg-field ${nearSlot ? 'pcg-near-slot' : ''}`}
          ref={fieldRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ touchAction: 'none' }}
        >
          <PiggyBank />
          <Coin ref={coinRef} />
          <canvas className="pcg-viz-canvas" ref={vizCanvasRef} />

          {/* Step panel */}
          <div className="pcg-steps" aria-label="Steps">
            <div className="pcg-steps-title">Steps</div>
            {STEPS.map((s) => (
              <div key={s.key}
                className={`pcg-step ${uiStep === s.key ? 'active' : ''}`}>
                <span className="pcg-step-n">{s.n}</span>
                <span className="pcg-step-l">{s.label}</span>
              </div>
            ))}
          </div>

          {/* Contextual hint */}
          <AnimatePresence mode="wait">
            {gamePhase === 'playing' && !isPaused && (
              <motion.div key={uiStep} className="pcg-hint"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22 }}>
                <Hand size={17} />
                <span>{STEP_HINT[uiStep]}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="pcg-cam-hidden">
            <video ref={videoRef} playsInline muted />
            <canvas ref={canvasRef} />
          </div>

          {mode === 'camera' && gamePhase === 'playing' && (
            <div className={`pcg-cam-status ${isTracking ? 'ok' : 'wait'}`}>
              {isSimulationMode ? 'Simulation mode'
                : isTracking ? 'Hand detected' : 'Show your hand ✋'}
            </div>
          )}
        </div>

        {/* Star progress bar */}
        <div className="pcg-progress">
          <span className="pcg-progress-coin">
            <svg viewBox="0 0 100 100" width="22" height="22">
              <circle cx="50" cy="50" r="44" fill="#FCD34D" stroke="#B8790A" strokeWidth="5" />
              <path d="M50 28 L57 43 L73 45 L61 56 L64 72 L50 64 L36 72 L39 56 L27 45 L43 43 Z"
                fill="#FDE68A" stroke="#B8790A" strokeWidth="3" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="pcg-progress-track">
            <div className="pcg-progress-fill" style={{ width: `${progressPct}%` }} />
            {cfg.starThresholds.map((t, i) => (
              <span key={i}
                className={`pcg-progress-star ${stars[i] ? 'earned' : ''}`}
                style={{ left: `${3 + (t / cfg.coinsToCollect) * 94}%` }}>
                ★
              </span>
            ))}
          </div>
          <span className="pcg-progress-count">{uiCollected}/{cfg.coinsToCollect}</span>
        </div>
      </main>

      {/* ═══ OVERLAYS ═══════════════════════════════════════════════════ */}
      <AnimatePresence>
        {gamePhase === 'rules' && (
          <RulesModal key="rules" cfg={cfg} mode={mode} onStart={startFromRules} />
        )}

        {gamePhase === 'countdown' && (
          <motion.div key="cd" className="pcg-overlay pcg-overlay-soft"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div key={countdown} className="pcg-countdown"
              initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 18 }}>
              {countdown}
            </motion.div>
            <p className="pcg-countdown-hint">Get your fingers ready…</p>
          </motion.div>
        )}

        {isPaused && gamePhase === 'playing' && (
          <motion.div key="pause" className="pcg-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="pcg-card pcg-pause-card"
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}>
              <div className="pcg-pause-ico"><Pause size={38} /></div>
              <h2>Paused</h2>
              <p>The piggy bank is waiting 🐷</p>
              <div className="pcg-actions">
                <button className="pcg-btn pcg-btn-primary" onClick={togglePause}>
                  <Play size={18} /> Resume
                </button>
                <button className="pcg-btn pcg-btn-ghost" onClick={restart}>
                  <RotateCcw size={18} /> Restart
                </button>
                <button className="pcg-btn pcg-btn-ghost" onClick={goHome}>
                  <Home size={18} /> Home
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {gamePhase === 'results' && results && (
          <motion.div key="res" className="pcg-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <motion.div className="pcg-card pcg-results-card"
              initial={{ scale: 0.86, y: 40, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 220, damping: 24 }}>
              <div className="pcg-confetti" aria-hidden="true">
                {Array.from({ length: 14 }).map((_, i) => (
                  <span key={i} style={{ '--i': i }} />
                ))}
              </div>

              <h2 className="pcg-results-title"><CheckCircle size={26} /> All coins banked!</h2>
              <p className="pcg-results-sub">
                {cfg.emoji} {cfg.label} · {mode === 'camera' ? 'Camera' : 'Touch'}
              </p>

              <div className="pcg-results-stars">
                {[0, 1, 2].map((i) => (
                  <span key={i} className={i < results.stars ? 'earned' : ''}>★</span>
                ))}
              </div>

              <div className="pcg-perf-ring" style={{ '--pct': results.composite }}>
                <div className="pcg-perf-inner">
                  <span className="pcg-perf-val">{results.composite}</span>
                  <span className="pcg-perf-lbl">OT Score</span>
                </div>
              </div>

              <div className="pcg-metrics">
                <Metric icon={<Zap size={16} />} label="Pinch Onset"
                  value={results.onsetMs == null ? '—' : `${(results.onsetMs / 1000).toFixed(2)}s`} />
                <Metric icon={<Move size={16} />} label="Pinch Aperture"
                  value={results.aperture == null ? '—' : results.aperture.toFixed(3)} />
                <Metric icon={<Activity size={16} />} label="Pinch Stability"
                  value={`${results.stability}%`}
                  tip="Consistency of the grip measured from thumb–index distance — not a force reading. A camera cannot measure force." />
                <Metric icon={<TrendingUp size={16} />} label="Drag Trajectory" value={`${results.trajectory}%`} />
                <Metric icon={<Gauge size={16} />} label="Drag Speed" value={`${results.dragSpeed} px/s`} />
                <Metric icon={<Pause size={16} />} label="Pauses"
                  value={`${results.pauses} · ${(results.pauseMs / 1000).toFixed(1)}s`} />
                <Metric icon={<Target size={16} />} label="Release Accuracy" value={`${results.releaseAccuracy}%`} />
                <Metric icon={<Crosshair size={16} />} label="Success"
                  value={`${results.collected}/${results.attempts}`} />
                <Metric icon={<Clock size={16} />} label="Total Time" value={fmtTime(results.totalSec)} />
              </div>

              <div className="pcg-actions">
                <button className="pcg-btn pcg-btn-primary" onClick={restart}>
                  <RotateCcw size={18} /> Play again
                </button>
                <button className="pcg-btn pcg-btn-ghost"
                  onClick={() => navigate('/play/pinch-coin-difficulty')}>
                  Levels
                </button>
                <button className="pcg-btn pcg-btn-ghost" onClick={goHome}>
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

/* ── Metric cell, with an optional tooltip for definitions that need one ─── */
function Metric({ icon, label, value, tip }) {
  return (
    <div className="pcg-metric">
      <div className="pcg-metric-ico">{icon}</div>
      <div className="pcg-metric-body">
        <span className="pcg-metric-label">
          {label}
          {tip && (
            <span className="pcg-tip" tabIndex={0} role="note" aria-label={tip}>
              <Info size={11} />
              <span className="pcg-tip-bubble">{tip}</span>
            </span>
          )}
        </span>
        <span className="pcg-metric-value">{value}</span>
      </div>
    </div>
  );
}
