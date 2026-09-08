import React from 'react';
import { useNavigate } from 'react-router-dom';
import GameLevelSelect from '../components/game/GameLevelSelect';
import { GAMES, levelNumber } from '../components/game/gameShell';
import { PIANO_LEVEL_BY_KEY, PIANO_KEYS } from './fingerPianoLevels';

const descriptions = {
  easy: 'Start with three fingers, unlock all five, then bring in your other hand. Take your time.',
  medium: 'A longer melody for all five right-hand fingers. Each colour always belongs to the same key.',
  hard: 'Alternate between both hands across ten keys. Build a smooth, steady rhythm at your own pace.',
};
const LEVELS = Object.fromEntries(Object.entries(PIANO_LEVEL_BY_KEY).map(([key, level]) => [key, {
  desc: descriptions[key],
  specs: [
    key === 'easy' ? '3 → 5 → 10 keys' : level.stages[0].keys + ' keys / fingers',
    key === 'easy' ? '3 guided stages' : key === 'hard' ? 'Both hands' : 'Right hand',
    level.notes + ' notes',
    'No time limit',
  ],
  preview: (
    <div className="fp-key-preview" aria-label={key === 'easy' ? 'First three right-hand keys' : 'Fixed key colours and numbers'}>
      {PIANO_KEYS.slice(0, level.stages[0].keys).map(k => (
        <span key={k.id} className="gs-finger" style={{ '--fc': k.color }} title={k.label}>
          <span className="gs-finger-dot">{k.n}</span>
          {level.stages[0].keys <= 5 ? k.fingerLabel : ''}
        </span>
      ))}
    </div>
  ),
}]));

export default function FingerPianoDifficulty() {
  const navigate = useNavigate();
  return <GameLevelSelect game={GAMES['finger-piano']} levels={LEVELS}
    onStart={(key, mode) => navigate(
      GAMES['finger-piano'].route + '?level=' + levelNumber(key) + '&difficulty=' + key + '&mode=' + mode
    )} />;
}
