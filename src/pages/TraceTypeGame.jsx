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
  Hand, MousePointer2, HelpCircle
} from 'lucide-react';
import useHandTracking from '../hooks/useHandTracking';
import { useTextToSpeech } from '../hooks/useTextToSpeech';
import { soundManager } from '../utils/soundManager';
import EndGameControl from '../components/game/EndGameControl';
import { useAuthStore, useSessionStore } from '../store';
import api from '../services/api';
import '../styles/TraceTypeGame.css';
import '../styles/GameShell.css';

import { HandDefs, HandArt, followHand } from '../components/game/HandPointer';
import { createHandPointerFilter, handDepthScale } from '../utils/handPointerFilter';
import { buildRound, traceTuning } from './traceTypeWords';
import { buildLetter } from './letterStrokes';
import GameRules from '../components/game/GameRules';
import { getGameTheme, toggleGameTheme, subscribeGameTheme } from '../components/game/gameShell';
// ── Constants ──────────────────────────────────────────────────────────────
const COUNTDOWN_SECONDS = 3;
/* Client feedback: "Type shows the letter 3 times - why is that?"
   Because the old build asked for three presses of the same key, which taught
   nothing and broke the illusion of building a word. One press is enough — the
   round is now a WORD, and the repetition comes from the word's own letters.
   See traceTypeWords.js for the round model. */
const TYPE_REQUIRED      = 1;   // one correct press completes the Type step
/* Default only — the live value comes from traceTuning(levelKey), so Easy is
   genuinely easy in the air. Client feedback: "i struggled with the tracing in
   air... very tricky even with easy level! so had to use the mouse throughout". */
const TRACE_WAYPOINT_RADIUS = 25; // px radius to count as "reached"
const WORDS_PER_ROUND = 3;        // a session is 3 complete words
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
    /* Letters fully finished (trace + find + type). Mirrors
       sessionStats.lettersCompleted, but on the ref, because computeOTResults
       runs outside React state and must know how much was actually attempted:
       every OT sub-score is scored against what was DONE, never against the
       whole word. */
    lettersCompleted: 0,
  };
}

// ── Letters per level ──────────────────────────────────────────────────────
const LEVEL_LETTERS = {
  1: 'LVXTIFEH'.split(''), // Simple straight lines, fewer points
  2: 'AMNKOPUYZCD'.split(''), // Moderate complexity, simple curves or angled lines
  3: 'QSRGJWB'.split(''), // High complexity, multiple curves or strokes
};

/* Letter geometry now lives in ./letterStrokes.js.
   The hand-maintained `BAD_JUMPS` index list and `LETTER_DATA` waypoint arrays
   that used to sit here were removed: they were three things kept in sync by
   hand (outline, dots, pen lifts), and the dots for straight strokes were only
   the endpoints — X had 4 dots with 284px gaps in a 300px box, so a child could
   "trace" it by touching four corners. buildLetter() derives all three from the
   letter's path at the level's spacing instead. */


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

/* Trace → Find → Type is the REFERENCE design, so its card is now the shared
   one (GameRules) rather than a private copy of the same markup. Keeping a
   duplicate here is how the six games drifted apart in the first place. */
function RulesModal({ level, onStart, resume = false }) {
  return (
    <GameRules
      emoji="✏️"
      title="Trace → Find → Type"
      /* Easy / Medium / Hard everywhere — no more "Level 1/2/3" in one game and
         "Easy/Medium/Hard" in the next. */
      subtitle={`${level === 3 ? 'Hard' : level === 2 ? 'Medium' : 'Easy'} · trace, find and type each letter to spell the word`}
      rules={RULES}
      note={<><strong>OT Score</strong> = Trace accuracy 30% · Smoothness 20% · Letter search 20% · Typing accuracy 20% · Speed 10%</>}
      onStart={onStart}
      resume={resume}
    />
  );
}

// ════════════════════════════════════════════════════════════════════════════
export default function TraceTypeGame() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const level = parseInt(searchParams.get('level') || '1', 10);
  const levelKey = searchParams.get('difficulty')
    || (level === 3 ? 'hard' : level === 2 ? 'medium' : 'easy');

  /* ── A ROUND IS A WORD ──────────────────────────────────────────────────
     Product owner's intent, restated in the client's feedback:

       "say a word like bus is presented where the learner will first start
        with left with tracing B, then finding B in the middle in the keyboard
        and then typing B in the right hand side; … So by the end of this 1
        round they have traced, found and typed all 3 letters and formed a
        complete word BUS."

     `letters` is therefore the letters OF THE WORD, in order. The existing
     per-letter trace → find → type cycle then produces exactly that journey,
     and the word fills in on screen as each letter is typed. */
  const [word, setWord] = useState(() => buildRound(levelKey).word);
  const wordsDoneRef = useRef(0);
  const letters = useMemo(() => word.split(''), [word]);
  const tuning = useMemo(() => traceTuning(levelKey), [levelKey]);

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
  /* Follows the ONE shared theme instead of keeping a private switch. This
     game used to own an `isLightMode` of its own, so its toggle and the toggle
     on every other screen disagreed — the original "this game has an option to
     toggle the theme but others don't" complaint, in a subtler form. Dark is
     the default; `.tt-light-mode` is applied only when the shared theme is
     light. */
  const [gameTheme, setGameTheme_] = useState(getGameTheme);
  useEffect(() => subscribeGameTheme(setGameTheme_), []);
  const isLightMode = gameTheme === 'light';
  const [isPaused, setIsPaused]         = useState(false);
  /* True while the end-game confirmation is on screen. The round is paused
     then, but the PAUSE CARD must stay hidden so only one card shows. */
  const [endAsking, setEndAsking] = useState(false);
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
    releaseCamera,
  } = useHandTracking(videoRef, canvasRef, trackingEnabled, pauseProcessing, 1);

  /* ── Turn the camera off when the session ends ──────────────────────────
     Client feedback: "when the game finish the camera need to turn off."
     `trackingEnabled` already excludes the results screen; this releases the
     MediaStream explicitly so the webcam light goes out immediately. */
  useEffect(() => {
    if (gamePhase === 'results') releaseCamera();
  }, [gamePhase, releaseCamera]);

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
  if (!handFilterRef.current) {
    /* `fitReach` scales each axis to the child's OBSERVED range of motion.
       ---------------------------------------------------------------------
       Client feedback: "the hand pointer still can't roam the whole screen."

       Making the pointer viewport-wide was only half the fix. The fingertip
       position the filter receives is normalised to the CAMERA FRAME, and a
       seated child's comfortable reach covers barely half of it — so at the
       default gain they could only ever get to the middle half of the screen,
       and the corners stayed physically unreachable however far they stretched.
       The camera being 4:3 while the screen is 16:9 made it worse on one axis
       than the other.

       With reach fitting on, the filter measures how far the child actually
       moves and scales each axis independently so that range covers the whole
       window. Bounded by `minReach` / `fitMaxGain`, and eased on the same slow
       time constant as the distance gain, so it never shifts mid-reach.

       Left off for Pop the Bubble and Follow the Ladybug, which the client
       reported as working well — this is opt-in per screen.

       THE TWO OVERRIDES BELOW go with the change of what 0..1 is stretched
       over (see `boundsRef`). The pointer no longer crosses the window, it
       crosses the card — a square of at most 560px — so the numbers that were
       right for a 1400px viewport are not right here.

         `reachTarget` 1.05, up from the global 0.76. Inside a card, "reach the
         whole thing" is what matters: the letter's own waypoints run from 17%
         to 88% across and 13% to 90% down the card, so a child whose reach only
         covered 75% x 66% — which 0.76 gives — could not physically get to the
         top or the bottom of the letter. 1.05 gives 89% x 79%, which clears it.

         `stillEps` 0.012, up from 0.008. The deadband is scaled by the gain in
         use, and that gain is higher here; 0.012 works out at about 15px of the
         card, comfortably inside the ~58px the game accepts as touching a
         waypoint, and it is what takes the held pointer from 5.8 direction
         changes a second down to 2.3.

       Measured, hand held on a target for 4s (webcam noise + a 6Hz tremor):

                                 wander   travel while held   reversals/s
           over the window        37 px       71 px/s             9.8
           in the card (now)      13 px        4 px/s             2.3
    */
    handFilterRef.current = createHandPointerFilter({
      fitReach: true,
      reachTarget: 1.05,
      stillEps: 0.012,
      /* …and `minCutoff` goes back UP to 1.0, against the global 0.6.
         The global value is low because out there the deadband is small and the
         smoothing has to do the stabilising on its own. In here the deadband is
         doing that job already, so the heavy smoothing was buying nothing and
         only costing response. Measured in the card:

                            wander   travel while held   reversals/s   lag
             minCutoff 0.6   13.2px      4 px/s              2.3      167 ms
             minCutoff 1.0   13.5px      4 px/s              1.8      133 ms

         Just as steady, and it stops feeling stuck when the child sets off. */
      minCutoff: 1.0,
    });
  }
  const handTargetRef = useRef({ x: 150, y: 150, rot: 0, scale: HAND_SCALE, flip: 1, on: 0 });
  const handShownRef  = useRef({ x: 150, y: 150, rot: 0, scale: HAND_SCALE, flip: 1, on: 0 });
  const traceAreaRef = useRef(null);
  /* The Find / Type card. Same role as `traceAreaRef` for step 1: it is the
     box the pointer is allowed to move inside. */
  const stepCardRef  = useRef(null);
  /* ── Where the pointer is allowed to go ──────────────────────────────────
     The hand used to be mapped across the whole window. On a laptop that meant
     a card roughly 400px wide sitting inside a 1400px viewport, so the child's
     entire reach was spread over three and a half times more pixels than the
     letter actually occupies — the pointer crossed the card in a flick, and
     every wobble of the hand was magnified by the same factor.

     It is now mapped into the CARD of the step being played: the letter box
     while tracing, the keyboard card while finding and typing. The filter still
     returns 0..1; only what that 0..1 is stretched over changes.

     Two things fall out of it. The pointer cannot leave the card, and the same
     hand tremor now moves it about a third as far in pixels — which is the
     "make it more fixed" half of the request, for free.

     The rect is cached rather than read every frame: the pointer transform is
     written to the DOM on the same rAF tick, and reading a rect after a write
     forces the browser to re-layout each frame. It is refreshed when the step
     changes, when the card resizes, and on scroll. */
  const boundsRef = useRef(null);
  /* The 300x300 tracing SVG. The full-screen pointer maps its viewport
     position back into this element's user space via getScreenCTM(), so the
     hand can roam the whole window and still trace accurately. */
  const traceSvgRef  = useRef(null);
  /* `processTracePosition` is declared further down this component, so the
     full-screen pointer effect above it cannot list it as a dependency
     (the deps array is evaluated during render, before the const exists).
     This always-current ref bridges the gap. */
  const processTraceRef = useRef(null);

  /* Keep `boundsRef` pointing at the card of the step being played. Measured
     here, outside the pointer loop, so the loop never triggers a layout. */
  useEffect(() => {
    const el = step === 'trace' ? traceAreaRef.current : stepCardRef.current;
    if (!el) { boundsRef.current = null; return undefined; }

    const measure = () => {
      const r = el.getBoundingClientRect();
      /* A card with no size yet (mid-transition) would trap the pointer in a
         single pixel, so it is ignored until it has one. */
      boundsRef.current = r.width > 40 && r.height > 40
        ? { left: r.left, top: r.top, width: r.width, height: r.height }
        : null;
    };
    measure();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    /* The Find / Type card arrives with a spring animation, so its rect is
       still moving for the first few hundred milliseconds. */
    const settle = setTimeout(measure, 420);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      clearTimeout(settle);
    };
    /* `currentLetterIdx`, not `currentLetter`: the derived letter is declared
       further down this component, and naming it here would evaluate a const
       in its temporal dead zone during render. The index changes at exactly the
       same moment. */
  }, [step, currentLetterIdx]);

  /* ── Global pointer (Find & Type) ────────────────────────────────────────
     The same hand, inside the card of the step being played, so the child
     points at the keys with the pointer they already learned to use while
     tracing.
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
  /* Waypoints, pen lifts and the outline are all generated from the letter's
     path at this level's spacing (see letterStrokes.js), so they can never
     disagree with each other the way the old hand-maintained LETTER_DATA /
     BAD_JUMPS pair could — and straight strokes get as many dots as curved
     ones, which they did not before. */
  const letterData = useMemo(
    () => buildLetter(currentLetter, tuning.spacing),
    [currentLetter, tuning.spacing]
  );
  const letterJumps = letterData.jumps;

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
  // GLOBAL POINTER Logic (Trace, Find & Type)
  // ──────────────────────────────────────────────────────────────────────────
  // Client feedback: "The hand pointer should be able to move freely across the
  // entire screen, not only inside the letter box area. This improvement should
  // apply to all three activities: Trace, Find, and Type."
  //
  // Find and Type already used this viewport-wide pointer. Trace did not: it
  // mapped the hand with `p.x * 300`, which squeezed the child's ENTIRE range of
  // motion onto the 300x300 letter box — the pointer physically could not leave
  // it. All three steps now share this one pointer, drawn on the fixed
  // full-viewport overlay, and Trace converts the viewport position back into
  // letter-box coordinates only to decide what has been traced.
  // ══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if ((step !== 'trace' && step !== 'find' && step !== 'type') || gamePhase !== 'playing' || isPaused) {
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

    /* `indexMcp` and `wrist` were only needed for the orientation maths that is
       now gone; `indexTip` is still the sanity check that this frame has a
       usable hand before we push it through the filter. */
    const indexTip = landmarks[8];
    const wrist = landmarks[0];
    if (!indexTip) return;

    /* Map to the viewport through the shared filter. This pointer had no
       smoothing at all before, which is why a dwell on a key was hard to hold
       from any distance: the raw fingertip wanders by several pixels a frame,
       and the further back the child sat the less of the keyboard they could
       reach in the first place. */
    const p = handFilterRef.current.push(landmarks);
    if (!p) return;
    /* Stretch the filter's 0..1 over the current step's card (see `boundsRef`).
       Falling back to the window keeps the pointer usable for the one frame
       between a step change and the new rect being measured. */
    const b = boundsRef.current;
    const sx = b ? b.left + p.x * b.width  : p.x * window.innerWidth;
    const sy = b ? b.top  + p.y * b.height : p.y * window.innerHeight;

    /* Orientation is no longer computed: the pointer is always drawn upright.
       The angle a fingertip implies swings several degrees on a one-pixel
       landmark wobble, so the hand rocked constantly, and the little-finger
       cross product could mirror the whole hand mid-reach. Neither moved the
       cursor — the cursor IS the fingertip — so both were noise. The
       touch/mouse pointer was already upright, so the two now match. */
    const gt = gHandTargetRef.current;

    if (wrist) {
      /* Depth from the palm measurement the filter already made, which does
         not change meaning with the window's aspect ratio. */
      gt.scale = Math.max(0.45, Math.min(0.9, GLOBAL_HAND_SCALE * handDepthScale(p.span)));
    }
    gt.x = sx;
    gt.y = sy;
    gt.on = 1;

    /* ── TRACE ────────────────────────────────────────────────────────────
       The pointer roams the whole window (above). To decide what has been
       traced we convert its viewport position back into the letter's own
       300x300 user space with getScreenCTM(), which accounts for the element's
       position, size AND the viewBox's preserveAspectRatio letterboxing — so
       the mapping stays exact at any window size.

       Outside the letter box nothing is recorded: the hand simply moves freely,
       which is the point. */
    if (step === 'trace') {
      setHandVisible((v) => (v ? v : true));

      const svg = traceSvgRef.current;
      const ctm = svg && typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
      if (ctm) {
        const pt = svg.createSVGPoint();
        pt.x = sx;
        pt.y = sy;
        const local = pt.matrixTransform(ctm.inverse());
        /* A small margin outside the box still counts, so a waypoint sitting on
           the very edge of the letter is reachable without pixel-perfect aim. */
        const M = 24;
        if (local.x >= -M && local.x <= 300 + M && local.y >= -M && local.y <= 300 + M) {
          processTraceRef.current?.(local.x, local.y);
        }
      }

      gDwellRef.current = 0;
      hoverTargetRef.current = null;
      hoverStartTimeRef.current = null;
      return;
    }

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
     ------------------------------------------------------------------------
     EVERY SUB-SCORE IS `null` WHEN THERE IS NO DATA FOR IT.

     This used to default each one to its BEST value when the accumulator was
     empty: no trace samples meant `onPathRatio = 1`, no jerk samples meant zero
     jerk, no taps meant no wrong taps, and an unstarted round beat the speed
     reference. Pressing "End game" on the very first screen therefore produced
     a 100/100 OT score next to "You completed 0 letters" — a fabricated
     perfect result in a report a therapist reads.

     Absence of evidence is not a perfect performance. An unmeasured component
     is reported as null ("—" in the UI) and is left out of the composite,
     which is renormalised over the components that DO have data — the same
     rule Pop the Bubble already applies to its path metrics. If nothing at all
     was measured, the composite itself is null. */
  const computeOTResults = useCallback(() => {
    const ot = otRef.current;
    // Paused time is excluded so a child who stops for a drink is not penalised.
    const activeMs = Math.max(1, Date.now() - (ot.startedAt || Date.now()) - ot.pauseMs);
    const lettersDone = ot.lettersCompleted || 0;

    // 1. Trace accuracy — how close to the letter the fingertip stayed.
    const meanDist = ot.traceSamples ? ot.traceDistSum / ot.traceSamples : null;
    const traceAccuracy = ot.traceSamples
      ? clamp01(
          (ot.traceOnPath / ot.traceSamples) * 0.6 +
          clamp01(1 - meanDist / TRACE_TOLERANCE) * 0.4
        ) * 100
      : null;

    // 2. Smoothness — low mean jerk means controlled, non-shaky movement.
    const smoothness = ot.jerkCount
      ? clamp01(1 - (ot.jerkSum / ot.jerkCount) / JERK_CAP) * 100
      : null;

    // 3. Letter search — one tap per letter is a perfect visual search.
    //    Scored against the letters actually ATTEMPTED, not the whole word:
    //    finding 1 letter in 1 tap is 100%, and ending after one letter must
    //    not be judged against three.
    const findEfficiency = (ot.findTaps && lettersDone)
      ? clamp01(lettersDone / ot.findTaps) * 100
      : null;

    // 4. Typing accuracy — share of correct key presses in the TYPE step.
    const typingAccuracy = ot.typeTaps
      ? clamp01((ot.typeTaps - ot.typeWrong) / ot.typeTaps) * 100
      : null;

    // 5. Speed — against the reference pace for the letters actually finished.
    //    Meaningless before the first letter is done: an untouched round would
    //    otherwise "beat" the reference simply by being short.
    const speedScore = lettersDone
      ? clamp01(((LEVEL_REF_SEC[level] || 20) * 1000 * lettersDone) / activeMs) * 100
      : null;

    /* Weighted mean over the measured components only. */
    const parts = [
      [traceAccuracy,  0.30],
      [smoothness,     0.20],
      [findEfficiency, 0.20],
      [typingAccuracy, 0.20],
      [speedScore,     0.10],
    ].filter(([v]) => v != null);

    const weight = parts.reduce((a, [, w]) => a + w, 0);
    const composite = weight > 0
      ? Math.round(parts.reduce((a, [v, w]) => a + v * w, 0) / weight)
      : null;

    const round = (v) => (v == null ? null : Math.round(v));

    return {
      composite,
      traceAccuracy:  round(traceAccuracy),
      smoothness:     round(smoothness),
      findEfficiency: round(findEfficiency),
      typingAccuracy: round(typingAccuracy),
      speedScore:     round(speedScore),
      meanDeviation:  round(meanDist),
      lettersScored:  lettersDone,
      wrongKeys:      ot.findWrong + ot.typeWrong,
      reactionMs: (ot.firstMoveAt && ot.startedAt) ? ot.firstMoveAt - ot.startedAt : null,
      activeSec: activeMs / 1000,
      pauses:    ot.pauses,
      pauseMs:   ot.pauseMs,
    };
  }, [level]);

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

      otRef.current.lettersCompleted += 1;

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
        } else if (wordsDoneRef.current + 1 < WORDS_PER_ROUND) {
          /* The word is complete — start the next one. A session is
             WORDS_PER_ROUND whole words, so the learner always finishes on a
             completed word rather than mid-spelling. */
          wordsDoneRef.current += 1;
          setWord((prev) => buildRound(levelKey, prev).word);
          setCurrentLetterIdx(0);
          setStep('trace');
          setReachedWaypoints([]);
          setTraceProgress(0);
          handTargetRef.current.on = 0;
          setKeyStates({});
          setTypedCount(0);
          letterStartTimeRef.current = Date.now();
          setGamePhase('playing');
        } else {
          // All words done
          if (soundEnabled) soundManager.playCelebration();
          setOtResults(computeOTResults());
          setGamePhase('results');
        }
      }, 2200);
    }
  }, [currentLetter, currentLetterIdx, letters.length, levelKey, soundEnabled, computeOTResults]);

  /* Feeds one fingertip position into the OT accumulators: how far it sits
     from the stroke being traced, and how jerky the movement is. Runs on every
     tracked frame, so it only touches refs — never state. */
  const recordTraceSample = useCallback((sx, sy, waypoints, nextIdx) => {
    const ot = otRef.current;
    const now = performance.now();
    if (ot.firstMoveAt == null) ot.firstMoveAt = Date.now();

    /* Path error. Waypoints that begin a new stroke are pen LIFTS (the crossbar
       of A, the tail of Q): the child is *supposed* to travel off the letter
       there, so those frames are not scored against them. The lift list is
       derived from the letter's strokes — see letterStrokes.js. */
    const isJump = letterJumps.includes(nextIdx);
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
  }, [currentLetter, letterJumps]);

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

      /* Per-level tolerance instead of a fixed 25px. Air tracing with a webcam
         has a few centimetres of wobble that a fixed radius punished on every
         level — the client had to abandon the camera and use the mouse even on
         Easy. Easy now accepts 68px, Hard stays precise at 30px. */
      if (dist < (tuning.tolerance || TRACE_WAYPOINT_RADIUS)) {
        newReached.push(nextIdx);
        setReachedWaypoints(newReached);
        setTraceProgress(newReached.length / waypoints.length);

        if (soundEnabled) soundManager.playProgress();

        /* NO coverage shortcut. An earlier build accepted a letter once ~62%
           of its waypoints were reached and auto-filled the rest, to make air
           tracing achievable — but that is what produced "le lettre est
           terminé même si je ne touche pas tous les points". Every waypoint
           must be touched, in order. Easiness comes from FEWER, wider-spaced
           dots and a larger tolerance (see TRACE_TUNING), never from skipping
           part of the letter. */

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
      handleStepComplete, recordTraceSample, tuning]);

  /* Hand the latest version to the full-screen pointer effect above. */
  processTraceRef.current = processTracePosition;

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
    t.x = sx; t.y = sy; t.scale = HAND_SCALE; t.on = 1;   // upright, like every pointer now
    setHandVisible((v) => (v ? v : true));

    processTracePosition(sx, sy);
  };

  /* Map the tracked hand onto the canvas: the index fingertip gives the
     position, the knuckle→tip vector gives the direction the finger is
     pointing, the wrist→knuckle span gives a little depth (the hand grows as
     the child reaches toward the camera) and the index/little-finger order
     tells us which way round the hand is, so a left hand is not drawn as a
     right one. */
  /* The in-box hand is now TOUCH/MOUSE ONLY.
     ---------------------------------------------------------------------
     It used to map the tracked hand with `p.x * 300`, confining the camera
     pointer to the letter box — the exact behaviour the client asked us to
     remove. Camera tracing is handled by the full-screen pointer effect above,
     which draws on the fixed overlay and maps back into this box only to score
     the trace.

     Two pointers must never push the shared handPointerFilter on the same
     frame (it would advance the filter twice per sample and double the gain),
     so this effect no longer touches landmarks at all. It only clears the
     in-box hand when we leave the Trace step or when a touch drag ends. */
  useEffect(() => {
    if (step !== 'trace' || gamePhase !== 'playing' || isPaused) {
      hideHand();
      return;
    }
    if (!isDrawing) hideHand();
  }, [step, gamePhase, isPaused, isDrawing, hideHand]);

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

              {/* A sub-score of `null` means NOT MEASURED — the child did not do
                  enough for it to mean anything. It is shown as "—" with an
                  empty bar, never as 0% (which reads as a failure) and never as
                  100% (which is what it used to do). If nothing at all was
                  measured, the whole OT block is replaced by a plain note: a
                  report a therapist reads must not imply a result it does not
                  have. */}
              {otResults && otResults.composite != null && (
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
                          <strong>{value == null ? '—' : `${value}%`}</strong>
                        </div>
                        <div className="tt-ot-bar-track">
                          <motion.div
                            className="tt-ot-bar-fill"
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
                  letter was traced, so there is nothing to measure.
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
        {/* `!endAsking`: the end-game dialog pauses the round too, and without
            this the pause card rendered underneath it — two cards at once. */}
        {isPaused && !endAsking && (
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
          {/* "How to play" — available during play in EVERY game, not only on
              the first visit. Client feedback: "there should be an optional
              provision for user to see them again if they wish to." */}
          {/* End the round early and go straight to the report — the same
              control LetterQuest has. computeOTResults() reads the same
              accumulators the natural ending does, so a session stopped after
              one word is scored on that word rather than being discarded. */}
          <EndGameControl
            className="tt-icon-btn gs-end-btn"
            compact
            disabled={gamePhase !== 'playing'}
            onAskingChange={(asking) => { setEndAsking(asking); setIsPaused(asking); }}
            onConfirm={() => {
              setIsPaused(false);
              setOtResults(computeOTResults());
              setGamePhase('results');
            }}
          />
          <button
            className="tt-icon-btn"
            onClick={() => setGamePhase('rules')}
            title="How to play"
            aria-label="How to play"
          >
            <HelpCircle size={18} />
          </button>
          <button
            className="tt-icon-btn"
            onClick={() => toggleGameTheme()}
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
          {/* ── The word being built ─────────────────────────────────────
              Always visible, through all three steps, so the child can see
              why they are tracing this letter and what the round adds up to.
              (Client feedback: the round should form a complete word.) */}
          <div className="tt-word-banner" aria-label={`Word ${word}`}>
            <span className="tt-word-caption">Word {wordsDoneRef.current + 1} of {WORDS_PER_ROUND}</span>
            <div className="tt-word-letters">
              {letters.map((ch, i) => (
                <span
                  key={`${word}-w-${i}`}
                  className={`tt-word-letter ${
                    i < currentLetterIdx ? 'done'
                      : i === currentLetterIdx ? 'active' : 'todo'
                  }`}
                >
                  {i <= currentLetterIdx ? ch : '_'}
                </span>
              ))}
            </div>
          </div>

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
                ref={traceSvgRef}
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
                  
                  const isJump = letterJumps.includes(i);
                  
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
                  const isJump = letterJumps.includes(i);
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
                ref={stepCardRef}
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
                    {/* The WORD being built — one slot per letter, filled in as
                        the learner types each one. This replaces the old "type
                        the same letter three times" slots. */}
                    <div className="tt-type-slots" aria-label={`Spelling ${word}`}>
                      {letters.map((ch, i) => {
                        const done = i < currentLetterIdx
                          || (i === currentLetterIdx && typedCount >= TYPE_REQUIRED);
                        return (
                          <motion.div
                            key={`${word}-${i}`}
                            className={`tt-type-slot ${
                              done ? 'filled' : i === currentLetterIdx ? 'current' : 'empty'
                            }`}
                            initial={done ? { scale: 0.5, rotateY: 90 } : {}}
                            animate={done ? { scale: 1, rotateY: 0 } : {}}
                            transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                          >
                            {done ? ch : ''}
                          </motion.div>
                        );
                      })}
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

