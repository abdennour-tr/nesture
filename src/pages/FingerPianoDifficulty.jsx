/**
 * FingerPianoDifficulty.jsx
 * Level select for "Finger Piano" — thin config over GameLevelSelect.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import GameLevelSelect from '../components/game/GameLevelSelect';
import { GAMES, levelNumber } from '../components/game/gameShell';

const FINGERS = {
  thumb:  '👍 Thumb',
  index:  '👆 Index',
  middle: '✌️ Middle',
  ring:   '💍 Ring',
  little: '🤙 Little',
};

const Fingers = ({ keys }) => (
  <>
    {keys.map((k) => (
      <span key={k} className="gs-spec">{FINGERS[k]}</span>
    ))}
  </>
);

const LEVELS = {
  easy: {
    desc: 'Three fingers at a slow pace, with large keys and plenty of guidance.',
    specs: ['3 fingers', 'Slow pace', 'Full cues'],
    preview: <Fingers keys={['thumb', 'index', 'middle']} />,
  },
  medium: {
    desc: 'All five fingers at a medium pace — some visual cues are hidden.',
    specs: ['5 fingers', 'Medium pace', 'Fewer cues'],
    preview: <Fingers keys={['thumb', 'index', 'middle', 'ring', 'little']} />,
  },
  hard: {
    desc: 'Fast sequences and rhythm challenges with minimal cues and time bonuses.',
    specs: ['5 fingers', 'Fast sequences', 'Time bonus'],
    preview: <Fingers keys={['thumb', 'index', 'middle', 'ring', 'little']} />,
  },
};

export default function FingerPianoDifficulty() {
  const navigate = useNavigate();
  return (
    <GameLevelSelect
      game={GAMES['finger-piano']}
      levels={LEVELS}
      onStart={(key, mode) =>
        navigate(
          `${GAMES['finger-piano'].route}?level=${levelNumber(key)}&difficulty=${key}&mode=${mode}`
        )
      }
    />
  );
}
