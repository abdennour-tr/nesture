/**
 * LadybugDifficulty.jsx
 * Level select for "Follow the Ladybug" — now a thin config over the shared
 * GameLevelSelect so every game presents the same journey.
 */
import React from 'react';
import GameLevelSelect from '../components/game/GameLevelSelect';
import { GAMES } from '../components/game/gameShell';

const PathPreview = ({ d }) => (
  <svg viewBox="0 0 204 54" preserveAspectRatio="none"
       style={{ width: '100%', maxHeight: 54 }}>
    <path d={d} fill="none" stroke="var(--lvl)" strokeWidth="6"
          strokeLinecap="round" opacity="0.85" />
  </svg>
);

const LEVELS = {
  easy: {
    desc: 'A gentle, slow ladybug on a wide, forgiving path.',
    specs: ['Slow pace', 'Wide path', '1 curve'],
    preview: <PathPreview d="M8 27 Q 55 4 102 27 T 196 27" />,
  },
  medium: {
    desc: 'A quicker ladybug with tighter tolerance and a wavier route.',
    specs: ['Steady pace', 'Narrower path', '1.5 curves'],
    preview: <PathPreview d="M8 27 Q 40 2 72 27 T 136 27 T 196 27" />,
  },
  hard: {
    desc: 'A fast ladybug that changes speed on a narrow, twisting path.',
    specs: ['Fast + variable', 'Tight path', '2 curves'],
    preview: <PathPreview d="M8 27 Q 32 1 56 27 T 104 27 T 152 27 T 196 27" />,
  },
};

export default function LadybugDifficulty() {
  return <GameLevelSelect game={GAMES.ladybug} levels={LEVELS} />;
}
