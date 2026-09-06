/**
 * FingerCopyDifficulty.jsx
 * Level select for "Magic Finger Copy" — thin config over GameLevelSelect.
 *
 * Client feedback: "what is the difference between level 1 and 2? as i see
 * some movements repeating in both". The gesture sets are now genuinely
 * distinct (see LEVELS in useGestureDetection.js) and the card shows exactly
 * which shapes each level contains, so the difference is visible before you
 * even press Start.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import GameLevelSelect from '../components/game/GameLevelSelect';
import { GAMES, levelNumber } from '../components/game/gameShell';
import { LEVELS as GESTURE_LEVELS, GESTURE_INFO } from '../hooks/useGestureDetection';

const Tags = ({ items }) => (
  <>
    {items.map((t, i) => (
      <span key={i} className="gs-spec">{t}</span>
    ))}
  </>
);

const gestureTags = (n) =>
  (GESTURE_LEVELS[n]?.gestures || []).map(
    (g) => `${GESTURE_INFO[g]?.emoji || ''} ${GESTURE_INFO[g]?.name || g}`
  );

const sequenceTags = (n) =>
  (GESTURE_LEVELS[n]?.sequences || []).map((seq) =>
    seq.map((g) => GESTURE_INFO[g]?.emoji || '?').join(' → ')
  );

const LEVELS = {
  easy: {
    desc: 'Four simple, wide-open hand shapes held one at a time, with a slow timer.',
    specs: ['4 shapes', 'One at a time', 'Slow timer'],
    preview: <Tags items={gestureTags(1)} />,
  },
  medium: {
    desc: 'New, finer shapes that need precise fingers — none of the Easy set repeats.',
    specs: ['5 new shapes', 'Finer control', 'Faster timer'],
    preview: <Tags items={gestureTags(2)} />,
  },
  hard: {
    desc: 'Short sequences: copy three shapes in the right order before time runs out.',
    specs: ['Sequences of 3', 'From memory', 'Fastest timer'],
    preview: <Tags items={sequenceTags(3)} />,
  },
};

export default function FingerCopyDifficulty() {
  const navigate = useNavigate();
  return (
    <GameLevelSelect
      game={GAMES['finger-copy']}
      levels={LEVELS}
      onStart={(key) =>
        navigate(`${GAMES['finger-copy'].route}?level=${levelNumber(key)}&difficulty=${key}`)
      }
    />
  );
}
