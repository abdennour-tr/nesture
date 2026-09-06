/**
 * pinchCoinLevels.js
 * ---------------------------------------------------------------------------
 * Single source of truth for Pinch-the-Coin level tuning.
 *
 * Client feedback: "it does say coin size is bigger to smaller across levels,
 * but i thought they were same size, no?"
 *
 * The level-select screen and the game itself now BOTH read these numbers, so
 * the promise on the card is always the size the learner actually gets, and
 * the three levels are visibly different (2.4× between Easy and Hard).
 */
export const COIN_SIZE = {
  easy:   160,   // very large — easy to grab, forgiving
  medium: 105,
  hard:    66,   // clearly small — needs a precise pinch
};

export const COIN_TARGET_COUNT = {
  easy:   5,
  medium: 10,
  hard:   15,
};

/** Pinch tolerance in normalised hand units — larger = more forgiving. */
export const PINCH_TOLERANCE = {
  easy:   0.085,
  medium: 0.065,
  hard:   0.048,
};

export const ROUND_SECONDS = {
  easy:   0,     // 0 = no timer
  medium: 90,
  hard:   60,
};

export function coinSizeFor(levelKey) {
  return COIN_SIZE[levelKey] ?? COIN_SIZE.easy;
}
