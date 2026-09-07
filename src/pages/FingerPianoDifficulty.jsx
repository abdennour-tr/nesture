/**
 * FingerPianoDifficulty.jsx
 * Level select for "Finger Piano" — a thin config over the shared
 * GameLevelSelect.
 *
 * Every fact on these cards is read from fingerPianoLevels.js, which the game
 * reads too. They used to be written by hand and had drifted into describing
 * things Finger Piano does not do — "some visual cues are hidden", "fast
 * sequences and rhythm challenges", "time bonuses". None of that exists. What
 * really changes between levels is: how many fingers are in play, how many keys
 * are on the keyboard, how long the piece is, and how long the child has to
 * reach each lit key.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import GameLevelSelect from '../components/game/GameLevelSelect';
import { GAMES, levelNumber } from '../components/game/gameShell';
import {
  PIANO_LEVEL_BY_KEY, PIANO_FINGER_BY_KEY, secondsPerNote,
} from './fingerPianoLevels';

/**
 * The finger chips.
 *
 * They used to be emoji — 👍 Thumb, ✌️ Middle, 💍 Ring, 🤙 Little. Those are
 * hand SHAPES (and a piece of jewellery), so the card was showing a rule that
 * belongs to Magic Finger Copy, not to this game: here the child keeps the hand
 * open and bends ONE finger, and the screen names that finger with a numbered
 * coloured dot. The chip below is that same dot, with the same number and the
 * same colour the round will use.
 */
const Fingers = ({ keys }) => (
  <>
    {keys.map((k) => {
      const f = PIANO_FINGER_BY_KEY[k];
      return (
        <span key={k} className="gs-finger" style={{ '--fc': f.color }}>
          <span className="gs-finger-dot">{f.n}</span>
          {f.label}
        </span>
      );
    })}
  </>
);

/** Build a card straight from the level the game will actually run. */
function card(levelKey, desc) {
  const lvl = PIANO_LEVEL_BY_KEY[levelKey];
  return {
    desc,
    specs: [
      `${lvl.fingers.length} finger${lvl.fingers.length > 1 ? 's' : ''}`,
      /* White only: the round never asks for a black key, even though the
         keyboard draws them. */
      `${lvl.whiteKeys} white keys`,
      `${lvl.notes} notes`,
      `${secondsPerNote(levelKey)}s per key`,
    ],
    preview: <Fingers keys={lvl.fingers} />,
  };
}

const LEVELS = {
  easy: card('easy',
    'Thumb, index and middle finger on a small keyboard, with plenty of time for each note.'),
  medium: card('medium',
    'All five fingers, a wider keyboard and a longer piece — the notes come round faster.'),
  hard: card('hard',
    'The full keyboard and the longest piece, with barely three seconds to reach each key.'),
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
