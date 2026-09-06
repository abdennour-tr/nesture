/**
 * PinchCoinDifficulty.jsx
 * Level select for "Pinch the Coin".
 *
 * Client feedback: "The pinch the coin has its own journey altogether."
 * The two-step wizard (Step 1 mode → Step 2 level) is gone. It now uses the
 * same single screen as every other game: mode toggle on top, three identical
 * level cards below.
 *
 * Also: the coin preview circles show the ACTUAL relative coin size per level,
 * because the client couldn't tell the levels apart ("it does say coin size is
 * bigger to smaller across levels, but i thought they were same size").
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import GameLevelSelect from '../components/game/GameLevelSelect';
import { GAMES, levelNumber } from '../components/game/gameShell';
import { COIN_SIZE } from './pinchCoinLevels';

/* Preview draws the real coin radius (scaled down) so the size difference is
   obvious on the level-select screen itself. */
const Coin = ({ px }) => (
  <span
    style={{
      width: px, height: px, borderRadius: '50%',
      display: 'grid', placeItems: 'center',
      fontSize: px * 0.55, lineHeight: 1,
      background: 'radial-gradient(circle at 35% 30%, #FDE68A, #F59E0B)',
      boxShadow: '0 4px 10px rgba(180,83,9,0.3)',
    }}
  >
    🪙
  </span>
);

const LEVELS = {
  easy: {
    desc: 'A very large coin, gentle movement and a slow pace.',
    specs: [`${COIN_SIZE.easy}px coin`, '5 coins', 'Slow'],
    preview: <Coin px={COIN_SIZE.easy * 0.6} />,
  },
  medium: {
    desc: 'A noticeably smaller coin, a longer carry and more of them.',
    specs: [`${COIN_SIZE.medium}px coin`, '10 coins', 'Medium'],
    preview: <Coin px={COIN_SIZE.medium * 0.6} />,
  },
  hard: {
    desc: 'A small coin that needs a precise pinch, against a faster timer.',
    specs: [`${COIN_SIZE.hard}px coin`, '15 coins', 'Fast'],
    preview: <Coin px={COIN_SIZE.hard * 0.6} />,
  },
};

export default function PinchCoinDifficulty() {
  const navigate = useNavigate();
  return (
    <GameLevelSelect
      game={GAMES['pinch-coin']}
      levels={LEVELS}
      onStart={(key, mode) =>
        navigate(
          `${GAMES['pinch-coin'].route}?level=${levelNumber(key)}&difficulty=${key}&mode=${mode}`
        )
      }
      footNote="💡 Touch / Mouse mode works with a normal mouse click on a laptop and with a single finger press on a touch screen — you never need to pinch the screen itself."
    />
  );
}
