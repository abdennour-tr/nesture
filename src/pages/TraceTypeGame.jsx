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

import { HandDefs, HandArt, steadyAngle, followHand } from '../components/game/HandPointer';
import { createHandPointerFilter, handDepthScale } from '../utils/handPointerFilter';
// ── Constants ──────────────────────────────────────────────────────────────
const COUNTDOWN_SECONDS = 3;
const TYPE_REQUIRED      = 3;   // Must type the letter 3 times
const TRACE_WAYPOINT_RADIUS = 25; // px radius to count as "reached"
const POINTS_PER_STEP    = 10;

// ── OT scoring constants ───────────────────────────────────────────────────
const RULES_FLAG = 'tracetype_rules_seen';
/* Reference time (seconds) for one full Trace -> Find -> Type cycle at each
   level. Used for the Speed sub-score: finishing at the reference pace = 100%. */
const LEVEL_REF_SEC = { 1: 16, 2: 22, 3: 28 };
/* Distance (in 300x300 SVG units) beyond which the fingertip counts as
   "off path" while tracing. Slightly wider than the waypoint radius so a
   normal, slightly wobbly stroke is not punished. */
const TRACE_TOLERANCE = 34;
/* Mean jerk (SVG units / s^3) that maps to a Smoothness score of 0. Generous:
   a fast but controlled stroke stays well below it. */
const JERK_CAP = 4200;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Shortest distance from point (px,py) to segment a-b. */
function distToSegment(px, py, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (!len2) return Math.hypot(px - a.x, py - a.y);
  let t = ((px - a.x) * vx + (py - a.y) * vy) / len2;
  t = clamp01(t);
  return Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy));
}

/** Fresh OT accumulator. One per session. */
function makeOTAccumulator() {
  return {
    startedAt: null,
    firstMoveAt: null,
    // Trace
    traceSamples: 0,
    traceOnPath: 0,
    traceDistSum: 0,
    // Same three, reset after every letter, for the per-letter star rating
    letterSamples: 0, letterOnPath: 0, letterDistSum: 0,
    // Smoothness (jerk)
    lastPos: null, lastVel: null, lastAcc: null, lastT: null,
    jerkSum: 0, jerkCount: 0,
    // Find / Type keyboard
    findTaps: 0, findWrong: 0,
    typeTaps: 0, typeWrong: 0,
    // Pauses
    pauses: 0, pauseMs: 0, pauseStartedAt: null,
  };
}

// ── Letters per level ──────────────────────────────────────────────────────
const LEVEL_LETTERS = {
  1: 'LVXTIFEH'.split(''), // Simple straight lines, fewer points
  2: 'AMNKOPUYZCD'.split(''), // Moderate complexity, simple curves or angled lines
  3: 'QSRGJWB'.split(''), // High complexity, multiple curves or strokes
};

/* Explicitly mark waypoint connections that are "pen lifts" (i.e. moving to the
   start of a NEW stroke) where a segment line should NOT be drawn and the path
   error should NOT be scored. The index is the index of the DESTINATION
   waypoint, so `[2]` means "the move from waypoint 1 to waypoint 2 is a lift".

   These follow the standard manuscript stroke sequence for capitals
   (Handwriting Without Tears / Zaner-Bloser): every capital starts at the top,
   big lines before little lines, top-to-bottom and left-to-right. */
const BAD_JUMPS = {
  A: [2, 4], // back to top for the 2nd slant, then lift to the crossbar
  B: [2],    // back to the top after the big line down
  D: [2],
  E: [2, 4, 6], // top, middle and bottom little lines
  F: [2, 4],
  H: [2, 4], // 2nd big line down, then the crossbar
  I: [2, 4], // top little line, then bottom little line
  K: [2],
  M: [2],
  N: [2],
  P: [2],
  Q: [9],    // lift from the O ring to the start of the tail
  R: [2],
  T: [2],    // big line down first, then the little line across the top
  X: [2],    // lift from the end of the 1st slant to the top of the 2nd
  Y: [2],
};

// ── Encouraging messages pool ──────────────────────────────────────────────
const ENCOURAGEMENTS = [
  '⭐ Great Job!',  '🎉 Excellent!',   '✨ Amazing!',
  '🏆 Champion!',   '💪 Perfect!',     '🌟 Wonderful!',
  '🚀 Incredible!', '💎 Superstar!',
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
  // Slant down left, back to the top, slant down right, then the crossbar.
  A: {
    waypoints: [
      { x: 150, y: 40 },   { x: 50, y: 260 },
      { x: 150, y: 40 },   { x: 250, y: 260 },
      { x: 100, y: 170 },  { x: 200, y: 170 },
    ],
    path: 'M150,40 L50,260 M150,40 L250,260 M100,170 L200,170',
  },
  // Big line down, back to the top, top bump, bottom bump.
  B: {
    waypoints: [
      { x: 70, y: 40 },   { x: 70, y: 260 },
      { x: 70, y: 40 },   { x: 190, y: 60 },   { x: 190, y: 130 },
      { x: 70, y: 150 },  { x: 210, y: 170 },  { x: 210, y: 240 },
      { x: 70, y: 260 },
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
  // Big line down, back to the top, curve around to the bottom.
  D: {
    waypoints: [
      { x: 70, y: 40 },    { x: 70, y: 260 },
      { x: 70, y: 40 },    { x: 215, y: 70 },  { x: 260, y: 150 },
      { x: 215, y: 230 },  { x: 70, y: 260 },
    ],
    path: 'M70,40 L70,260 M70,40 Q260,40 260,150 Q260,260 70,260',
  },
  // Big line down, then the top, middle and bottom little lines (left to right).
  E: {
    waypoints: [
      { x: 70, y: 40 },   { x: 70, y: 260 },
      { x: 70, y: 40 },   { x: 210, y: 40 },
      { x: 70, y: 150 },  { x: 180, y: 150 },
      { x: 70, y: 260 },  { x: 210, y: 260 },
    ],
    path: 'M70,40 L70,260 M70,40 L210,40 M70,150 L180,150 M70,260 L210,260',
  },
  // Big line down, then the top and middle little lines (left to right).
  F: {
    waypoints: [
      { x: 70, y: 40 },   { x: 70, y: 260 },
      { x: 70, y: 40 },   { x: 210, y: 40 },
      { x: 70, y: 150 },  { x: 180, y: 150 },
    ],
    path: 'M70,40 L70,260 M70,40 L210,40 M70,150 L180,150',
  },
  G: {
    waypoints: [
      { x: 230, y: 80 },   { x: 150, y: 40 },   { x: 70, y: 100 },
      { x: 60, y: 150 },   { x: 70, y: 210 },   { x: 150, y: 260 },
      { x: 230, y: 220 },  { x: 230, y: 160 },  { x: 170, y: 160 },
    ],
    path: 'M230,80 Q150,20 70,80 Q40,150 70,220 Q150,280 230,220 L230,160 L170,160',
  },
  // Big line down, big line down, then the little line across.
  H: {
    waypoints: [
      { x: 70, y: 40 },   { x: 70, y: 260 },
      { x: 230, y: 40 },  { x: 230, y: 260 },
      { x: 70, y: 150 },  { x: 230, y: 150 },
    ],
    path: 'M70,40 L70,260 M230,40 L230,260 M70,150 L230,150',
  },
  // Big line down, little line across the top, little line across the bottom.
  I: {
    waypoints: [
      { x: 150, y: 40 },  { x: 150, y: 260 },
      { x: 100, y: 40 },  { x: 200, y: 40 },
      { x: 100, y: 260 }, { x: 200, y: 260 },
    ],
    path: 'M150,40 L150,260 M100,40 L200,40 M100,260 L200,260',
  },
  // One stroke: big line down, then turn (hook) to the left.
  J: {
    waypoints: [
      { x: 190, y: 40 },  { x: 190, y: 210 },
      { x: 150, y: 260 }, { x: 80, y: 230 },
    ],
    path: 'M190,40 L190,210 Q190,270 120,250 Q80,240 80,220',
  },
  // Big line down, then slant in to the middle and slant out to the bottom.
  K: {
    waypoints: [
      { x: 70, y: 40 },   { x: 70, y: 260 },
      { x: 220, y: 40 },  { x: 70, y: 160 },  { x: 220, y: 260 },
    ],
    path: 'M70,40 L70,260 M220,40 L70,160 L220,260',
  },
  L: {
    waypoints: [
      { x: 70, y: 40 },   { x: 70, y: 260 },  { x: 220, y: 260 },
    ],
    path: 'M70,40 L70,260 L220,260',
  },
  // Big line down, back to the top, slant down, slant up, big line down.
  M: {
    waypoints: [
      { x: 50, y: 40 },   { x: 50, y: 260 },
      { x: 50, y: 40 },   { x: 150, y: 160 },
      { x: 250, y: 40 },  { x: 250, y: 260 },
    ],
    path: 'M50,40 L50,260 M50,40 L150,160 L250,40 L250,260',
  },
  // Big line down, back to the top, slant down, big line up.
  N: {
    waypoints: [
      { x: 70, y: 40 },   { x: 70, y: 260 },
      { x: 70, y: 40 },   { x: 230, y: 260 },  { x: 230, y: 40 },
    ],
    path: 'M70,40 L70,260 M70,40 L230,260 L230,40',
  },
  O: {
    waypoints: [
      { x: 150, y: 40 },  { x: 70, y: 80 },   { x: 50, y: 150 },
      { x: 70, y: 220 },  { x: 150, y: 260 },  { x: 230, y: 220 },
      { x: 250, y: 150 }, { x: 230, y: 80 },   { x: 150, y: 40 },
    ],
    path: 'M150,40 Q50,40 50,150 Q50,260 150,260 Q250,260 250,150 Q250,40 150,40 Z',
  },
  // Big line down, back to the top, curve around to the middle.
  P: {
    waypoints: [
      { x: 70, y: 40 },   { x: 70, y: 260 },
      { x: 70, y: 40 },   { x: 180, y: 50 },
      { x: 220, y: 100 }, { x: 180, y: 150 },  { x: 70, y: 160 },
    ],
    path: 'M70,40 L70,260 M70,40 Q240,40 240,100 Q240,160 70,160',
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
  // Big line down, back to the top, curve to the middle, then slant to the corner.
  R: {
    waypoints: [
      { x: 70, y: 40 },   { x: 70, y: 260 },
      { x: 70, y: 40 },   { x: 180, y: 50 },
      { x: 220, y: 100 }, { x: 180, y: 150 },  { x: 70, y: 160 },
      { x: 230, y: 260 },
    ],
    path: 'M70,40 L70,260 M70,40 Q240,40 240,100 Q240,160 70,160 L230,260',
  },
  S: {
    waypoints: [
      { x: 220, y: 70 },  { x: 160, y: 40 },   { x: 80, y: 70 },
      { x: 70, y: 110 },  { x: 150, y: 150 },   { x: 230, y: 190 },
      { x: 220, y: 230 }, { x: 150, y: 260 },   { x: 70, y: 230 },
    ],
    path: 'M220,70 Q150,20 80,70 Q50,120 150,150 Q250,180 220,230 Q170,280 70,230',
  },
  // Big line down, then the little line across the top.
  T: {
    waypoints: [
      { x: 150, y: 40 },  { x: 150, y: 260 },
      { x: 50, y: 40 },   { x: 250, y: 40 },
    ],
    path: 'M150,40 L150,260 M50,40 L250,40',
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
  // Slant down to the middle, slant down to the middle, then big line down.
  Y: {
    waypoints: [
      { x: 50, y: 40 },   { x: 150, y: 150 },
      { x: 250, y: 40 },  { x: 150, y: 150 },  { x: 150, y: 260 },
    ],
    path: 'M50,40 L150,150 M250,40 L150,150 L150,260',
  },
  Z: {
    waypoints: [
      { x: 60, y: 40 },   { x: 240, y: 40 },   { x: 60, y: 260 },
      { x: 240, y: 260 },
    ],
    path: 'M60,40 L240,40 L60,260 L240,260',
  },
};

// ── Trace guidance: hand pointer + direction arrows ────────────────────────
/* Base size of the hand pointer in SVG units (the canvas is 300x300). The art
   below is drawn ~170 units tall with the fingertip at the origin, so this
   scale puts the fingertip on the target with a hand about 50 units tall. */
const HAND_SCALE = 0.32;
/* The same hand over the whole viewport (Find & Type). Bigger, because it is
   measured in screen pixels rather than in the 300-unit trace canvas. */
const GLOBAL_HAND_SCALE = 0.62;
/* Radius of the dwell-to-click ring drawn around the fingertip, and its
   circumference, in the hand's own coordinates. */
const DWELL_R = 26;
const DWELL_C = 2 * Math.PI * DWELL_R;

/* The "start here" hint: the same hand, ghosted, resting on the next waypoint.
   It is only shown while the child's real hand is not being tracked, so there
   is never more than one hand on the canvas. The rotation is picked so the
   hand always has room inside the 300x300 canvas. */
function HandHint({ x, y }) {
  const rot = y <= 200 ? 0 : x <= 150 ? 205 : 155;
  return (
    <g className="tt-hand-hint" transform={`translate(${x} ${y}) rotate(${rot}) scale(${HAND_SCALE})`} pointerEvents="none">
      <HandArt />
    </g>
  );
}

/* A double chevron sitting on a stroke, rotated to show which way to move.
   `state` is 'active' (the stroke being traced now) or 'next' (still ahead).
   A jump is a pen lift, so it is drawn hollow and in the "lift" colour. */
function DirectionArrow({ from, to, state, isJump }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 26) return null; // too short to place a readable arrow

  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  // Sit slightly past the midpoint so the arrow leads the child forward.
  const t = 0.55;
  const cx = from.x + dx * t;
  const cy = from.y + dy * t;

  return (
    <g
      className={`tt-trace-arrow ${state} ${isJump ? 'jump' : ''}`}
      transform={`translate(${cx} ${cy}) rotate(${angle})`}
      pointerEvents="none"
    >
      {/* inner group carries the CSS animation: a CSS transform on the outer
          group would override its transform attribute and move the arrow */}
      <g className="tt-trace-arrow-anim">
        {/* a pen lift gets a dashed shaft instead of the second chevron, so
            "slide along" and "lift and move" never look alike */}
        <path d="M-26,0 H-6" className="tt-trace-arrow-shaft" />
        <path d="M-13,-8 L-4,0 L-13,8" className="tt-trace-arrow-head trail" />
        <path d="M-1,-9 L9,0 L-1,9" className="tt-trace-arrow-head" />
      </g>
    </g>
  );
}

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

// ═══════════════════════════════════════════════════════════════════════════// ════════════════════════════════════════════════════════════════════════════
//                              RULES MODAL
// ════════════════════════════════════════════════════════════════════════════
const RULES = [
  { icon: '✏️', text: 'TRACE — put your index finger on the pointing hand, then follow the arrows.' },
  { icon: '⚡', text: 'Stay close to the line: the further you drift, the lower your accuracy.' },
  { icon: '🔍', text: 'FIND — spot the same letter on the keyboard and press it.' },
  { icon: '⌨️', text: 'TYPE — press that letter 3 times on your own, without the hint.' },
  { icon: '❌', text: 'Wrong keys do not end the round, but they cost you accuracy points.' },
  { icon: '⏱️', text: 'Work at a calm, steady pace — smoothness counts as much as speed.' },
  { icon: '⏸️', text: 'You can pause at any time; pauses are tracked, not punished.' },
];

function RulesModal({ level, onStart }) {
  return (
    <motion.div
      className="tt-rules-overlay"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        className="tt-rules-card"
        initial={{ scale: 0.88, y: 30, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 22 }}
      >
        <div className="tt-rules-head">
          <div className="tt-rules-badge">✏️</div>
          <div>
            <h2 className="tt-rules-title">Trace → Find → Type</h2>
            <p className="tt-rules-sub">Level {level} · 3 steps for every letter</p>
          </div>
        </div>

        <ul className="tt-rules-list">
          {RULES.map((r, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: -18 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.12 + i * 0.07 }}
            >
              <span className="tt-rule-icon">{r.icon}</span>
              <span>{r.text}</span>
            </motion.li>
          ))}
        </ul>

        <div className="tt-rules-ot">
          <strong>OT Score</strong> = Trace accuracy 30% · Smoothness 20% ·
          Letter search 20% · Typing accuracy 20% · Speed 10%
        </div>

        <button className="tt-rules-start" onClick={onStart}>
          <Play size={20} /> Let&apos;s go!
        </button>
      </motion.div>
    </motion.div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
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
  const [gamePhase, setGamePhase]       = useState(
    () => (sessionStorage.getItem(RULES_FLAG) ? 'inputSelection' : 'rules')
  ); // rules | inputSelection | waiting | playing | letterSuccess | results
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
  // ── OT: pause accounting ──────────────────────────────────────────
  useEffect(() => {
    const ot = otRef.current;
    if (isPaused) {
      ot.pauses += 1;
      ot.pauseStartedAt = Date.now();
      /* Drop the motion history: the gap across a pause is not real movement
         and would otherwise register as one huge jerk spike. */
      ot.lastPos = ot.lastVel = ot.lastAcc = ot.lastT = null;
    } else if (ot.pauseStartedAt) {
      ot.pauseMs += Date.now() - ot.pauseStartedAt;
      ot.pauseStartedAt = null;
    }
  }, [isPaused]);

  // ── OT: session clock starts with the first playing frame ───────────────
  useEffect(() => {
    if (gamePhase === 'playing' && otRef.current.startedAt == null) {
      otRef.current.startedAt = Date.now();
    }
  }, [gamePhase]);

  const timerRef = useRef(null);

  // ── Per-letter metrics ──────────────────────────────────────────────────
  const [letterMetrics, setLetterMetrics] = useState({});
  const letterStartTimeRef = useRef(Date.now());

  // ── Trace state ─────────────────────────────────────────────────────────
  const [reachedWaypoints, setReachedWaypoints] = useState([]);
  const [traceProgress, setTraceProgress]       = useState(0);
  const [isDrawing, setIsDrawing]               = useState(false);
  /* Is the child's hand currently on the canvas? Only used to decide whether
     to show the ghosted "start here" hand, so it flips at most twice a second
     rather than on every frame. */
  const [handVisible, setHandVisible] = useState(false);

  /* ── Hand pointer motion ────────────────────────────────────────────────
     The pointer is driven straight from the tracked landmarks on a rAF loop
     and written onto the DOM node, never through React state: re-rendering
     this screen 30x a second would make the hand stutter. `handTargetRef` is
     where tracking writes, `handShownRef` is the smoothed value on screen. */
  const handGroupRef  = useRef(null);
  /* Camera pointer conditioning — see src/utils/handPointerFilter.js. One
     filter for the whole screen: trace, find and type never run at the same
     time, so sharing it means the reach centre learned while the child traces
     is still there when they move to the keyboard. */
  const handFilterRef = useRef(null);
  if (!handFilterRef.current) handFilterRef.current = createHandPointerFilter();
  const handTargetRef = useRef({ x: 150, y: 150, rot: 0, scale: HAND_SCALE, flip: 1, on: 0 });
  const handShownRef  = useRef({ x: 150, y: 150, rot: 0, scale: HAND_SCALE, flip: 1, on: 0 });
  const traceAreaRef = useRef(null);

  /* ── Global pointer (Find & Type) ────────────────────────────────────────
     The same hand, over the whole viewport this time, so the child points at
     the keys with the pointer they already learned to use while tracing.
     Driven the same way: tracking writes to the target ref, the rAF loop below
     eases the on-screen value towards it and writes the transform onto the DOM
     node. `gDwellRef` carries the dwell-to-click progress so the ring around
     the fingertip can be updated without re-rendering the screen. */
  const gHandGroupRef  = useRef(null);
  const gDwellRingRef  = useRef(null);
  const gDwellRef      = useRef(0);
  const gHandTargetRef = useRef({ x: 0, y: 0, rot: 0, scale: GLOBAL_HAND_SCALE, flip: 1, on: 0 });
  const gHandShownRef  = useRef({ x: 0, y: 0, rot: 0, scale: GLOBAL_HAND_SCALE, flip: 1, on: 0 });
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

  // ── OT scoring ─────────────────────────────────────────────────
  /* Every raw measurement lives in a ref so the per-frame tracing loop never
     triggers a re-render. It is turned into scores once, at the end. */
  const otRef = useRef(makeOTAccumulator());
  const [otResults, setOtResults] = useState(null);

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

      /* The OT composite is the headline number for therapists; the raw
         tracing average is kept as the fallback if scoring never ran. */
      const otScore = otResults?.composite ?? avgAcc;

      api.post('/sessions/end', {
        session_id: currentSessionId,
        duration_seconds: durationSeconds,
        accuracy_score: parseFloat((otScore / 100).toFixed(2)),
        accuracy: otScore,
        perfect_grabs: sessionStats.lettersCompleted,
        total_attempts: letters.length,
        game_name: 'Trace Find Type',
        metrics: otResults ? {
          otScore: otResults.composite,
          traceAccuracy: otResults.traceAccuracy,
          smoothness: otResults.smoothness,
          findEfficiency: otResults.findEfficiency,
          typingAccuracy: otResults.typingAccuracy,
          speedScore: otResults.speedScore,
          meanDeviation: otResults.meanDeviation,
          wrongKeys: otResults.wrongKeys,
          reactionMs: otResults.reactionMs,
          pauses: otResults.pauses,
        } : undefined,
      }).then(() => {
        storeEndSession({
          duration: durationSeconds,
          accuracy: otScore,
          perfectGrabs: sessionStats.lettersCompleted,
        });
      }).catch((err) => console.error('[TraceTypeGame] Failed to save session:', err));
    }
  }, [gamePhase, currentSessionId, sessionSaved, sessionStats, letters.length, gameStartTime, storeEndSession, otResults]);

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
    otRef.current.findTaps += 1;

    if (key === currentLetter) {
      setKeyStates((prev) => ({ ...prev, [key]: 'correct' }));
      if (soundEnabled) soundManager.playProgress();
      const findTime = findStartTime ? (Date.now() - findStartTime) / 1000 : 1;
      handleStepComplete('find', { findTime, keyTaps: keyTaps + 1 });
    } else {
      otRef.current.findWrong += 1;
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

    otRef.current.typeTaps += 1;

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
      otRef.current.typeWrong += 1;
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
      gHandTargetRef.current.on = 0;
      gDwellRef.current = 0;
      hoverTargetRef.current = null;
      hoverStartTimeRef.current = null;
      handFilterRef.current.lost();
      return;
    }
    if (!landmarks || landmarks.length < 18) {
      gHandTargetRef.current.on = 0;
      gDwellRef.current = 0;
      handFilterRef.current.lost();
      return;
    }

    const indexTip = landmarks[8];
    const indexMcp = landmarks[5];
    const littleMcp = landmarks[17];
    const wrist = landmarks[0];
    if (!indexTip || !indexMcp) return;

    /* Map to the viewport through the shared filter. This pointer had no
       smoothing at all before, which is why a dwell on a key was hard to hold
       from any distance: the raw fingertip wanders by several pixels a frame,
       and the further back the child sat the less of the keyboard they could
       reach in the first place. */
    const p = handFilterRef.current.push(landmarks);
    if (!p) return;
    const sx = p.x * window.innerWidth;
    const sy = p.y * window.innerHeight;

    /* Same orientation maths as the tracing pointer: the knuckle→tip vector
       gives the direction the finger points, and the side the little finger
       falls on tells us whether to mirror the hand.
       Measured from the RAW landmarks, not from the filtered position: the
       filter moves the fingertip and not the knuckle, so mixing the two
       would swing the drawn hand's heading as the gain changed. */
    const rx = (1 - indexTip.x) * window.innerWidth;
    const ry = indexTip.y * window.innerHeight;
    const kx = (1 - indexMcp.x) * window.innerWidth;
    const ky = indexMcp.y * window.innerHeight;
    const dx = rx - kx;
    const dy = ry - ky;
    const gt = gHandTargetRef.current;

    if (Math.hypot(dx, dy) > 8) {
      gt.rot = steadyAngle(gt.rot, (Math.atan2(dy, dx) * 180) / Math.PI + 90);
      if (littleMcp) {
        const cross = dx * (littleMcp.y * window.innerHeight - ky)
                    - dy * ((1 - littleMcp.x) * window.innerWidth - kx);
        gt.flip = cross > 0 ? 1 : -1;
      }
    }
    if (wrist) {
      /* Depth from the palm measurement the filter already made, which does
         not change meaning with the window's aspect ratio. */
      gt.scale = Math.max(0.45, Math.min(0.9, GLOBAL_HAND_SCALE * handDepthScale(p.span)));
    }
    gt.x = sx;
    gt.y = sy;
    gt.on = 1;

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

    gDwellRef.current = clickProgress;
  }, [landmarks, step, gamePhase, isPaused, handleFindKeyPress, handleTypeKeyPress]);

  // ══════════════════════════════════════════════════════════════════════════
  // Step Completion Handler
  // ══════════════════════════════════════════════════════════════════════════

  /* Turns the raw accumulators into the five OT sub-scores and the composite.
     Called once, when the last letter is finished. */
  const computeOTResults = useCallback(() => {
    const ot = otRef.current;
    // Paused time is excluded so a child who stops for a drink is not penalised.
    const activeMs = Math.max(1, Date.now() - (ot.startedAt || Date.now()) - ot.pauseMs);

    // 1. Trace accuracy — how close to the letter the fingertip stayed.
    const meanDist    = ot.traceSamples ? ot.traceDistSum / ot.traceSamples : 0;
    const onPathRatio = ot.traceSamples ? ot.traceOnPath  / ot.traceSamples : 1;
    const traceAccuracy = clamp01(
      onPathRatio * 0.6 + clamp01(1 - meanDist / TRACE_TOLERANCE) * 0.4
    ) * 100;

    // 2. Smoothness — low mean jerk means controlled, non-shaky movement.
    const meanJerk  = ot.jerkCount ? ot.jerkSum / ot.jerkCount : 0;
    const smoothness = clamp01(1 - meanJerk / JERK_CAP) * 100;

    // 3. Letter search — one tap per letter is a perfect visual search.
    const findEfficiency = ot.findTaps
      ? clamp01(letters.length / ot.findTaps) * 100 : 100;

    // 4. Typing accuracy — share of correct key presses in the TYPE step.
    const typingAccuracy = ot.typeTaps
      ? clamp01((ot.typeTaps - ot.typeWrong) / ot.typeTaps) * 100 : 100;

    // 5. Speed — measured against a per-level reference pace, never above 100.
    const refMs = (LEVEL_REF_SEC[level] || 20) * 1000 * letters.length;
    const speedScore = clamp01(refMs / activeMs) * 100;

    const composite = Math.round(
      traceAccuracy   * 0.30 +
      smoothness      * 0.20 +
      findEfficiency  * 0.20 +
      typingAccuracy  * 0.20 +
      speedScore      * 0.10
    );

    return {
      composite,
      traceAccuracy:  Math.round(traceAccuracy),
      smoothness:     Math.round(smoothness),
      findEfficiency: Math.round(findEfficiency),
      typingAccuracy: Math.round(typingAccuracy),
      speedScore:     Math.round(speedScore),
      meanDeviation:  Math.round(meanDist),
      wrongKeys:      ot.findWrong + ot.typeWrong,
      reactionMs: (ot.firstMoveAt && ot.startedAt) ? ot.firstMoveAt - ot.startedAt : null,
      activeSec: activeMs / 1000,
      pauses:    ot.pauses,
      pauseMs:   ot.pauseMs,
    };
  }, [letters.length, level]);

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
          handTargetRef.current.on = 0;
          setKeyStates({});
          setTypedCount(0);
          letterStartTimeRef.current = Date.now();
          setGamePhase('playing');
        } else {
          // All letters done
          if (soundEnabled) soundManager.playCelebration();
          setOtResults(computeOTResults());
          setGamePhase('results');
        }
      }, 2200);
    }
  }, [currentLetter, currentLetterIdx, letters.length, soundEnabled, computeOTResults]);

  /* Feeds one fingertip position into the OT accumulators: how far it sits
     from the stroke being traced, and how jerky the movement is. Runs on every
     tracked frame, so it only touches refs — never state. */
  const recordTraceSample = useCallback((sx, sy, waypoints, nextIdx) => {
    const ot = otRef.current;
    const now = performance.now();
    if (ot.firstMoveAt == null) ot.firstMoveAt = Date.now();

    /* Path error. Segments flagged in BAD_JUMPS are pen lifts between strokes
       (the crossbar of A, the tail of Q): the child is *supposed* to travel off
       the letter there, so those frames are not scored. */
    const isJump = (BAD_JUMPS[currentLetter] || []).includes(nextIdx);
    if (nextIdx < waypoints.length && !isJump) {
      const target = waypoints[nextIdx];
      const prev   = nextIdx > 0 ? waypoints[nextIdx - 1] : target;
      const d = distToSegment(sx, sy, prev, target);
      ot.traceSamples  += 1;
      ot.traceDistSum  += d;
      ot.letterSamples  = (ot.letterSamples || 0) + 1;
      ot.letterDistSum  = (ot.letterDistSum || 0) + d;
      if (d <= TRACE_TOLERANCE) {
        ot.traceOnPath += 1;
        ot.letterOnPath = (ot.letterOnPath || 0) + 1;
      }
    }

    /* Smoothness: jerk is the third derivative of position. Frame gaps that are
       implausibly short (duplicate frame) or long (tracking stall) would produce
       meaningless spikes, so they reset the motion history instead. */
    const dt = ot.lastT == null ? null : (now - ot.lastT) / 1000;
    if (dt == null || dt >= 0.25) {
      ot.lastPos = { x: sx, y: sy };
      ot.lastT = now;
      ot.lastVel = null;
      ot.lastAcc = null;
      return;
    }
    if (dt <= 0.008) return;

    const vel = { x: (sx - ot.lastPos.x) / dt, y: (sy - ot.lastPos.y) / dt };
    if (ot.lastVel) {
      const acc = { x: (vel.x - ot.lastVel.x) / dt, y: (vel.y - ot.lastVel.y) / dt };
      if (ot.lastAcc) {
        ot.jerkSum += Math.hypot((acc.x - ot.lastAcc.x) / dt, (acc.y - ot.lastAcc.y) / dt);
        ot.jerkCount += 1;
      }
      ot.lastAcc = acc;
    }
    ot.lastVel = vel;
    ot.lastPos = { x: sx, y: sy };
    ot.lastT = now;
  }, [currentLetter]);

  const processTracePosition = useCallback((sx, sy) => {
    if (step !== 'trace' || gamePhase !== 'playing' || isPaused) return;

    // Check waypoint proximity
    const waypoints = letterData?.waypoints;
    if (!waypoints) return;

    const newReached = [...reachedWaypoints];
    const nextIdx = newReached.length;

    recordTraceSample(sx, sy, waypoints, nextIdx);

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
          /* Real accuracy for THIS letter, from the frames just recorded. */
          const ot = otRef.current;
          const n  = ot.letterSamples || 0;
          const accuracy = n
            ? Math.round(clamp01(
                (ot.letterOnPath / n) * 0.6 +
                clamp01(1 - (ot.letterDistSum / n) / TRACE_TOLERANCE) * 0.4
              ) * 100)
            : 100;
          ot.letterSamples = 0; ot.letterOnPath = 0; ot.letterDistSum = 0;
          handleStepComplete('trace', { accuracy });
        }
      }
    }
  }, [step, gamePhase, isPaused, letterData, reachedWaypoints, soundEnabled,
      handleStepComplete, recordTraceSample]);

  /* Hide the pointer (it fades out rather than vanishing). */
  const hideHand = useCallback(() => {
    handTargetRef.current.on = 0;
    setHandVisible((v) => (v ? false : v));
  }, []);

  // Touch/Mouse Support for Trace Phase
  const handlePointerEvent = (e) => {
    if (e.type === 'pointermove' && !isDrawing) return;
    if (step !== 'trace' || gamePhase !== 'playing' || isPaused) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * 300;
    const sy = ((e.clientY - rect.top) / rect.height) * 300;

    // Touch input has no hand orientation, so the pointer stays upright.
    const t = handTargetRef.current;
    t.x = sx; t.y = sy; t.rot = 0; t.scale = HAND_SCALE; t.flip = 1; t.on = 1;
    setHandVisible((v) => (v ? v : true));

    processTracePosition(sx, sy);
  };

  /* Map the tracked hand onto the canvas: the index fingertip gives the
     position, the knuckle→tip vector gives the direction the finger is
     pointing, the wrist→knuckle span gives a little depth (the hand grows as
     the child reaches toward the camera) and the index/little-finger order
     tells us which way round the hand is, so a left hand is not drawn as a
     right one. */
  useEffect(() => {
    if (step !== 'trace' || gamePhase !== 'playing' || isPaused) {
      hideHand();
      handFilterRef.current.lost();
      return;
    }
    if (!landmarks || landmarks.length < 18) {
      if (!isDrawing) hideHand(); // only clear if not actively using touch
      handFilterRef.current.lost();
      return;
    }

    const indexTip = landmarks[8];   // index fingertip
    const indexMcp = landmarks[5];   // index knuckle
    const littleMcp = landmarks[17]; // little-finger knuckle
    const wrist    = landmarks[0];
    if (!indexTip || !indexMcp) return;

    /* Position through the shared filter, so the letter is the same size to
       trace whether the child is close to the camera or sitting back. */
    const p = handFilterRef.current.push(landmarks);
    if (!p) return;
    const sx = p.x * 300;
    const sy = p.y * 300;

    /* Heading from the RAW landmarks: the filter moves the fingertip and not
       the knuckle, so measuring the finger direction across the two would
       swing the drawn hand as the gain changed. */
    const rx = (1 - indexTip.x) * 300; // mirror
    const ry = indexTip.y * 300;
    const kx = (1 - indexMcp.x) * 300;
    const ky = indexMcp.y * 300;

    const dx = rx - kx;
    const dy = ry - ky;
    const t = handTargetRef.current;

    /* The art points along -y, so a finger pointing straight up needs no
       rotation: atan2 gives -90 there, hence the +90. */
    if (Math.hypot(dx, dy) > 6) {
      t.rot = steadyAngle(t.rot, (Math.atan2(dy, dx) * 180) / Math.PI + 90);

      /* Which side is the little finger on, relative to the pointing
         direction? The art is drawn with the curled fingers on the right, so
         a negative cross product means we mirror it across the finger. */
      if (littleMcp) {
        const cross = dx * (littleMcp.y * 300 - ky) - dy * ((1 - littleMcp.x) * 300 - kx);
        t.flip = cross > 0 ? 1 : -1;
      }
    }

    if (wrist) {
      t.scale = Math.max(0.24, Math.min(0.44, HAND_SCALE * handDepthScale(p.span)));
    }

    t.x = sx;
    t.y = sy;
    t.on = 1;
    setHandVisible((v) => (v ? v : true));

    processTracePosition(sx, sy);
  }, [landmarks, step, gamePhase, isPaused, processTracePosition, isDrawing, hideHand]);

  /* Smoothing loop. Tracking arrives at ~30fps and jitters by a pixel or two;
     easing towards the target on every animation frame turns that into the
     continuous, natural movement a child can actually follow. */
  useEffect(() => {
    let raf = 0;

    const tick = () => {
      followHand(handTargetRef.current, handShownRef.current, handGroupRef.current);
      followHand(gHandTargetRef.current, gHandShownRef.current, gHandGroupRef.current);

      // Dwell-to-click ring around the fingertip, on the keyboard steps.
      const ring = gDwellRingRef.current;
      if (ring) {
        ring.style.strokeDashoffset = (DWELL_C * (1 - gDwellRef.current)).toFixed(2);
        ring.style.opacity = gDwellRef.current > 0.01 ? '0.95' : '0';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

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

              {otResults && (
                <div className="tt-ot-block">
                  <div className="tt-perf-ring" style={{ '--pct': otResults.composite }}>
                    <div className="tt-perf-inner">
                      <span className="tt-perf-val">{otResults.composite}</span>
                      <span className="tt-perf-lbl">OT Score</span>
                    </div>
                  </div>
                  <div className="tt-ot-bars">
                    {[
                      ['Trace accuracy', otResults.traceAccuracy, '30%'],
                      ['Smoothness',     otResults.smoothness,     '20%'],
                      ['Letter search',  otResults.findEfficiency, '20%'],
                      ['Typing accuracy',otResults.typingAccuracy, '20%'],
                      ['Speed',          otResults.speedScore,     '10%'],
                    ].map(([label, value, weight]) => (
                      <div className="tt-ot-bar" key={label}>
                        <div className="tt-ot-bar-head">
                          <span>{label} <em>{weight}</em></span>
                          <strong>{value}%</strong>
                        </div>
                        <div className="tt-ot-bar-track">
                          <motion.div
                            className="tt-ot-bar-fill"
                            initial={{ width: 0 }}
                            animate={{ width: `${value}%` }}
                            transition={{ duration: 0.7, delay: 0.3 }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
                {otResults && (
                  <>
                    <div className="tt-results-stat">
                      <div className="tt-results-stat-icon">〰️</div>
                      <div className="tt-results-stat-value">{otResults.meanDeviation}px</div>
                      <div className="tt-results-stat-label">Avg. deviation</div>
                    </div>
                    <div className="tt-results-stat">
                      <div className="tt-results-stat-icon">❌</div>
                      <div className="tt-results-stat-value">{otResults.wrongKeys}</div>
                      <div className="tt-results-stat-label">Wrong keys</div>
                    </div>
                    <div className="tt-results-stat">
                      <div className="tt-results-stat-icon">⚡</div>
                      <div className="tt-results-stat-value">
                        {otResults.reactionMs == null
                          ? '—'
                          : `${(otResults.reactionMs / 1000).toFixed(2)}s`}
                      </div>
                      <div className="tt-results-stat-label">Reaction time</div>
                    </div>
                    <div className="tt-results-stat">
                      <div className="tt-results-stat-icon">⏸️</div>
                      <div className="tt-results-stat-value">
                        {otResults.pauses} · {(otResults.pauseMs / 1000).toFixed(0)}s
                      </div>
                      <div className="tt-results-stat-label">Pauses</div>
                    </div>
                  </>
                )}
              </div>

              <div className="tt-results-actions">
                <motion.button
                  className="tt-results-btn primary"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    setGamePhase(inputMethod === 'touch' ? 'playing' : 'waiting');
                    setCountdown(0);
                    setCurrentLetterIdx(0);
                    setStep('trace');
                    setScore(0);
                    setElapsedTime(0);
                    setReachedWaypoints([]);
                    setTraceProgress(0);
                    setTypedCount(0);
                    setKeyStates({});
                    handTargetRef.current.on = 0;
                    setStarRatings({});
                    setSessionStats({
                      totalScore: 0, lettersCompleted: 0, totalStars: 0,
                      tracingAccuracies: [], findTimes: [], typingAccuracies: [],
                    });
                    setCurrentSessionId(null);
                    setSessionSaved(false);
                    otRef.current = makeOTAccumulator();
                    setOtResults(null);
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
      <AnimatePresence>
        {gamePhase === 'rules' && (
          <RulesModal
            key="rules"
            level={level}
            onStart={() => {
              /* Remembered per tab: replaying does not re-show the rules,
                 but a fresh visit always does. */
              sessionStorage.setItem(RULES_FLAG, '1');
              if (soundEnabled) soundManager.playProgress();
              setGamePhase('inputSelection');
            }}
          />
        )}
      </AnimatePresence>
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
                  <div className="tt-step-instruction">Start at the hand and follow the arrows with your index finger.</div>
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
                  hideHand();
                }}
                onPointerCancel={(e) => {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                  setIsDrawing(false);
                  hideHand();
                }}
                style={{ touchAction: 'none' }}
              >
                {/* the hand's gradients and clip live in the overlay SVG at the
                    bottom of this component — one definition, referenced by
                    both pointers */}
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
                {/* Direction arrows — they replace the old step numbers. Each
                    arrow sits on the stroke and points the way the finger has
                    to travel; a hollow arrow means "lift and move" (new stroke). */}
                {letterData.waypoints.map((wp, i) => {
                  if (i === 0) return null;
                  if (i < reachedWaypoints.length) return null; // already traced
                  const isJump = (BAD_JUMPS[currentLetter] || []).includes(i);
                  return (
                    <DirectionArrow
                      key={`arrow-${i}`}
                      from={letterData.waypoints[i - 1]}
                      to={wp}
                      state={i === reachedWaypoints.length ? 'active' : 'next'}
                      isJump={isJump}
                    />
                  );
                })}

                {letterData.waypoints.map((wp, i) => {
                  const isReached = reachedWaypoints.includes(i);
                  const isActive = i === reachedWaypoints.length;

                  return (
                    <g key={i} className="tt-trace-waypoint">
                      {/* the target the finger is heading for glows softly —
                          a halo rather than a hard ring, so it never reads as
                          a cursor competing with the hand */}
                      {isActive && (
                        <circle cx={wp.x} cy={wp.y} r={26} className="tt-trace-target-glow" fill="url(#ttTargetG)" />
                      )}
                      <circle
                        cx={wp.x}
                        cy={wp.y}
                        r={isActive ? 7 : 9}
                        className={`tt-trace-waypoint-circle ${isReached ? 'reached' : ''} ${isActive ? 'active' : ''}`}
                      />
                    </g>
                  );
                })}

                {/* "Start here" hint — only while the child's own hand is not
                    on the canvas, so there is never a second hand competing
                    with the live pointer. */}
                {!handVisible && reachedWaypoints.length < letterData.waypoints.length && (
                  <HandHint
                    x={letterData.waypoints[reachedWaypoints.length].x}
                    y={letterData.waypoints[reachedWaypoints.length].y}
                  />
                )}

                {/* The live pointer. Its transform is written straight to the
                    DOM by the smoothing loop, so it tracks the real hand
                    frame-by-frame instead of re-rendering the screen. */}
                <g ref={handGroupRef} className="tt-hand-pointer" pointerEvents="none">
                  <HandArt />
                </g>
              </svg>
              <div className="tt-camera-container" style={{ visibility: 'hidden', opacity: 0, position: 'absolute', pointerEvents: 'none' }}>
                <video ref={videoRef} playsInline autoPlay muted />
                <canvas ref={canvasRef} />
              </div>
            </div>
            <div className={`tt-trace-feedback ${traceProgress > 0 ? 'on-path' : ''}`} style={{ textCombineUpright: 'none' }}>
              {traceProgress > 0 ? `${Math.round(traceProgress * 100)}% complete — follow the arrow!` : isTracking ? 'Point your index finger at the glowing spot' : 'Initializing camera...'}
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
                    className="tt-find-target"
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

      {/* ── Global pointer overlay (Find & Type) ──────────────────────
          The same hand as the tracing step, over the whole viewport, with the
          dwell-to-click ring drawn around its fingertip. Both the transform and
          the ring are written by the animation loop, so the pointer keeps up
          with the camera without re-rendering the screen. */}
      <svg
        className="tt-global-pointer"
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          width: '100vw',
          height: '100vh',
          pointerEvents: 'none',
          zIndex: 9999,
          overflow: 'visible',
        }}
      >
        <HandDefs />
        <g ref={gHandGroupRef} className="tt-hand-pointer">
          <HandArt />
          {/* dwell-to-click progress, sweeping around the fingertip */}
          <circle
            cx="0" cy="4" r={DWELL_R}
            fill="none"
            stroke="#A5FFF4"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={DWELL_C}
            transform="rotate(-90 0 4)"
            className="tt-dwell-ring"
            ref={gDwellRingRef}
          />
        </g>
      </svg>

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

