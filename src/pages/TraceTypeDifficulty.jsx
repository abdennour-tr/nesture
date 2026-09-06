/**
 * TraceTypeDifficulty.jsx
 * Level select for "Trace → Find → Type" — thin config over GameLevelSelect.
 *
 * Client feedback addressed:
 *   • "mentioning level 1,2,3" while other games said Easy/Medium/Hard →
 *     it is Easy / Medium / Hard everywhere now.
 *   • different colour coding → the shared difficulty tokens are used.
 *   • the theme toggle used to live only here → it is now in the shared shell,
 *     so it is available on this screen AND in every other game.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import GameLevelSelect from '../components/game/GameLevelSelect';
import { GAMES, levelNumber } from '../components/game/gameShell';
import { WORD_SETS } from './traceTypeWords';

const Words = ({ words }) => (
  <>
    {words.slice(0, 6).map((w) => (
      <span key={w} className="gs-spec">{w}</span>
    ))}
  </>
);

const LEVELS = {
  easy: {
    desc: 'Short 3-letter words made of straight-line letters. Big tracing guide and a simplified keyboard.',
    specs: ['3-letter words', 'Extra-wide guide', 'Simple keyboard'],
    preview: <Words words={WORD_SETS.easy} />,
  },
  medium: {
    desc: 'Longer words with curved letters, a standard guide and the full QWERTY keyboard.',
    specs: ['4-letter words', 'Standard guide', 'Full keyboard'],
    preview: <Words words={WORD_SETS.medium} />,
  },
  hard: {
    desc: 'The trickiest letters in longer words, with a precise guide and bonus points for speed.',
    specs: ['5-letter words', 'Precise guide', 'Time bonus'],
    preview: <Words words={WORD_SETS.hard} />,
  },
};

export default function TraceTypeDifficulty() {
  const navigate = useNavigate();
  return (
    <GameLevelSelect
      game={GAMES['trace-type']}
      levels={LEVELS}
      onStart={(key, mode) =>
        navigate(
          `${GAMES['trace-type'].route}?level=${levelNumber(key)}&difficulty=${key}&mode=${mode}`
        )
      }
      footNote="💡 Tracing works with your finger in the air or with the mouse — switch at any time. Each round spells a whole word."
    />
  );
}
