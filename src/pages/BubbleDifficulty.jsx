/**
 * BubbleDifficulty.jsx
 * Level select for "Pop the Bubble" — thin config over the shared
 * GameLevelSelect. Preview circles mirror the real bubble radii per level.
 */
import React from 'react';
import GameLevelSelect from '../components/game/GameLevelSelect';
import { GAMES } from '../components/game/gameShell';

const Bubbles = ({ sizes }) => (
  <>
    {sizes.map((s, i) => (
      <span
        key={i}
        style={{
          width: s, height: s, borderRadius: '50%',
          border: '3px solid var(--lvl)',
          background: 'var(--lvl-soft)',
          display: 'inline-block',
        }}
      />
    ))}
  </>
);

const LEVELS = {
  easy: {
    desc: 'Big, slow bubbles with plenty of time to aim.',
    specs: ['Big bubbles', 'Slow rise', '5 at a time'],
    preview: <Bubbles sizes={[46, 38, 30]} />,
  },
  medium: {
    desc: 'Smaller bubbles rising faster, and more of them at once.',
    specs: ['Medium bubbles', 'Faster rise', '7 at a time'],
    preview: <Bubbles sizes={[34, 28, 22]} />,
  },
  hard: {
    desc: 'Small, quick bubbles that demand precise pointing.',
    specs: ['Small bubbles', 'Quick rise', '9 at a time'],
    preview: <Bubbles sizes={[24, 19, 15]} />,
  },
};

export default function BubbleDifficulty() {
  return <GameLevelSelect game={GAMES.bubble} levels={LEVELS} />;
}
