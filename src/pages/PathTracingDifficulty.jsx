/**
 * PathTracingDifficulty.jsx
 * Level select for "Trace the Shape" — migrated onto the shared shell so it
 * no longer has its own bespoke screen (and is in English like the rest of
 * the product).
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import GameLevelSelect from '../components/game/GameLevelSelect';
import { GAMES } from '../components/game/gameShell';

const PREVIEW_PATHS = {
  easy:   'M 25 5 A 20 20 0 1 1 24.99 5 Z',
  medium: 'M 5 45 L 25 5 L 45 45 M 13 30 L 37 30',
  hard:   'M 25 25 C 25 20 30 15 35 15 C 40 15 45 20 45 25 C 45 35 35 40 25 40 C 15 40 5 30 5 25 C 5 10 20 0 30 0',
};

const Shape = ({ d }) => (
  <svg viewBox="0 0 50 50" style={{ width: 74, height: 74 }}>
    <path d={d} fill="none" stroke="var(--lvl)" strokeWidth="4"
          strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LEVELS = {
  easy: {
    desc: 'Simple shapes: circle, square, triangle, star and heart.',
    specs: ['Simple shapes', 'Wide guide', 'No timer'],
    preview: <Shape d={PREVIEW_PATHS.easy} />,
  },
  medium: {
    desc: 'Letters and numbers: A, B, S, 2, 8 and Z.',
    specs: ['Letters & digits', 'Standard guide', 'Gentle timer'],
    preview: <Shape d={PREVIEW_PATHS.medium} />,
  },
  hard: {
    desc: 'Complex patterns: spirals, waves and zigzags.',
    specs: ['Complex patterns', 'Precise guide', 'Timed'],
    preview: <Shape d={PREVIEW_PATHS.hard} />,
  },
};

export default function PathTracingDifficulty() {
  const navigate = useNavigate();
  return (
    <GameLevelSelect
      game={GAMES['path-trace']}
      levels={LEVELS}
      onStart={(key, mode) => navigate(`/play/path-game?difficulty=${key}&mode=${mode}`)}
    />
  );
}
